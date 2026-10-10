import { publicParentVisibility } from "@/lib/public-item-visibility";
import { item } from "@/db/schema/tables/item";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, gte, inArray, isNull, lt, lte, notInArray, sql, type SQL } from "drizzle-orm";
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
/** How soon to ask OpenScholar again while it writes a digest in the background. */
const DIGEST_CHECK_MS = 15_000;
/**
 * How far back the first digest after a pause reaches: a month. The extra day keeps a 31-day month that crosses a
 * clock change whole.
 */
const DIGEST_REACH_MS = 32 * 86_400_000;

// Publications this stream has not covered yet, up to the end of the window.
// That includes commits that landed after an earlier window closed and items
// revealed since, but never what an earlier edition counted past its cap.
function uncovered(db: DatabaseTransaction, config: LibraryServerConfig, after: Date, window: NotificationWindow) {
  return and(
    publicParentVisibility(db, config.content.tags.hidden),
    eq(notificationItem.eligible, true), notInArray(item.itemType, ["Attachment", "Note"]),
    isNull(window.stream === "digest" ? notificationItem.digestEditionId : notificationItem.hourlyEditionId),
    gt(notificationItem.firstPublishedAt, after), lte(notificationItem.firstPublishedAt, window.end),
  );
}

// Publications dated from the day the window starts up to the day before it
// ends, in the library's time zone. A record without a full date belongs to no period.
function publishedIn(db: DatabaseTransaction, config: LibraryServerConfig, window: Pick<NotificationWindow, "start" | "end">) {
  const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: config.notifications.schedule.timezone });
  return and(
    publicParentVisibility(db, config.content.tags.hidden), notInArray(item.itemType, ["Attachment", "Note"]),
    sql`${item.date} ~ '^\\d{4}-\\d{2}-\\d{2}'`, gte(item.date, day(window.start)), lt(item.date, day(window.end)),
  );
}

/**
 * Counts a digest's publications and picks the ones it lists, best first: a
 * real abstract, then a score of the journal's standing, references, known
 * institutions and citations. The journal and withdrawal flags come from the
 * OpenAlex record, so other sources score on the rest. A preprint and its
 * article, or two deposits of one upload, count once: records with one title
 * and first author's surname are one work. The record with an abstract stands
 * for it, since that is what the writer reads; between two that both have one
 * or both lack one, the published record does.
 */
async function rankPublications(db: DatabaseTransaction, candidates: SQL | undefined) {
  const { rows: [result] } = await db.execute<{ total: number; keys: string[] | null }>(sql`
    WITH candidate AS (
      SELECT ${item.key} AS key, length(coalesce(${item.abstractNote}, '')) >= 200 AS abstract, coalesce(metric.refs, 0) AS refs,
        ${item.itemType}::text IN ('Preprint', 'Dataset', 'ComputerProgram') AS deposit,
        CASE WHEN length(coalesce(${item.title}, '')) >= 25 AND author.surname <> ''
          THEN trim(lower(regexp_replace(${item.title}, '[[:space:][:punct:]]+', ' ', 'g'))) || '|' || author.surname
          ELSE ${item.key} END AS work,
        CASE WHEN record.core THEN 3 ELSE 0 END
          + CASE WHEN metric.refs >= 10 THEN 2 WHEN metric.refs > 0 THEN 1 ELSE 0 END
          + CASE WHEN EXISTS (SELECT 1 FROM "itemInstitution" WHERE "itemKey" = ${item.key}) THEN 1 ELSE 0 END
          + 2 * ln(1 + coalesce(metric.citations, 0))
          - CASE WHEN ${item.itemType}::text IN ('Dataset', 'ComputerProgram') THEN 1 ELSE 0 END
          - CASE WHEN record.withdrawn THEN 10 ELSE 0 END AS score
      FROM ${item}
      -- The first author, or the first creator when none is marked as an author. A creator is stored as first and
      -- last name, or as one name the way OpenAlex gives it.
      CROSS JOIN LATERAL (SELECT lower(coalesce(nullif(first.creator ->> 'lastName', ''), substring(first.creator ->> 'name' from '(\\S+)\\s*$'), '')) AS surname
        FROM (SELECT (SELECT creator FROM jsonb_array_elements(coalesce(${item.creators}, '[]'::jsonb)) WITH ORDINALITY AS listed(creator, position)
          ORDER BY (creator ->> 'creatorType' = 'author') DESC NULLS LAST, position LIMIT 1) AS creator) first) author
      LEFT JOIN LATERAL (SELECT max("citedByCount") AS citations, max("referencedWorksCount") AS refs
        FROM "itemCitationMetric" WHERE "itemKey" = ${item.key}) metric ON true
      LEFT JOIN LATERAL (SELECT bool_or("payload" #>> '{primary_location,source,is_core}' = 'true') AS core,
          bool_or("payload" ->> 'is_retracted' = 'true' OR "payload" ->> 'is_paratext' = 'true') AS withdrawn
        FROM "sourceSnapshot" WHERE "itemKey" = ${item.key}) record ON true
      WHERE ${candidates}
    ), chosen AS (
      SELECT DISTINCT ON (work) key, abstract, score, refs FROM candidate ORDER BY work, abstract DESC, deposit, score DESC, refs DESC, key
    )
    SELECT (SELECT count(*)::int FROM chosen) AS total,
      ARRAY(SELECT key FROM chosen ORDER BY abstract DESC, score DESC, refs DESC, key LIMIT ${EDITION_LISTED_LIMIT}) AS keys
  `);
  return { total: result.total, keys: result.keys ?? [] };
}

