import "server-only";
import { and, asc, count, desc, sql } from "drizzle-orm";
import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { publicRecordCondition } from "@/lib/library-export-records";

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

/** One page of a year's records, newest first, with what a row shows. `year` null is the records with no readable year. */
export async function readBrowsePage(config: LibraryServerConfig, year: number | null, page: number) {
  const database = await getDatabaseForConfig(config);
  const inYear = and(publicRecordCondition(database, config), year === null ? sql`${yearOf} is null` : sql`${yearOf} = ${String(year)}`);
  const [records, [total]] = await Promise.all([
    database.select({ key: item.key, title: item.title, creators: item.creators, publicationTitle: item.publicationTitle, itemType: item.itemType, date: item.date })
      .from(item).where(inYear).orderBy(desc(item.date), asc(item.key))
      .limit(BROWSE_PAGE_SIZE).offset((page - 1) * BROWSE_PAGE_SIZE),
    database.select({ total: count() }).from(item).where(inYear),
  ]);
  return { records, total: Number(total?.total ?? 0), pages: Math.max(1, Math.ceil(Number(total?.total ?? 0) / BROWSE_PAGE_SIZE)) };
}
