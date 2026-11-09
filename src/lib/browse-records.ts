import "server-only";
import { and, asc, count, desc, sql } from "drizzle-orm";
import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { publicRecordCondition } from "@/lib/library-export-records";
import { readPublicItems } from "@/lib/search-index/projection";
import { toLightweightItem } from "@/lib/search";
import { publicTagRules } from "@/lib/tags";
import { readAuthorProfiles } from "@/lib/authors/catalog-server";

/** Records per browse page: enough that a year needs few pages, few enough to read. */
export const BROWSE_PAGE_SIZE = 100;

/** The year a record was published, read from its date however it was written: "2021", "2021-05-13", "May 2021". */
const yearOf = sql<string | null>`substring(${item.date} from '(?:^|[^0-9])((?:1[5-9]|20)[0-9]{2})(?:[^0-9]|$)')`;

/** The month a record was published, when its date gives one ("2021-05-13", "2021-05"). */
const monthOf = sql<string | null>`substring(${item.date} from '^(?:1[5-9]|20)[0-9]{2}-([01][0-9])')`;


/** How many public records each year holds, newest first; records with no readable year are counted apart. */
export async function readBrowseYears(config: LibraryServerConfig) {
  const database = await getDatabaseForConfig(config);
  const rows = await database.select({ year: yearOf, records: count() }).from(item)
    .where(publicRecordCondition(database, config)).groupBy(yearOf).orderBy(sql`${yearOf} desc nulls last`);
  return {
    years: rows.flatMap((row) => (row.year ? [{ year: Number(row.year), records: Number(row.records) }] : [])),
    undated: Number(rows.find((row) => !row.year)?.records ?? 0),
  };
}

/**
 * One page of a year's records (or one month's of them), newest first, as the cards the library's results list shows, with their authors' profiles.
 * `year` null is the records with no readable year.
 */
export async function readBrowsePage(config: LibraryServerConfig, year: number | null, page: number, month?: number | "unknown") {
  const database = await getDatabaseForConfig(config);
  const inMonth = month === undefined ? undefined : month === "unknown" ? sql`(${monthOf} is null or ${monthOf}::int not between 1 and 12)` : sql`${monthOf} = ${String(month).padStart(2, "0")}`;
  const inYear = and(publicRecordCondition(database, config), year === null ? sql`${yearOf} is null` : sql`${yearOf} = ${String(year)}`, inMonth);
  const [rows, [total]] = await Promise.all([
    database.select({ key: item.key }).from(item).where(inYear).orderBy(desc(item.date), asc(item.key))
      .limit(BROWSE_PAGE_SIZE).offset((page - 1) * BROWSE_PAGE_SIZE),
    database.select({ total: count() }).from(item).where(inYear),
  ]);
  const keys = rows.map((row) => row.key);
  // Each card keeps what a result card keeps of its files, so it shows its PDF's first page.
  const rules = publicTagRules(config);
  const byKey = new Map((await readPublicItems(database, keys, config)).map(({ fullTextPDFs: _text, ...card }) => [card.key, toLightweightItem(card, rules)]));
  const cards = keys.flatMap((key) => byKey.get(key) ?? []);
  const profiles = await readAuthorProfiles(cards.flatMap((card) => card.creators ?? []).flatMap((creator) => (creator.authorProfileId ? [creator.authorProfileId] : [])));
  const records = Number(total?.total ?? 0);
  return { cards, profiles, total: records, pages: Math.max(1, Math.ceil(records / BROWSE_PAGE_SIZE)) };
}

/** A year as a browse address writes it. */
export const BROWSE_YEAR = /^(1[5-9]|20)\d{2}$/;

/** The page in `?page=`; anything unreadable is the first. */
export const browsePageOf = (raw: string | undefined) => Math.max(1, Number.parseInt(raw ?? "1", 10) || 1);

/** The periods either side of one in a newest-first list, older first; none for a period outside the list. */
export function neighboursOf(order: number[], current: number | null | "unknown", step: (value: number) => { label: string; href: string }) {
  const at = typeof current === "number" ? order.indexOf(current) : -1;
  const pick = (index: number) => (at >= 0 && index >= 0 && index < order.length ? step(order[index]!) : null);
  return { older: pick(at + 1), newer: pick(at - 1) };
}

/** How many public records a year holds (null: those with no readable year), and the years beside it that hold some. */
export async function readBrowseYear(config: LibraryServerConfig, year: number | null) {
  const years = await readBrowseYears(config);
  const total = year === null ? years.undated : years.years.find((each) => each.year === year)?.records;
  return { total, ...neighboursOf(years.years.map((each) => each.year), year, (each) => ({ label: String(each), href: `/browse/${each}` })) };
}

/** A year with more records than this is split by month, so every page of it stays a few links from the home page. */
export const MONTH_SPLIT = 500;


/** How many of a year's records fall in each month, and how many give no month. */
export async function readBrowseMonths(config: LibraryServerConfig, year: number) {
  const database = await getDatabaseForConfig(config);
  const rows = await database.select({ month: monthOf, records: count() }).from(item)
    .where(and(publicRecordCondition(database, config), sql`${yearOf} = ${String(year)}`)).groupBy(monthOf).orderBy(sql`${monthOf} desc nulls last`);
  return {
    months: rows.flatMap((row) => (row.month && Number(row.month) >= 1 && Number(row.month) <= 12 ? [{ month: Number(row.month), records: Number(row.records) }] : [])),
    unknown: rows.filter((row) => !row.month || Number(row.month) < 1 || Number(row.month) > 12).reduce((sum, row) => sum + Number(row.records), 0),
  };
}
