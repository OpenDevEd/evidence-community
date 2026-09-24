import { publicParentVisibility } from "@/lib/public-item-visibility";
import { item } from "@/db/schema/tables/item";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { notificationEdition, notificationItem, notificationState } from "@/db/schema/notifications";
import { getPublicItemCard, getPublicItemCards } from "@/lib/public-item-card";
import { completedHourlyWindow, nextDigestDate } from "./schedule";
import type { NotificationPublication, NotificationStream } from "./types";

function digestMetadata(card: NonNullable<Awaited<ReturnType<typeof getPublicItemCard>>>) {
  return { key: card.key, title: (card.title || "Untitled publication").slice(0, 2000), creators: (card.creators ?? []).slice(0, 100).map(c => (c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).slice(0, 500)).filter(Boolean), date: card.date?.slice(0, 100) ?? null, abstract: card.abstractNote?.slice(0, 16000) ?? null, publicationType: card.itemType, doi: card.DOI?.slice(0, 500) ?? null };
}

/** Most publications an edition lists; the rest of its window is counted, never carried over. */
const EDITION_LISTED_LIMIT = 1000;

// Publications this stream has not covered yet, up to the end of the window.
// That includes commits that landed after an earlier window closed and items
// revealed since, but never what an earlier edition counted past its cap.
function uncovered(db: DatabaseTransaction, config: LibraryServerConfig, enabledAt: Date, window: NotificationWindow) {
  return and(
    publicParentVisibility(db, config.content.tags.hidden),
    eq(notificationItem.eligible, true), notInArray(item.itemType, ["Attachment", "Note"]),
    isNull(window.stream === "digest" ? notificationItem.digestEditionId : notificationItem.hourlyEditionId),
    gt(notificationItem.firstPublishedAt, enabledAt), lte(notificationItem.firstPublishedAt, window.end),
  );
}

/**
 * Marks every candidate as covered by this edition and returns how many there
 * were plus the first ones to list. One statement, so a commit landing mid-way
 * is either covered and counted here or left for the next edition.
 */
async function coverCandidates(db: DatabaseTransaction, config: LibraryServerConfig, enabledAt: Date, window: NotificationWindow, editionId: string) {
  const column = window.stream === "digest" ? sql.identifier("digestEditionId") : sql.identifier("hourlyEditionId");
  const candidates = db.select({ key: notificationItem.itemKey }).from(notificationItem).innerJoin(item, eq(item.key, notificationItem.itemKey)).where(uncovered(db, config, enabledAt, window));
  const { rows: [result] } = await db.execute<{ total: number; keys: string[] | null }>(sql`
    WITH covered AS (
      UPDATE "notificationItem" SET ${column} = ${editionId}
      WHERE "itemKey" IN (${candidates})
      RETURNING "itemKey", "firstPublishedAt"
    )
    SELECT (SELECT count(*)::int FROM covered) AS total,
      ARRAY(SELECT "itemKey" FROM covered ORDER BY "firstPublishedAt", "itemKey" LIMIT ${EDITION_LISTED_LIMIT}) AS keys
  `);
  return { total: result.total, keys: result.keys ?? [] };
}

async function listPublications(db: DatabaseTransaction, config: LibraryServerConfig, keys: string[]) {
  const publications: NotificationPublication[] = [];
  let metadataBytes = 0;
  const cards = new Map((await getPublicItemCards(db, keys, config)).map(card => [card.key, card]));
  for (const key of keys) {
    const card = cards.get(key);
    if (!card) continue;
    const metadata = digestMetadata(card);
    // The limit covers the serialized array, so count its brackets and commas too.
    metadataBytes += Buffer.byteLength(JSON.stringify(metadata)) + (publications.length ? 1 : 2);
    if (metadataBytes > 1_500_000) break;
    publications.push({ ...metadata, item: card });
  }
  return publications;
}

export type DigestPreparation =
  | { status: "queued"; editionId: string; publicationCount: number }
  | { status: "empty" | "disabled" };

type NotificationWindow = { stream: NotificationStream; start: Date; end: Date };

function notificationWindows(state: typeof notificationState.$inferSelect, digestAt: Date, now: Date, manualDigest: boolean): NotificationWindow[] {
  const windows: NotificationWindow[] = [];
  const hourlyEnd = completedHourlyWindow(now);
  // A restart combines overdue additions instead of sending one email per missed hour.
  const hourlyNext = new Date(completedHourlyWindow(state.hourlyThrough!).getTime() + 3_600_000);
  if (!manualDigest && hourlyNext <= hourlyEnd) windows.push({ stream: "hourly", start: state.hourlyThrough!, end: hourlyEnd });
  if (manualDigest || digestAt <= now) windows.push({ stream: "digest", start: state.digestThrough!, end: manualDigest ? now : digestAt });
  return windows;
}

async function prepareWindow(
  tx: DatabaseTransaction,
  config: LibraryServerConfig,
  enabledAt: Date,
  window: NotificationWindow,
  manualDigest: boolean,
): Promise<DigestPreparation> {
  if (window.end <= window.start) return { status: "empty" };
  const editionId = randomUUID();
  await tx.insert(notificationEdition).values({ id: editionId, stream: window.stream, windowStart: window.start, windowEnd: window.end, publications: [] });
  const { total, keys } = await coverCandidates(tx, config, enabledAt, window, editionId);
  const publications = await listPublications(tx, config, keys);
  let result: DigestPreparation = { status: "empty" };
  if (!publications.length) {
    await tx.delete(notificationEdition).where(eq(notificationEdition.id, editionId));
    if (manualDigest) return result;
  } else {
    const cover = publications.find(publication => publication.item.PDFCoverPageImage)?.item.PDFCoverPageImage ?? null;
    await tx.update(notificationEdition).set({ publications, publicationCount: total, cover }).where(eq(notificationEdition.id, editionId));
    if (window.stream === "digest") result = { status: "queued", editionId, publicationCount: total };
  }
  await tx.update(notificationState).set(window.stream === "hourly" ? { hourlyThrough: window.end } : { digestThrough: window.end, nextDigestAt: nextDigestDate(config.notifications.schedule, window.end) });
  return result;
}

