import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { sourceConnection, sourceSnapshot } from "@/db/schema/source";
import { itemOpenAccessLookup } from "@/db/schema/tables/itemOpenAccessLookup";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";

/**
 * Reads whether records are open access: the `is_oa` of the record's OpenAlex work as most recently fetched, else
 * OpenAlex's answer for the DOI the record shows, else null.
 */
export async function readOpenAccess(
	database: Pick<Database | DatabaseTransaction, "select">,
	keys: readonly string[],
): Promise<(key: string, doi: string | null) => boolean | null> {
	if (keys.length === 0) return () => null;
	const [works, lookups] = await Promise.all([
		database
			.select({
				itemKey: sourceSnapshot.itemKey,
				// Overlapping OpenAlex searches each keep a copy of the work; the newest one is current.
				isOpenAccess: sql<boolean>`(array_agg((${sourceSnapshot.payload} #>> '{open_access,is_oa}')::boolean ORDER BY ${sourceSnapshot.fetchedAt} DESC, ${sourceSnapshot.sourceConnectionKey}))[1]`,
			})
			.from(sourceSnapshot)
			.innerJoin(sourceConnection, eq(sourceConnection.key, sourceSnapshot.sourceConnectionKey))
			.where(
				and(
					inArray(sourceSnapshot.itemKey, [...keys]),
					inArray(sourceConnection.provider, [...OPENALEX_WORK_PROVIDERS]),
					sql`jsonb_typeof(${sourceSnapshot.payload} #> '{open_access,is_oa}') = 'boolean'`,
				),
			)
			.groupBy(sourceSnapshot.itemKey),
		database
			.select()
			.from(itemOpenAccessLookup)
			.where(and(inArray(itemOpenAccessLookup.itemKey, [...keys]), isNotNull(itemOpenAccessLookup.isOpenAccess))),
	]);
	const fromWork = new Map(works.map((row) => [row.itemKey, row.isOpenAccess]));
	const lookupOf = new Map(lookups.map((row) => [row.itemKey, row]));
	return (key, doi) => {
		const lookup = lookupOf.get(key);
		return fromWork.get(key) ?? (lookup && lookup.doi === doi ? lookup.isOpenAccess : null);
	};
}
