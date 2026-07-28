import "server-only";

import { attachDatabasePool } from "@vercel/functions";

import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { Database, schema } from "./database-schema";
import { RevisionAwareDatabaseFactory } from "./factory";
import { createPostgresDatabaseResource } from "./postgres";

function createDatabaseResource(databaseUrl: string) {
	const resource = createPostgresDatabaseResource(databaseUrl);
	attachDatabasePool(resource.pool);
	return resource;
}

const globalDatabase = globalThis as typeof globalThis & {
	__evidenceLibraryDatabaseFactory?:
		RevisionAwareDatabaseFactory<Database>;
};

const databaseFactory =
	globalDatabase.__evidenceLibraryDatabaseFactory ??
	new RevisionAwareDatabaseFactory<Database>(
		createDatabaseResource,
	);

globalDatabase.__evidenceLibraryDatabaseFactory = databaseFactory;

export function getDatabaseForConfig(
	config: Pick<
		LibraryServerConfig,
		"revision" | "services" | "updatedAt"
	>,
) {
	return databaseFactory.get({
		databaseUrl: config.services.database.url,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}

export async function getDatabase() {
	return getDatabaseForConfig(await getLibraryConfig());
}

export type { Database };
export { schema };
