import "server-only";

import { attachDatabasePool } from "@vercel/functions";

import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { Database, schema } from "./database-schema";
import { RevisionAwareDatabaseFactory } from "./factory";
import { createPostgresDatabaseResource } from "./postgres";
import { clearCacheTags } from "@/lib/cache-clearing";
import {
	cacheInvalidationForOutbox,
	publishCacheInvalidation,
	type OutboxEvent,
} from "@/lib/cache-invalidation";

// An admin change clears the pages at once, so the admin's next read shows it,
// and is published so the web process's reader logs it too.
async function clearAfterOutboxCommit(events: OutboxEvent[]) {
	const invalidation = { ...cacheInvalidationForOutbox(events, "web"), immediate: true };
	try {
		clearCacheTags(invalidation);
	} catch (error) {
		// Outside a request Next cannot clear directly; the published entry still reaches the reader.
		console.warn("[cache] Direct clear skipped", JSON.stringify({
			tags: invalidation.tags,
			error: error instanceof Error ? error.message : String(error),
		}));
	}
	await publishCacheInvalidation(await getLibraryConfig(), invalidation);
}

function createDatabaseResource(databaseUrl: string) {
	const resource = createPostgresDatabaseResource(
		databaseUrl,
		clearAfterOutboxCommit,
	);
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
