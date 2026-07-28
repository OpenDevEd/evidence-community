import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { applyRuntimeCollectionConfiguration } from "@/lib/collections";

export async function getCollections(
	config?: LibraryServerConfig,
) {
	const libraryConfig = config ?? await getLibraryConfig();
	const db = await getDatabaseForConfig(libraryConfig);
	const collections = await db.query.collection.findMany();

	return applyRuntimeCollectionConfiguration(
		collections,
		libraryConfig.collections,
	);
}
