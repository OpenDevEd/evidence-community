import { cache } from "react";
import { getDatabase, getDatabaseForConfig } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { userCollection } from "@/db/schema/tables/userCollection";
import { getItem, withoutFullText } from "./item/[key]/route";
import { and, eq, sql } from "drizzle-orm";
import { outbox } from "@opendeved/evidence-library-core";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { readPublicLibraryStatus, type PublicLibraryStatus } from "@/lib/library-export-records";
import { getCollections } from "./collections/data";
import { Collection } from "./collections/types";
import { cacheLife, cacheTag } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RuntimeCollectionConfigurationError } from "@/lib/collections";
import { staleWhileRevalidate } from "@/lib/stale-while-revalidate";

// --- Collections ---

export type CachedCollectionsResult =
	| {
			ok: true;
			collections: Collection[];
	  }
	| {
			ok: false;
			missingIds: readonly string[];
	  };

async function _getCollectionsCached(
	configRevision: string,
	config: LibraryServerConfig,
): Promise<CachedCollectionsResult> {
	"use cache";
	cacheLife({ revalidate: 300 });
	cacheTag("collections");
	try {
		return {
			ok: true,
			collections: await getCollections(config),
		};
	} catch (error) {
		if (error instanceof RuntimeCollectionConfigurationError) {
			return {
				ok: false,
				missingIds: error.missingIds,
			};
		}

		throw error;
	}
}

export async function getCachedCollectionsResult(config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	return _getCollectionsCached(libraryConfig.revision, libraryConfig);
}

export async function getCachedCollections(config?: LibraryServerConfig) {
	const result = await getCachedCollectionsResult(config);
	if (!result.ok) {
		throw new RuntimeCollectionConfigurationError(result.missingIds);
	}

	return result.collections;
}

// Share the database read within one render, without keeping an older public revision.
export const getCachedItem = cache(getItem);

/**
 * The record's public version. Every public change writes an outbox row for the
 * record (and its parent when a child changes) in the writer's own transaction.
 * Rows are never deleted, and a re-queued row takes a new id (see
 * enqueueItemSearchReprojection), so the sum of ids grows with each committed
 * change, whatever order transactions commit in.
 */
export async function readItemVersion(key: string) {
	const db = await getDatabase();
	const [row] = await db
		.select({ version: sql<string>`coalesce(sum(${outbox.id}), 0)::text` })
		.from(outbox)
		.where(and(eq(outbox.entityType, "item"), eq(outbox.entityKey, key)));
	return row?.version ?? "0";
}

// A new version or config revision is a new key, so a committed change, hide
// included, is read fresh on the next request. Old entries age out of memory.
// "Not found" is kept too. Full text is left out.
async function readCachedPublicItem(key: string, _configRevision: string, _version: string) {
	"use cache";
	cacheLife("max");
	cacheTag(`item:${key}`, "library");
	return withoutFullText(await getItem(key));
}

export const getCachedItemSmall = cache(async (key: string) => {
	const [config, version] = await Promise.all([getLibraryConfig(), readItemVersion(key)]);
	return readCachedPublicItem(key, config.revision, version);
});

// --- User data (revalidate: 60s) ---

async function _getCachedUserCollectionKeys(
	collectionId: string,
	configRevision: string,
	config: LibraryServerConfig,
) {
	"use cache";
	cacheLife({ revalidate: 60 });
	cacheTag("userCollectionKeys-" + collectionId);
	return getUserCollectionKeysDirect(collectionId, config);
}

export async function getCachedUserCollectionKeys(collectionId: string) {
	const config = await getLibraryConfig();
	return _getCachedUserCollectionKeys(collectionId, config.revision, config);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A collection's privacy, owner and record keys, or null when there is no such collection. */
export async function getUserCollectionKeysDirect(
	collectionId: string,
	config?: LibraryServerConfig,
) {
	if (!UUID_PATTERN.test(collectionId)) return null;
	const db = config
		? await getDatabaseForConfig(config)
		: await getDatabase();
	// Privacy and owner belong to the collection itself, so an empty private
	// collection stays private.
	const collection = await db.query.userCollection.findFirst({
		where: and(
			eq(userCollection.id, collectionId),
			eq(userCollection.deleted, false),
		),
		columns: { private: true, userId: true },
	});
	if (!collection) return null;
	const items = await db.query.itemToUserCollection.findMany({
		where: and(
			eq(itemToUserCollection.userCollectionId, collectionId),
			eq(itemToUserCollection.deleted, false),
		),
		columns: { itemKey: true },
	});

	return {
		private: collection.private ?? false,
		userId: collection.userId,
		itemKeys: items.map((item) => item.itemKey),
	};
}

export async function updateCachedUserCollectionKeys(collectionId: string) {
	return getUserCollectionKeysDirect(collectionId);
}

async function _getCachedUserLikes(
	userId: string,
	configRevision: string,
	config: LibraryServerConfig,
) {
	"use cache";
	cacheLife({ revalidate: 60 });
	cacheTag("userLikes-" + userId);
	return getUserLikesDirect(userId, config);
}

export async function getCachedUserLikes(userId: string) {
	const config = await getLibraryConfig();
	return _getCachedUserLikes(userId, config.revision, config);
}

export async function getUserLikesDirect(
	userId: string,
	config?: LibraryServerConfig,
) {
	const db = config
		? await getDatabaseForConfig(config)
		: await getDatabase();
	return db.query.usersToLikes.findMany({
		where: and(
			eq(usersToLikes.userId, userId),
			eq(usersToLikes.deleted, false),
		),
	});
}

/**
 * The library's public record count and last update, which every page's layout reads. Counting a large library takes
 * about a second, so the last count answers at once and a fresh one is taken behind it after a minute.
 */
export async function getCachedStatus(): Promise<PublicLibraryStatus> {
	const config = await getLibraryConfig();
	return staleWhileRevalidate(`status:${config.revision}`, 60_000, async () =>
		readPublicLibraryStatus(await getDatabaseForConfig(config), config),
	);
}
