import { and, eq, inArray, isNotNull, ne, not, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection, sourceSnapshot } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemOpenAccessLookup } from "@/db/schema/tables/itemOpenAccessLookup";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";

/** SQL that is true when a record has a copy of its OpenAlex work that still counts: its search still finds it. */
export const hasCurrentOpenAlexWork = (itemKey: unknown) => sql`EXISTS (
	SELECT 1 FROM "sourceSnapshot" s
	JOIN "itemSourceLink" link ON link."itemKey" = s."itemKey" AND link."sourceConnectionKey" = s."sourceConnectionKey"
	JOIN "sourceConnection" c ON c.key = s."sourceConnectionKey"
	WHERE s."itemKey" = ${itemKey} AND NOT link."remoteDeleted" AND c.status <> 'removed'
		AND c.provider IN (${sql.join(OPENALEX_WORK_PROVIDERS.map((provider) => sql`${provider}`), sql`, `)}))`;

/**
 * Reads whether records are open access as readers see them: an editor's choice, else what OpenAlex says
 * ({@link readSourceOpenAccess}). Every caller gets the choice, so a change OpenAlex makes under it changes nothing.
 */
export async function readOpenAccess(
	database: Pick<Database | DatabaseTransaction, "select">,
	keys: readonly string[],
): Promise<(key: string, doi: string | null) => boolean | null> {
	if (keys.length === 0) return () => null;
	const [fromSources, choices] = await Promise.all([
		readSourceOpenAccess(database, keys),
		database
			.select({ key: item.key, openAccess: item.openAccess })
			.from(item)
			.where(and(inArray(item.key, [...keys]), isNotNull(item.openAccess))),
	]);
	const choiceOf = new Map(choices.map((row) => [row.key, row.openAccess]));
	return (key, doi) => choiceOf.get(key) ?? fromSources(key, doi);
}

/**
 * What OpenAlex says about records: the `is_oa` of the newest copy of the record's OpenAlex work that its search still
 * finds, else OpenAlex's answer for the DOI the record shows, else null.
 */
async function readSourceOpenAccess(
	database: Pick<Database | DatabaseTransaction, "select">,
	keys: readonly string[],
): Promise<(key: string, doi: string | null) => boolean | null> {
	const [works, lookups] = await Promise.all([
		database
			.select({
				itemKey: sourceSnapshot.itemKey,
				// Overlapping OpenAlex searches each keep a copy of the work: the latest OpenAlex version is current.
				isOpenAccess: sql<boolean>`(array_agg((${sourceSnapshot.payload} #>> '{open_access,is_oa}')::boolean ORDER BY ${sourceSnapshot.remoteVersion} DESC NULLS LAST, ${sourceSnapshot.fetchedAt} DESC, ${sourceSnapshot.sourceConnectionKey}))[1]`,
			})
			.from(sourceSnapshot)
			.innerJoin(
				itemSourceLink,
				and(
					eq(itemSourceLink.itemKey, sourceSnapshot.itemKey),
					eq(itemSourceLink.sourceConnectionKey, sourceSnapshot.sourceConnectionKey),
				),
			)
			.innerJoin(sourceConnection, eq(sourceConnection.key, sourceSnapshot.sourceConnectionKey))
			.where(
				and(
					inArray(sourceSnapshot.itemKey, [...keys]),
					inArray(sourceConnection.provider, [...OPENALEX_WORK_PROVIDERS]),
					not(itemSourceLink.remoteDeleted),
					ne(sourceConnection.status, "removed"),
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

/**
 * What OpenAlex says about one record, whatever an editor chose and whether or not readers can see it: its OpenAlex
 * work, else the last answer for its DOI. Given a DOI, such as one a draft changes to, the answer counts only for that
 * DOI; otherwise it counts whichever DOI it was for, as the record is looked up again soon after its DOI changes.
 */
export async function readOpenAccessFromSources(
	database: Pick<Database | DatabaseTransaction, "select">,
	key: string,
	doi?: string | null,
) {
	const [fromSources, [lookup]] = await Promise.all([
		readSourceOpenAccess(database, [key]),
		database.select({ doi: itemOpenAccessLookup.doi }).from(itemOpenAccessLookup).where(eq(itemOpenAccessLookup.itemKey, key)),
	]);
	return fromSources(key, doi === undefined ? (lookup?.doi ?? null) : doi);
}