/**
 * Marks every candidate as covered by this edition and returns how many there
 * were plus the first ones to list. One statement, so a commit landing mid-way
 * is either covered and counted here or left for the next edition.
 */
async function coverCandidates(db: DatabaseTransaction, config: LibraryServerConfig, after: Date, window: NotificationWindow, editionId: string) {
  const column = window.stream === "digest" ? sql.identifier("digestEditionId") : sql.identifier("hourlyEditionId");
  const candidates = db.select({ key: notificationItem.itemKey }).from(notificationItem).innerJoin(item, eq(item.key, notificationItem.itemKey)).where(uncovered(db, config, after, window));
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

/** The additions a stream may still cover were first published after this: since the library began sending, or for digests since the floor a long pause left. */
function additionsAfter(state: typeof notificationState.$inferSelect, stream: NotificationStream) {
  return stream === "digest" && state.digestFloor && state.digestFloor > state.enabledAt! ? state.digestFloor : state.enabledAt!;
}

function notificationWindows(state: typeof notificationState.$inferSelect, digestAt: Date | null, now: Date, manualDigest: boolean): NotificationWindow[] {
  const windows: NotificationWindow[] = [];
  const hourlyEnd = completedHourlyWindow(now);
  // A restart combines overdue additions instead of sending one email per missed hour.
  const hourlyNext = new Date(completedHourlyWindow(state.hourlyThrough!).getTime() + 3_600_000);
  if (!manualDigest && hourlyNext <= hourlyEnd) windows.push({ stream: "hourly", start: state.hourlyThrough!, end: hourlyEnd });
  if (manualDigest || (digestAt && digestAt <= now)) windows.push({ stream: "digest", start: state.digestThrough!, end: manualDigest ? now : digestAt! });
  return windows;
}

/** How many publications the edition covers, and the keys of those it lists. */
async function editionPublications(tx: DatabaseTransaction, config: LibraryServerConfig, after: Date, window: NotificationWindow, editionId: string) {
  // Additions are marked as covered whatever a digest covers, so a library that
  // later switches to additions starts from this edition.
  const additions = await coverCandidates(tx, config, after, window, editionId);
  if (window.stream === "hourly") return additions;
  return rankPublications(tx, config.notifications.digestCovers === "published"
    ? publishedIn(tx, config, window)
    : inArray(item.key, tx.select({ key: notificationItem.itemKey }).from(notificationItem).where(eq(notificationItem.digestEditionId, editionId))));
}

async function prepareWindow(
  tx: DatabaseTransaction,
  config: LibraryServerConfig,
  after: Date,
  window: NotificationWindow,
  manualDigest: boolean,
): Promise<DigestPreparation> {
  if (window.end <= window.start) return { status: "empty" };
  const editionId = randomUUID();
  const cursor = window.stream === "hourly" ? { hourlyThrough: window.end } : { digestThrough: window.end, nextDigestAt: nextDigestDate(config.notifications.schedule, window.end) };
  // A digest written by hand for a period that ends here stands; the schedule moves past it.
  const inserted = await tx.insert(notificationEdition).values({ id: editionId, stream: window.stream, windowStart: window.start, windowEnd: window.end, publications: [] }).onConflictDoNothing().returning({ id: notificationEdition.id });
  if (!inserted.length) {
    await tx.update(notificationState).set(cursor);
    return { status: "empty" };
  }
  const { total, keys } = await editionPublications(tx, config, after, window, editionId);
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
  await tx.update(notificationState).set(cursor);
  return result;
}

type State = typeof notificationState.$inferSelect;

/** What a schedule change, a pause or its end changes about when the next scheduled digest is due. */
function scheduleChange(config: LibraryServerConfig, state: State, now: Date) {
  const paused = config.notifications.pausedSince !== null;
  const resumed = state.digestPaused && !paused;
  const patch: Partial<State> = paused === state.digestPaused ? {} : { digestPaused: paused };
  if (resumed || !isDeepStrictEqual(JSON.parse(state.schedule), config.notifications.schedule)) {
    Object.assign(patch, { schedule: JSON.stringify(config.notifications.schedule), nextDigestAt: nextDigestDate(config.notifications.schedule, now) });
  }
  return { paused, resumed, patch };
}

/** The digest that ends a pause reaches a month back from its end. When the last digest is older, it starts there. */
function reachChange(state: State, end: Date | null): Partial<State> {
  if (!end) return {};
  const reach = new Date(end.getTime() - DIGEST_REACH_MS);
  return state.digestThrough! < reach ? { digestThrough: reach, digestFloor: reach } : {};
}

/**
 * Where the digest stands after a schedule change, a pause or its end: the state as it now is, and when the next
 * scheduled digest is due (never, while paused). A paused library keeps its place, so the first digest after the pause
 * covers everything since the last one, up to a month back. That digest goes out at the next scheduled time after the
 * pause ends, not for a time that passed during it. A digest an owner asks for by hand is written even while paused.
 */
async function digestCursor(tx: DatabaseTransaction, config: LibraryServerConfig, state: State, now: Date, manualDigest: boolean) {
  const { paused, resumed, patch } = scheduleChange(config, state, now);
  // The digest that ends the pause: the next scheduled one, or one asked for by hand during it.
  const end = resumed ? patch.nextDigestAt! : paused && manualDigest ? now : null;
  Object.assign(patch, reachChange(state, end));
  const current = Object.keys(patch).length ? (await tx.update(notificationState).set(patch).returning())[0] : state;
  return { state: current, digestAt: paused ? null : current.nextDigestAt! };
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
      [state] = await tx.update(notificationState).set({ enabled: true, enabledAt, hourlyThrough: enabledAt, digestThrough: enabledAt, nextDigestAt: nextDigestDate(config.notifications.schedule, enabledAt), schedule, digestPaused: false, digestFloor: null }).returning();
      if (!manualDigest) return { status: "empty" };
    }
    const cursor = await digestCursor(tx, config, state, now, manualDigest);
    let result: DigestPreparation = { status: "empty" };
    for (const window of notificationWindows(cursor.state, cursor.digestAt, now, manualDigest)) {
      const prepared = await prepareWindow(tx, config, additionsAfter(cursor.state, window.stream), window, manualDigest);
      if (prepared.status === "queued") result = prepared;
    }
    return result;
  });
}

