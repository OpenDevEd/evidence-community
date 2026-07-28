import { getLibraryConfig } from "@/config/library-config/server";
import { db } from "@/db";
import { applyRuntimeCollectionConfiguration } from "@/lib/collections";

export async function getCollections() {
	const [config, collections] = await Promise.all([
		getLibraryConfig(),
		db.query.collection.findMany(),
	]);

	return applyRuntimeCollectionConfiguration(
		collections,
		config.collections,
	);
}
