import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { notificationEdition, notificationItem, notificationState } from "@/db/schema/notifications";
import { getPublicItemCard } from "@/lib/public-item-card";
import { completedHourlyWindow, nextDigestDate } from "./schedule";
import type { NotificationPublication, NotificationStream } from "./types";

function digestMetadata(card: NonNullable<Awaited<ReturnType<typeof getPublicItemCard>>>) {
  return { key: card.key, title: (card.title || "Untitled publication").slice(0, 2000), creators: (card.creators ?? []).slice(0, 100).map(c => (c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).slice(0, 500)).filter(Boolean), date: card.date?.slice(0, 100) ?? null, abstract: card.abstractNote?.slice(0, 16000) ?? null, publicationType: card.itemType, doi: card.DOI?.slice(0, 500) ?? null };
}

async function collectPublications(db: DatabaseTransaction, config: LibraryServerConfig, enabledAt: Date, end: Date, stream: NotificationStream) {
  const rows = await db.select({ key: notificationItem.itemKey }).from(notificationItem).where(and(
    eq(notificationItem.eligible, true), gt(notificationItem.firstPublishedAt, enabledAt), lte(notificationItem.firstPublishedAt, end),
    sql`NOT EXISTS (SELECT 1 FROM "notificationEdition" e WHERE e."stream" = ${stream}
      AND e."publications" @> jsonb_build_array(jsonb_build_object('key', ${notificationItem.itemKey})))`,
  )).orderBy(notificationItem.firstPublishedAt, notificationItem.itemKey);
  const publications: NotificationPublication[] = [];
  let metadataBytes = 0;
  for (const row of rows) {
    const card = await getPublicItemCard(db, row.key, config);
    if (!card || card.itemType === "Attachment" || card.itemType === "Note") continue;
    const metadata = digestMetadata(card);
    metadataBytes += Buffer.byteLength(JSON.stringify(metadata));
    // Remaining unannounced items stay eligible for the next edition.
    if (publications.length >= 1000 || metadataBytes > 1_500_000) break;
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
  const publications = await collectPublications(tx, config, enabledAt, window.end, window.stream);
  if (!publications.length && manualDigest) return { status: "empty" };
  let result: DigestPreparation = { status: "empty" };
  if (publications.length) {
    const [edition] = await tx.insert(notificationEdition).values({ stream: window.stream, windowStart: window.start, windowEnd: window.end, publications }).returning({ id: notificationEdition.id });
    if (window.stream === "digest") result = { status: "queued", editionId: edition.id, publicationCount: publications.length };
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
      title: "New publications", summary: `${edition.publications.length} new ${edition.publications.length === 1 ? "publication" : "publications"}`, markdown: null, model: null, reasoning: null,
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
const digestResponseSchema = z.object({ title: z.string().min(1), summary: z.string().min(1), markdown: z.string().min(1), model: z.literal("openai/gpt-5.6-luna"), reasoning: z.literal("max") });
