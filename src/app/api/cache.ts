import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem, getItemRaw } from "./item/[key]/route";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";
import { getCollections } from "./collections/route";
import { Collection } from "./collections/types";
import { cacheLife, cacheTag } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";

// --- Collections ---

async function _getCollectionsCached(
	configRevision: string,
	countryLibrary: boolean,
) {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 300,
	})
	cacheTag('collections')
	return getCollections();
}

export async function getCachedCollections() {
	const config = await getLibraryConfig();
	return _getCollectionsCached(
		config.revision,
		config.filters.countryLibrary,
	);
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
) {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 60,
	})
	cacheTag('item-' + key)
	return getItemRaw(key);
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
	);

	if (!result || !result.item) {
		return await getItem(key);
	}

	const collections = await getCachedCollections();
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
): Promise<ReturnType<typeof getItemRaw>> {
	'use cache'
	cacheLife({
		revalidate: countryLibrary
			? 60 * 60 * 24 * 30
			: 60,
	})
	cacheTag('item-small-' + key)
	const item = await getItemRaw(key);

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
	);

	if (!result || !result.item) {
		const item = await getItem(key);
		if (!item.item) return item;
		return { item: { ...item.item, fullTextPDFs: undefined } };
	}

	const collections = await getCachedCollections();
	if (collections) {
		hydrateCollections(result.item, collections as Collection[]);
	}

	return result;
}

// --- User data (revalidate: 60s) ---

export async function getCachedUserCollectionKeys(collectionId: string) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('userCollectionKeys-' + collectionId)
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

export async function getUserCollectionKeysDirect(collectionId: string) {
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

export async function getCachedUserLikes(userId: string) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('userLikes-' + userId)
	const likes = await db.query.usersToLikes.findMany({
		where: and(eq(usersToLikes.userId, userId), eq(usersToLikes.deleted, false)),
	});
	return likes;
}

export async function getUserLikesDirect(userId: string) {
	const likes = await db.query.usersToLikes.findMany({
		where: and(eq(usersToLikes.userId, userId), eq(usersToLikes.deleted, false)),
	});
	return likes;
}

export async function getCachedStatus(): Promise<InferSelectModel<typeof statusTable>> {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('status')
	return getStatusDirect();
}

export async function getStatusDirect(): Promise<InferSelectModel<typeof statusTable>> {
	const newStatus = await db.query.status.findFirst();
	if (!newStatus) {
		throw new Error('Status not found');
	}
	return newStatus;
}
