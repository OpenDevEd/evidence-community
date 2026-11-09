import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { chunkValues } from "@/lib/chunk-values";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

/**
 * The sources that still hold each record: its links that were not withdrawn, to sources the library has not removed.
 * Records made here belong to no source. And the OpenAlex work a record is, from any source that read it as one, even
 * one since removed: an added paper is kept under its own key, so its work is only on its link.
 */
export async function readItemSources(
	database: Pick<Database | DatabaseTransaction, "select">,
	keys: readonly string[],
): Promise<{ sourcesOf: (key: string) => string[]; workOf: (key: string) => string | null }> {
	const sources = new Map<string, string[]>();
	const works = new Map<string, string>();
	for (const chunk of chunkValues([...keys], 1_000)) {
		const rows = await database
			.select({ itemKey: itemSourceLink.itemKey, source: itemSourceLink.sourceConnectionKey, provider: sourceConnection.provider, recordKey: itemSourceLink.sourceRecordKey, remoteDeleted: itemSourceLink.remoteDeleted, status: sourceConnection.status })
			.from(itemSourceLink)
			.innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
			.where(and(inArray(itemSourceLink.itemKey, chunk), ne(sourceConnection.key, NATIVE_SOURCE_CONNECTION_KEY)))
			.orderBy(asc(itemSourceLink.itemKey), asc(itemSourceLink.sourceConnectionKey));
		for (const row of rows) {
			if (!row.remoteDeleted && row.status !== "removed") sources.set(row.itemKey, [...(sources.get(row.itemKey) ?? []), row.source]);
			// The work a record is stays when its source is removed or no longer finds it, as the record does.
			if (isOpenAlexWorkProvider(row.provider) && /^W[1-9]\d*$/u.test(row.recordKey)) works.set(row.itemKey, row.recordKey);
		}
	}
	return { sourcesOf: (key) => sources.get(key) ?? [], workOf: (key) => works.get(key) ?? null };
}
