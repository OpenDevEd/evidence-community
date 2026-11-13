import { z } from "zod";
import { and, count, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationEdition, notificationState } from "@/db/schema/notifications";
import { item } from "@/db/schema/tables/item";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { readOpenAccess } from "@/lib/search-index/open-access";
import { getPublicItemCards } from "@/lib/public-item-card";
import { storedSynthesis, storedTypeOrder } from "./digest-types";
import { citedKeys } from "./digest-text";
import { digestPeriod, nextDigestDate, type DigestPeriod } from "./schedule";
import type { DigestSigner, DigestTypeCounts } from "./types";

const ARCHIVE_PAGE_SIZE = 20;
const EDITION_PAGE_SIZE = 12;

/**
 * A date written out in the library's time zone. Only the server writes it: the
 * browser's time zone data can disagree with the server's, and the page would not hydrate.
 */
export type DigestDate = {at: string; day: string; month: string; monthYear: string; /** The year in the library's time zone, as the other parts are. */ year: string; weekday: string; dayName: string; date: string; time: string};
/** Who stands behind a digest: the Editor or Owner who checked it, or null when it went out as AI wrote it. Their account is not told. */
export type DigestSignature = Omit<DigestSigner, "id"> | null;
/** `by` is left out when the library does not tell readers who checks its digests. `period` is the days the edition covers. */
export type DigestSummary = {slug: string; period: DigestPeriod; title: string; summary: string; publicationCount: number; cover: string | null; by?: DigestSignature};
/**
 * An edition with one page of its listed publications that are public now; `listed` can be lower than `publicationCount`.
 * `note` is the words of the person who checked it, shown above the text with their name, so only when readers are told who that is.
 */
export type DigestEdition = DigestSummary & {markdown: string; note: string | null; listed: number; page: number; pages: number; keys: string[]; reviews?: DigestReviews; types: EditionTypes; /** The day its publications were counted and listed, so a reader knows what came later is not in it. */ counted: string; /** How many publications the writer read: the list as it was made, before any was hidden. */ read: number; /** How many publications its text cites. */ cited: number; /** How many of those readers can open without a subscription. */ citedOpen: number};
/**
 * An edition's publications by study type: those listed that are public now, and every one the period had when the
 * list was made. A digest listed before types has only the first.
 */
export type EditionTypes = {listed: DigestTypeCounts; period: DigestTypeCounts | null};
/**
 * One page of an edition's reviews and syntheses, which are a list of their own with its own pages when the
 * edition has any. `keys` on the edition then holds the other publications; `listed` still counts both.
 */
export type DigestReviews = {listed: number; page: number; pages: number; keys: string[]};
/** The records an edition's page shows cards for: this page of its reviews, then this page of the others. */
export const editionCardKeys = (edition: DigestEdition) => [...(edition.reviews?.keys ?? []), ...edition.keys];
export type DigestArchivePage = {editions: DigestSummary[]; page: number; pages: number};
/** The archive's chart: the latest editions whatever page the list is on, and how many there are in all. */
export type DigestChart = {editions: DigestSummary[]; total: number};
const CHART_EDITIONS = 24;
/** The most editions the sitemap lists. A weekly digest reaches this after nineteen years. */
const SITEMAP_EDITIONS = 1000;

// Lists read these small columns only, never an edition's stored publications.
const summaryColumns = {
  id: notificationEdition.id, windowStart: notificationEdition.windowStart, windowEnd: notificationEdition.windowEnd, title: notificationEdition.title,
  summary: notificationEdition.summary, publicationCount: notificationEdition.publicationCount, cover: notificationEdition.cover,
  checkedBy: notificationEdition.checkedBy,
};
type SummaryRow = {id: string; windowStart: Date; windowEnd: Date; title: string | null; summary: string | null; publicationCount: number; cover: string | null; checkedBy: DigestSigner | null};

/** Who checked an edition, as readers are told. Undefined when the library does not say. */
export function digestSignature(config: LibraryServerConfig, checkedBy: DigestSigner | null): DigestSignature | undefined {
  if (!config.notifications.attribution) return undefined;
  return checkedBy && {name: checkedBy.name, photo: checkedBy.photo, role: checkedBy.role};
}

function digestDate(value: Date, locale: string, config: LibraryServerConfig): DigestDate {
  const text = (options: Intl.DateTimeFormatOptions) => value.toLocaleString(locale, {...options, timeZone: config.notifications.schedule.timezone});
  return {
    at: value.toISOString(), day: text({day: "2-digit"}), month: text({month: "short"}), monthYear: text({month: "long", year: "numeric"}), year: text({year: "numeric"}),
    weekday: text({weekday: "long", day: "numeric", month: "long"}), dayName: text({weekday: "long"}), date: text({day: "numeric", month: "long", year: "numeric"}),
    time: text({hour: "2-digit", minute: "2-digit", hour12: false}),
  };
}

