import { cache } from "react";
import { getDatabase, getDatabaseForConfig } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem, withoutFullText } from "./item/[key]/route";
import { and, eq } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { readPublicLibraryStatus, type PublicLibraryStatus } from "@/lib/library-export-records";
import { getCollections } from "./collections/data";
import { Collection } from "./collections/types";
import { cacheLife, cacheTag } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RuntimeCollectionConfigurationError } from "@/lib/collections";

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

// Kept until a writer clears `item:<key>` (see src/lib/cache-invalidation.ts).
// "Not found" is cached too, so publishing a record must clear its tag.
// The nested collections read adds its `collections` tag to every entry.
async function readCachedPublicItem(key: string, _configRevision: string) {
	"use cache";
	cacheLife("max");
	cacheTag(`item:${key}`, "library");
	return withoutFullText(await getItem(key));
}

export const getCachedItemSmall = cache(async (key: string) => {
	const config = await getLibraryConfig();
	// Workers reach the web process only through Redis; without it nothing could clear the entry.
	if (!config.services.redis) return withoutFullText(await getCachedItem(key));
	return readCachedPublicItem(key, config.revision);
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

export async function getUserCollectionKeysDirect(
	collectionId: string,
	config?: LibraryServerConfig,
) {
	const db = config
		? await getDatabaseForConfig(config)
		: await getDatabase();
	const res = await db.query.itemToUserCollection.findMany({
		where: and(
			eq(itemToUserCollection.userCollectionId, collectionId),
			eq(itemToUserCollection.deleted, false),
		),
		columns: {
			itemKey: true,
		},
		with: {
			userCollection: {
				columns: {
					private: true,
					userId: true,
				},
			},
		},
	});

	return {
		private: res[0]?.userCollection.private ?? false,
		userId: res[0]?.userCollection.userId ?? null,
		itemKeys: res.map((item) => item.itemKey),
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

async function _getCachedStatus(
	configRevision: string,
	config: LibraryServerConfig,
): Promise<PublicLibraryStatus> {
	"use cache";
	cacheLife({ revalidate: 60 });
	cacheTag("status");
	return readPublicLibraryStatus(await getDatabaseForConfig(config), config);
}

export async function getCachedStatus(): Promise<PublicLibraryStatus> {
	const config = await getLibraryConfig();
	return _getCachedStatus(config.revision, config);
}
