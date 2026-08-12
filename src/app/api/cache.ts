import { getDatabase, getDatabaseForConfig } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem, getItemRaw } from "./item/[key]/route";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";
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
	countryLibrary: boolean,
	config: LibraryServerConfig,
): Promise<CachedCollectionsResult> {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 300,
	})
	cacheTag('collections')
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

export async function getCachedCollectionsResult(
	config?: LibraryServerConfig,
) {
	const libraryConfig = config ?? await getLibraryConfig();
	return _getCollectionsCached(
		libraryConfig.revision,
		libraryConfig.filters.countryLibrary,
		libraryConfig,
	);
}

export async function getCachedCollections(
	config?: LibraryServerConfig,
) {
	const result = await getCachedCollectionsResult(config);
	if (!result.ok) {
		throw new RuntimeCollectionConfigurationError(result.missingIds);
	}

	return result.collections;
}

// --- Hydrate helper (unchanged) ---

function hydrateCollections(item: NonNullable<Awaited<ReturnType<typeof getItemRaw>>["item"]>, collections: Collection[]) {
	item.collectionsData = item.collectionsAncestry
		?.map((collection) => collections.find((c) => c.key === collection))
		.filter((c) => c !== undefined) as Collection[];
	return item;
}

// --- Items (revalidate: 60s) ---

async function _getItemRawCached(
	key: string,
	configRevision: string,
	countryLibrary: boolean,
	config: LibraryServerConfig,
) {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 60,
	})
	cacheTag('item-' + key)
	return getItemRaw(key, "meilisearch", config);
}

export async function getCachedItem(key: string, ignoreCache: boolean = false) {
	if (ignoreCache) {
		return getItem(key);
	}

	const config = await getLibraryConfig();
	const result = await _getItemRawCached(
		key,
		config.revision,
		config.filters.countryLibrary,
		config,
	);

	if (!result || !result.item) {
		return await getItem(key);
	}

	const collections = await getCachedCollections(config);
	if (collections) {
		hydrateCollections(result.item, collections as Collection[]);
	}

	return result;
}

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const result = {} as Partial<T>;
	for (const key in obj) {
		if (obj[key] !== null && obj[key] !== undefined) {
			result[key] = obj[key];
		}
	}
	return result;
}

async function _getItemSmallCached(
	key: string,
	configRevision: string,
	countryLibrary: boolean,
	config: LibraryServerConfig,
): Promise<ReturnType<typeof getItemRaw>> {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 60,
	})
	cacheTag('item-small-' + key)
	const item = await getItemRaw(key, "meilisearch", config);

	if (!item.item) {
		return item;
	}

	const { fullTextPDFs, ...rest } = item.item;

	return {
		item: stripNulls(rest) as typeof item.item,
	};
}

export async function getCachedItemSmall(key: string, ignoreCache: boolean = false) {
	if (ignoreCache) {
		const item = await getItem(key);
		if (!item.item) return item;
		const { fullTextPDFs, ...rest } = item.item;
		return { item: stripNulls(rest) as typeof item.item };
	}

	const config = await getLibraryConfig();
	const result = await _getItemSmallCached(
		key,
		config.revision,
		config.filters.countryLibrary,
		config,
	);

	if (!result || !result.item) {
		const item = await getItem(key);
		if (!item.item) return item;
		return { item: { ...item.item, fullTextPDFs: undefined } };
	}

	const collections = await getCachedCollections(config);
	if (collections) {
		hydrateCollections(result.item, collections as Collection[]);
	}

	return result;
}

// --- User data (revalidate: 60s) ---

async function _getCachedUserCollectionKeys(
	collectionId: string,
	configRevision: string,
	config: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('userCollectionKeys-' + collectionId)
	return getUserCollectionKeysDirect(collectionId, config);
}

export async function getCachedUserCollectionKeys(collectionId: string) {
	const config = await getLibraryConfig();
	return _getCachedUserCollectionKeys(
		collectionId,
		config.revision,
		config,
	);
}

export async function getUserCollectionKeysDirect(
	collectionId: string,
	config?: LibraryServerConfig,
) {
	const db = config
		? await getDatabaseForConfig(config)
		: await getDatabase();
	const res = await db.query.itemToUserCollection.findMany({
		where: and(eq(itemToUserCollection.userCollectionId, collectionId), eq(itemToUserCollection.deleted, false)),
		columns: {
			itemKey: true,
		},
		with: {
			userCollection: {
				columns: {
					private: true,
					userId: true,
				}
			}
		}
	});

	return {
		private: res[0]?.userCollection.private ?? false,
		userId: res[0]?.userCollection.userId ?? null,
		itemKeys: res.map(item => item.itemKey)
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
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('userLikes-' + userId)
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
		where: and(eq(usersToLikes.userId, userId), eq(usersToLikes.deleted, false)),
	});
}

async function _getCachedStatus(
	configRevision: string,
	config: LibraryServerConfig,
): Promise<InferSelectModel<typeof statusTable>> {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('status')
	return getStatusDirect(config);
}

export async function getCachedStatus(): Promise<InferSelectModel<typeof statusTable>> {
	const config = await getLibraryConfig();
	return _getCachedStatus(config.revision, config);
}

export async function getStatusDirect(
	config?: LibraryServerConfig,
): Promise<InferSelectModel<typeof statusTable>> {
	const db = config
		? await getDatabaseForConfig(config)
		: await getDatabase();
	const newStatus = await db.query.status.findFirst();
	if (!newStatus) {
		throw new Error('The status row is missing. Run npm run db:migrate to create it.');
	}
	return newStatus;
}
