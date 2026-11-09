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
 * One page of a year's records, newest first, as the cards the library's results list shows, with their authors' profiles.
 * `year` null is the records with no readable year.
 */
export async function readBrowsePage(config: LibraryServerConfig, year: number | null, page: number) {
  const database = await getDatabaseForConfig(config);
  const inYear = and(publicRecordCondition(database, config), year === null ? sql`${yearOf} is null` : sql`${yearOf} = ${String(year)}`);
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
