import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem } from "./item/[key]/route";
import { ItemGetResponse } from "./item/types";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";
import { Collection } from "./collections/types";
import { getCollections } from "./collections/route";

declare global {
	let _cachedItems: Map<string, ItemGetResponse> | undefined;
	let _cachedItemsSmall: Map<string, ItemGetResponse> | undefined;
	let _cachedUserCollectionKeys: Map<string, { private: boolean, userId: string, itemKeys: string[] }> | undefined;
	let _cachedUserLikes: Map<string, InferSelectModel<typeof usersToLikes>[]> | undefined;
	let _cachedStatus: Map<string, InferSelectModel<typeof statusTable>> | undefined;
	let _cachedCollections: Map<string, Collection[]> | undefined;
}

export const cachedItems = (global as any)._cachedItems || ((global as any)._cachedItems = new Map());
export const cachedItemsSmall = (global as any)._cachedItemsSmall || ((global as any)._cachedItemsSmall = new Map());
export const cachedUserCollectionKeys = (global as any)._cachedUserCollectionKeys || ((global as any)._cachedUserCollectionKeys = new Map());
export const cachedUserLikes = (global as any)._cachedUserLikes || ((global as any)._cachedUserLikes = new Map());
export const cachedStatus = (global as any)._cachedStatus || ((global as any)._cachedStatus = new Map());
export const cachedCollections = (global as any)._cachedCollections || ((global as any)._cachedCollections = new Map());

export async function getCachedCollections(ignoreCache: boolean = false) {
	let collections = cachedCollections.get(process.env.MEILI_INDEX!);
	if (!collections || ignoreCache) {
		collections = await getCollections();
		cachedCollections.set(process.env.MEILI_INDEX!, collections);
	}
	return collections;
}

export async function getCachedItem(key: string, ignoreCache: boolean = false) {
	let item = cachedItems.get(key);
	if (!item || ignoreCache) {
		item = await getItem(key);
		if (!item || !item.item) {
			return null;
		}
		cachedItems.set(key, item);
	}
	return item;
}

export async function getCachedItemSmall(key: string, ignoreCache: boolean = false) {
	let item = cachedItemsSmall.get(key);
	console.log("cached items small", cachedItemsSmall.size);
	if (!item || ignoreCache) {
		console.log("getting item small", key);
		item = await getItem(key);
		if (!item || !item.item) {
			return null;
		}
		cachedItemsSmall.set(key, item);
	} else {
		console.log("cached item size in mb", JSON.stringify(item).length / 1024 / 1024);
	}
	return item;
}

export async function setCachedItemSmall(key: string, item: ItemGetResponse) {
	cachedItemsSmall.set(key, item);
}

export async function getCachedUserCollectionKeys(collectionId: string, ignoreCache: boolean = false) {
	let keys = cachedUserCollectionKeys.get(collectionId);
	if (!keys || ignoreCache) {
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

		const mappedRes = {
			private: res[0]?.userCollection.private ?? false,
			userId: res[0]?.userCollection.userId ?? null,
			itemKeys: res.map(item => item.itemKey)
		};
		
		cachedUserCollectionKeys.set(collectionId, mappedRes);

		keys = mappedRes;
	}

	return keys;
}

export async function updateCachedUserCollectionKeys(collectionId: string) {
	return getCachedUserCollectionKeys(collectionId, true);
}

export async function getCachedUserLikes(userId: string, ignoreCache: boolean = false) {
	let likes = cachedUserLikes.get(userId);
	if (!likes || ignoreCache) {
		likes = await db.query.usersToLikes.findMany({
			where: eq(usersToLikes.userId, userId),
		});
		cachedUserLikes.set(userId, likes);
	}
	return likes;
}

export async function getCachedStatus(ignoreCache: boolean = false): Promise<InferSelectModel<typeof statusTable>> {
	let status = cachedStatus.get(process.env.MEILI_INDEX!);
	if (!status || ignoreCache) {
		const newStatus = await db.query.status.findFirst();
		if (!newStatus) {
			throw new Error('Status not found');
		}
		status = newStatus;
		cachedStatus.set(process.env.MEILI_INDEX!, status);
	}
	return status;
}

export async function updateCachedStatus() {
	return getCachedStatus();
}