/**
 * Writes the digest of a past period by publication date, or rewrites the
 * edition that already ends when it does, in the same record. Additions are not
 * consulted and the schedule does not move. No subscriber is emailed.
 */
export async function prepareDigestForPeriod(db: Database, config: LibraryServerConfig, period: { start: Date; end: Date }): Promise<DigestPreparation> {
  if (!config.notifications.enabled) return { status: "disabled" };
  return db.transaction(async tx => {
    const { total, keys } = await rankPublications(tx, publishedIn(tx, config, period));
    const publications = await listPublications(tx, config, keys);
    if (!publications.length) return { status: "empty" };
    const cover = publications.find(publication => publication.item.PDFCoverPageImage)?.item.PDFCoverPageImage ?? null;
    // The worker compares the next attempt with the database's clock, so that clock sets it.
    const edition = { windowStart: period.start, publications, publicationCount: total, cover, publishedAt: null, attempts: 0, nextAttemptAt: sql<Date>`now()`, leaseToken: null, leaseExpiresAt: null, lastError: null };
    const [{ id }] = await tx.insert(notificationEdition).values({ stream: "digest", windowEnd: period.end, ...edition })
      .onConflictDoUpdate({ target: [notificationEdition.stream, notificationEdition.windowEnd], set: edition }).returning({ id: notificationEdition.id });
    await tx.execute(sql`
      INSERT INTO "notificationDelivery" ("messageKey", "subscriberId", "editionId", "status", "nextAttemptAt")
      SELECT ${id} || ':' || "id"::text, "id", ${id}::uuid, 'skipped', NULL FROM "notificationSubscriber"
      ON CONFLICT ("messageKey") DO UPDATE SET "status" = 'skipped', "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL
        WHERE "notificationDelivery"."status" = 'queued'
    `);
    return { status: "queued", editionId: id, publicationCount: total };
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
    if (!output) {
      // OpenScholar is still writing it. Checking back is not a failed attempt.
      await db.update(notificationEdition).set({ nextAttemptAt: new Date(Date.now() + DIGEST_CHECK_MS), leaseToken: null, leaseExpiresAt: null, lastError: null }).where(owned);
      return true;
    }
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
    body: JSON.stringify({ libraryId: service.libraryId, editionId: edition.id, locale: config.localization.defaultLocale, periodStart: edition.windowStart.toISOString(), periodEnd: edition.windowEnd.toISOString(), publicationCount: edition.publicationCount, publications: edition.publications.map(({ item: _item, ...metadata }) => metadata) }),
    signal: AbortSignal.any([AbortSignal.timeout(210_000), ...(signal ? [signal] : [])]),
  });
  if (response.status === 202) return null;
  if (!response.ok) throw new Error(`OpenScholar digest generation returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const output: unknown = await response.json();
  return z.object({ digest: digestResponseSchema }).parse(output).digest;
}
import { z } from "zod";
const digestResponseSchema = z.object({ title: z.string().min(1), summary: z.string().min(1), markdown: z.string().min(1), model: z.string().min(1), reasoning: z.literal("max") });
