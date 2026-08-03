import { asc, eq, sql } from "drizzle-orm";

import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { collection } from "@/db/schema/tables/collection";
import { applyRuntimeCollectionConfiguration } from "@/lib/collections";

export async function getCollections(config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	const db = await getDatabaseForConfig(libraryConfig);
	const collections = await db
		.select()
		.from(collection)
		.where(eq(collection.deleted, 0))
		.orderBy(
			asc(collection.sourceConnectionKey),
			sql`${collection.sortOrder} ASC NULLS LAST`,
			sql`lower(coalesce(${collection.name}, ''))`,
			asc(collection.key),
		);

	return applyRuntimeCollectionConfiguration(
		collections,
		libraryConfig.collections,
	);
}
