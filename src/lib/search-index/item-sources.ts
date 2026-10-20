import { and, asc, eq, inArray, ne, not } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { chunkValues } from "@/lib/chunk-values";

/**
 * The sources that still hold each record: its links that were not withdrawn, to sources the library has not removed.
 * Records made here belong to no source.
 */
export async function readItemSources(
	database: Pick<Database | DatabaseTransaction, "select">,
	keys: readonly string[],
): Promise<(key: string) => string[]> {
	const sources = new Map<string, string[]>();
	for (const chunk of chunkValues([...keys], 1_000)) {
		const rows = await database
			.select({ itemKey: itemSourceLink.itemKey, source: itemSourceLink.sourceConnectionKey })
			.from(itemSourceLink)
			.innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
			.where(
				and(
					inArray(itemSourceLink.itemKey, chunk),
					not(itemSourceLink.remoteDeleted),
					ne(sourceConnection.status, "removed"),
					ne(sourceConnection.key, NATIVE_SOURCE_CONNECTION_KEY),
				),
			)
			.orderBy(asc(itemSourceLink.itemKey), asc(itemSourceLink.sourceConnectionKey));
		for (const row of rows) sources.set(row.itemKey, [...(sources.get(row.itemKey) ?? []), row.source]);
	}
	return (key) => sources.get(key) ?? [];
}