function editionSummary(row: SummaryRow, locale: string, config: LibraryServerConfig): DigestSummary {
  // An edition is dated by its period, so one written later for a past period keeps that period's dates.
  const by = digestSignature(config, row.checkedBy);
  const {digestCovers, schedule} = config.notifications;
  return {slug: row.id, period: digestPeriod(row.windowStart, row.windowEnd, digestCovers, schedule.timezone, locale), title: row.title!, summary: row.summary!, publicationCount: row.publicationCount, cover: row.cover, ...(by === undefined ? {} : {by})};
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

export async function listDigestChart(db: Database, config: LibraryServerConfig, locale: string): Promise<DigestChart> {
  const [{total}] = await db.select({total: count()}).from(notificationEdition).where(visibleEdition);
  const rows = await db.select(summaryColumns).from(notificationEdition).where(visibleEdition).orderBy(desc(notificationEdition.windowEnd)).limit(CHART_EDITIONS);
  return {editions: rows.map(row => editionSummary(row, locale, config)), total};
}

export async function getLatestDigest(db: Database, config: LibraryServerConfig, locale: string): Promise<DigestSummary | null> {
  const [row] = await db.select(summaryColumns).from(notificationEdition).where(visibleEdition).orderBy(desc(notificationEdition.windowEnd)).limit(1);
  return row ? editionSummary(row, locale, config) : null;
}

/** One published edition's title, summary and cover, for the details its page gives search engines and link previews. */
export async function getDigestSummary(db: Database, config: LibraryServerConfig, locale: string, id: string): Promise<DigestSummary | null> {
  const uuid = editionId(id);
  if (!uuid) return null;
  const [row] = await db.select(summaryColumns).from(notificationEdition).where(and(visibleEdition, eq(notificationEdition.id, uuid))).limit(1);
  return row ? editionSummary(row, locale, config) : null;
}

/** Every published edition's address and the day it went out, newest first, for the sitemap. */
export async function listDigestAddresses(db: Database): Promise<{slug: string; publishedAt: Date}[]> {
  const rows = await db.select({slug: notificationEdition.id, publishedAt: notificationEdition.publishedAt}).from(notificationEdition)
    .where(visibleEdition).orderBy(desc(notificationEdition.windowEnd)).limit(SITEMAP_EDITIONS);
  return rows.map(row => ({slug: row.slug, publishedAt: row.publishedAt!}));
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

/** How many of these publications are public and open access, as their cards say. */
async function openCount(db: Database, config: LibraryServerConfig, keys: string[]) {
  if (!keys.length) return 0;
  const [openAccessOf, cards] = await Promise.all([readOpenAccess(db, keys), getPublicItemCards(db, keys, config)]);
  return cards.filter(card => openAccessOf(card.key, card.DOI ?? null) === true).length;
}

export async function getDigestEdition(db: Database, config: LibraryServerConfig, locale: string, id: string, page = 1, reviewsPage = 1): Promise<DigestEdition | undefined> {
  const uuid = editionId(id);
  if (!uuid) return undefined;
  const [row] = await db.select({...summaryColumns, markdown: notificationEdition.markdown, note: notificationEdition.note, studyTypes: notificationEdition.studyTypes, requestedAt: notificationEdition.requestedAt, publishedAt: notificationEdition.publishedAt, read: sql<number>`jsonb_array_length(${notificationEdition.publications})`})
    .from(notificationEdition).where(and(visibleEdition, eq(notificationEdition.id, uuid))).limit(1);
  if (!row) return undefined;
  // Pages hold only the listed records that are public now, so hiding one
  // later never leaves a short or empty page. Only one page of keys leaves the database.
  const listedNow = sql`
    FROM ${notificationEdition}, jsonb_array_elements(${notificationEdition.publications}) WITH ORDINALITY AS stored(entry, position)
    JOIN ${item} ON ${item.key} = stored.entry->>'key'
    WHERE ${notificationEdition.id} = ${uuid} AND ${publicParentVisibility(db, config.content.tags.hidden)}`;
  const list = async (which: SQL, wanted: number) => {
    const {rows: [{listed}]} = await db.execute<{listed: number}>(sql`SELECT count(*)::int AS listed ${listedNow} ${which}`);
    const pages = Math.max(1, Math.ceil(listed / EDITION_PAGE_SIZE));
    const current = Math.min(wanted, pages);
    const {rows: keys} = await db.execute<{key: string}>(sql`
      SELECT stored.entry->>'key' AS key ${listedNow} ${which}
      ORDER BY ${storedTypeOrder}, stored.position LIMIT ${EDITION_PAGE_SIZE} OFFSET ${(current - 1) * EDITION_PAGE_SIZE}`);
    return {listed, page: current, pages, keys: keys.map(entry => entry.key)};
  };
  const summary = editionSummary(row, locale, config);
  const {rows: listedTypes} = await db.execute<{type: keyof DigestTypeCounts; publications: number}>(sql`
    SELECT coalesce(stored.entry->>'studyType', 'unread') AS type, count(*)::int AS publications ${listedNow} GROUP BY 1`);
  const types = {listed: Object.fromEntries(listedTypes.map(entry => [entry.type, entry.publications])), period: row.studyTypes};
  // The list is counted and made just before the writer is asked for its text; an edition with no record of that asking has the day it was published.
  const counted = (row.requestedAt ?? row.publishedAt!).toLocaleDateString(locale, {day: "numeric", month: "long", year: "numeric", timeZone: config.notifications.schedule.timezone});
  const cited = citedKeys(row.markdown!);
  const edition = {...summary, markdown: row.markdown!, note: summary.by ? row.note : null, types, counted, read: row.read, cited: cited.length, citedOpen: await openCount(db, config, cited)};
  const reviews = await list(sql`AND ${storedSynthesis}`, reviewsPage);
  if (!reviews.listed) return {...edition, ...await list(sql``, page)};
  const others = await list(sql`AND NOT ${storedSynthesis}`, page);
  return {...edition, ...others, listed: others.listed + reviews.listed, reviews};
}

export async function getNextDigestEdition(db: Database, config: LibraryServerConfig, locale: string): Promise<DigestDate | null> {
  if (!config.notifications.enabled) return null;
  const [state] = await db.select().from(notificationState).limit(1);
  const next = nextEditionDate(config, state);
  return next && digestDate(next, locale, config);
}
