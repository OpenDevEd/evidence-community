import { and, inArray, ne } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { sourceConnection } from "@/db/schema/source";
import { sourceDisplayLabel } from "@/lib/admin/source-label";
import type { PublicSource } from "./types";

/** The library's sources in the order its configuration lists them, each by its own name. */
export async function getPublicSources(config: LibraryServerConfig): Promise<PublicSource[]> {
	const keys = config.sources.map((source) => source.key);
	if (keys.length === 0) return [];
	const db = await getDatabaseForConfig(config);
	const rows = await db
		.select({
			key: sourceConnection.key,
			provider: sourceConnection.provider,
			displayName: sourceConnection.displayName,
			externalScopeKey: sourceConnection.externalScopeKey,
		})
		.from(sourceConnection)
		.where(and(inArray(sourceConnection.key, keys), ne(sourceConnection.status, "removed")));
	const byKey = new Map(rows.map((row) => [row.key, row]));
	return keys.flatMap((key) => {
		const row = byKey.get(key);
		return row ? [{ key, name: sourceDisplayLabel(row) }] : [];
	});
}
