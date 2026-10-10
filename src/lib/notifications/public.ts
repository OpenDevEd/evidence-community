import { z } from "zod";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationEdition, notificationState } from "@/db/schema/notifications";
import { item } from "@/db/schema/tables/item";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { nextDigestDate } from "./schedule";

const ARCHIVE_PAGE_SIZE = 20;
const EDITION_PAGE_SIZE = 12;

/**
 * A date written out in the library's time zone. Only the server writes it: the
 * browser's time zone data can disagree with the server's, and the page would not hydrate.
 */
export type DigestDate = {at: string; day: string; month: string; monthYear: string; weekday: string; dayName: string; date: string; time: string};
export type DigestSummary = {slug: string; published: DigestDate; title: string; summary: string; publicationCount: number; cover: string | null};
/** An edition with one page of its listed publications that are public now; `listed` can be lower than `publicationCount`. */
export type DigestEdition = DigestSummary & {markdown: string; listed: number; page: number; pages: number; keys: string[]};
export type DigestArchivePage = {editions: DigestSummary[]; page: number; pages: number};

// Lists read these small columns only, never an edition's stored publications.
const summaryColumns = {
  id: notificationEdition.id, windowEnd: notificationEdition.windowEnd, title: notificationEdition.title,
  summary: notificationEdition.summary, publicationCount: notificationEdition.publicationCount, cover: notificationEdition.cover,
};
type SummaryRow = {id: string; windowEnd: Date; title: string | null; summary: string | null; publicationCount: number; cover: string | null};

function digestDate(value: Date, locale: string, config: LibraryServerConfig): DigestDate {
  const text = (options: Intl.DateTimeFormatOptions) => value.toLocaleString(locale, {...options, timeZone: config.notifications.schedule.timezone});
  return {
    at: value.toISOString(), day: text({day: "2-digit"}), month: text({month: "short"}), monthYear: text({month: "long", year: "numeric"}),
    weekday: text({weekday: "long", day: "numeric", month: "long"}), dayName: text({weekday: "long"}), date: text({day: "numeric", month: "long", year: "numeric"}),
    time: text({hour: "2-digit", minute: "2-digit", hour12: false}),
  };
}

function editionSummary(row: SummaryRow, locale: string, config: LibraryServerConfig): DigestSummary {
  // An edition is dated by the end of its period, so one written later for a past period keeps that period's date.
  return {slug: row.id, published: digestDate(row.windowEnd, locale, config), title: row.title!, summary: row.summary!, publicationCount: row.publicationCount, cover: row.cover};
}
const visibleEdition = and(eq(notificationEdition.stream, "digest"), isNotNull(notificationEdition.publishedAt));

/** A page number from the URL; anything that is not a positive whole number is page 1. */
export function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function editionId(id: string) {
  const parsed = z.string().uuid().safeParse(id);
  return parsed.success ? parsed.data : null;
}

function nextEditionDate(config: LibraryServerConfig, state: typeof notificationState.$inferSelect | undefined) {
  if (!config.notifications.enabled || config.notifications.pausedSince !== null) return null;
  const now = new Date();
  const currentSchedule = state?.schedule === JSON.stringify(config.notifications.schedule);
  if (currentSchedule && state?.enabled && state.nextDigestAt && state.nextDigestAt > now) return state.nextDigestAt;
  return nextDigestDate(config.notifications.schedule, now);
}

// Each page part loads only its own rows, so the page structure never waits for them.
export async function listDigestEditions(db: Database, config: LibraryServerConfig, locale: string, page = 1): Promise<DigestArchivePage> {
  const [{total}] = await db.select({total: count()}).from(notificationEdition).where(visibleEdition);
  const pages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = await db.select(summaryColumns).from(notificationEdition).where(visibleEdition)
    .orderBy(desc(notificationEdition.windowEnd)).limit(ARCHIVE_PAGE_SIZE).offset((current - 1) * ARCHIVE_PAGE_SIZE);
  return {editions: rows.map(row => editionSummary(row, locale, config)), page: current, pages};
}

export async function getLatestDigest(db: Database, config: LibraryServerConfig, locale: string): Promise<DigestSummary | null> {
  const [row] = await db.select(summaryColumns).from(notificationEdition).where(visibleEdition).orderBy(desc(notificationEdition.windowEnd)).limit(1);
  return row ? editionSummary(row, locale, config) : null;
}

/** The editions just before this one, newest first. */
export async function listEarlierDigests(db: Database, config: LibraryServerConfig, locale: string, id: string, limit = 4): Promise<DigestSummary[]> {
  const uuid = editionId(id);
  if (!uuid) return [];
  const earlier = sql`${notificationEdition.windowEnd} < (SELECT "windowEnd" FROM "notificationEdition" WHERE "id" = ${uuid})`;
  const rows = await db.select(summaryColumns).from(notificationEdition).where(and(visibleEdition, earlier))
    .orderBy(desc(notificationEdition.windowEnd)).limit(limit);
  return rows.map(row => editionSummary(row, locale, config));
}

export async function getDigestEdition(db: Database, config: LibraryServerConfig, locale: string, id: string, page = 1): Promise<DigestEdition | undefined> {
  const uuid = editionId(id);
  if (!uuid) return undefined;
  const [row] = await db.select({...summaryColumns, markdown: notificationEdition.markdown})
    .from(notificationEdition).where(and(visibleEdition, eq(notificationEdition.id, uuid))).limit(1);
  if (!row) return undefined;
  // Pages hold only the listed records that are public now, so hiding one
  // later never leaves a short or empty page. Only one page of keys leaves the database.
  const listedNow = sql`
    FROM ${notificationEdition}, jsonb_array_elements(${notificationEdition.publications}) WITH ORDINALITY AS stored(entry, position)
    JOIN ${item} ON ${item.key} = stored.entry->>'key'
    WHERE ${notificationEdition.id} = ${uuid} AND ${publicParentVisibility(db, config.content.tags.hidden)}`;
  const {rows: [{listed}]} = await db.execute<{listed: number}>(sql`SELECT count(*)::int AS listed ${listedNow}`);
  const pages = Math.max(1, Math.ceil(listed / EDITION_PAGE_SIZE));
  const current = Math.min(page, pages);
  const {rows: keys} = await db.execute<{key: string}>(sql`
    SELECT stored.entry->>'key' AS key ${listedNow}
    ORDER BY stored.position LIMIT ${EDITION_PAGE_SIZE} OFFSET ${(current - 1) * EDITION_PAGE_SIZE}`);
  return {...editionSummary(row, locale, config), markdown: row.markdown!, listed, page: current, pages, keys: keys.map(entry => entry.key)};
}

export async function getNextDigestEdition(db: Database, config: LibraryServerConfig, locale: string): Promise<DigestDate | null> {
  if (!config.notifications.enabled) return null;
  const [state] = await db.select().from(notificationState).limit(1);
  const next = nextEditionDate(config, state);
  return next && digestDate(next, locale, config);
}