/** Each window and its metadata snapshot are saved together before any provider call. */
export async function prepareNotificationEditions(
  db: Database,
  config: LibraryServerConfig,
  now = new Date(),
  { manualDigest = false } = {},
): Promise<DigestPreparation> {
  const schedule = JSON.stringify(config.notifications.schedule);
  return db.transaction(async tx => {
    await tx.insert(notificationState).values({ schedule }).onConflictDoNothing();
    let [state] = await tx.select().from(notificationState).for("update");
    if (!config.notifications.enabled) {
      await tx.update(notificationState).set({ enabled: false });
      return { status: "disabled" };
    }
    if (!state.enabled) {
      const enabledAt = new Date(Math.min(now.getTime(), new Date(config.updatedAt).getTime()));
      [state] = await tx.update(notificationState).set({ enabled: true, enabledAt, hourlyThrough: enabledAt, digestThrough: enabledAt, nextDigestAt: nextDigestDate(config.notifications.schedule, enabledAt), schedule }).returning();
      if (!manualDigest) return { status: "empty" };
    }
    let digestAt = state.nextDigestAt!;
    if (!isDeepStrictEqual(JSON.parse(state.schedule), config.notifications.schedule)) {
      digestAt = nextDigestDate(config.notifications.schedule, now);
      await tx.update(notificationState).set({ schedule, nextDigestAt: digestAt });
    }
    let result: DigestPreparation = { status: "empty" };
    for (const window of notificationWindows(state, digestAt, now, manualDigest)) {
      const prepared = await prepareWindow(tx, config, state.enabledAt!, window, manualDigest);
      if (prepared.status === "queued") result = prepared;
    }
    return result;
  });
}

export async function generateNotificationEdition(db: Database, config: LibraryServerConfig, signal?: AbortSignal) {
  if (!config.notifications.enabled) return false;
  const token = randomUUID();
  const result = await db.execute<{ id: string }>(sql`
    UPDATE "notificationEdition" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '5 minutes'
    WHERE "id" = (SELECT "id" FROM "notificationEdition" WHERE "publishedAt" IS NULL AND "nextAttemptAt" <= now()
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now()) ORDER BY "windowEnd" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING "id"
  `);
  if (!result.rows[0]) return false;
  const owned = and(eq(notificationEdition.id, result.rows[0].id), eq(notificationEdition.leaseToken, token), isNull(notificationEdition.publishedAt));
  const [edition] = await db.select().from(notificationEdition).where(owned);
  if (!edition) return false;
  try {
    const output = edition.stream === "digest" ? await requestDigest(config, edition, signal) : {
      title: "New publications", summary: `${edition.publicationCount} new ${edition.publicationCount === 1 ? "publication" : "publications"}`, markdown: null, model: null, reasoning: null,
    };
    await db.transaction(async tx => {
      const saved = await tx.update(notificationEdition).set({ ...output, publishedAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, lastError: null }).where(owned).returning({ id: notificationEdition.id });
      if (!saved.length) return;
      await tx.execute(sql`
        INSERT INTO "notificationDelivery" ("messageKey", "subscriberId", "editionId")
        SELECT ${edition.id} || ':' || "id"::text, "id", ${edition.id}::uuid FROM "notificationSubscriber"
        WHERE "confirmedAt" IS NOT NULL AND "confirmedAt" <= ${edition.windowEnd}
          AND (CASE WHEN ${edition.stream} = 'digest' THEN "digest" ELSE "instant" END)
        ON CONFLICT DO NOTHING
      `);
    });
  } catch (error) {
    const attempts = edition.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    await db.update(notificationEdition).set({ attempts, nextAttemptAt: attempts < 6 ? new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** attempts)) : null, leaseToken: null, leaseExpiresAt: null, lastError: message.slice(0, 2000) }).where(owned);
    console.error("Digest generation failed", { editionId: edition.id, error: message });
  }
  return true;
}

async function requestDigest(config: LibraryServerConfig, edition: typeof notificationEdition.$inferSelect, signal?: AbortSignal) {
  const service = config.authentication.openScholar;
  const response = await fetch(new URL("/api/v1/evidence-libraries/digests/generate", service.convexSiteUrl), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}` },
    body: JSON.stringify({ libraryId: service.libraryId, editionId: edition.id, locale: config.localization.defaultLocale, periodStart: edition.windowStart.toISOString(), periodEnd: edition.windowEnd.toISOString(), publications: edition.publications.map(({ item: _item, ...metadata }) => metadata) }),
    signal: AbortSignal.any([AbortSignal.timeout(210_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`OpenScholar digest generation returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const output: unknown = await response.json();
  return z.object({ digest: digestResponseSchema }).parse(output).digest;
}
import { z } from "zod";
const digestResponseSchema = z.object({ title: z.string().min(1), summary: z.string().min(1), markdown: z.string().min(1), model: z.string().min(1), reasoning: z.literal("max") });
