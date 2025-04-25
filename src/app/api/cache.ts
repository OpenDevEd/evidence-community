import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem } from "./item/[key]/route";
import { ItemGetResponse } from "./item/types";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";
import { Collection } from "./collections/types";
import { getCollections } from "./collections/route";

export async function getCachedCollections(ignoreCache: boolean = false) {
	let collections: Collection[] | undefined = global?.cacheUser?.get("collections");
	if (!collections || ignoreCache) {
		collections = await getCollections();
		global?.cacheUser?.set("collections", collections);
	}
	return collections;
}

export async function getCachedItem(key: string, ignoreCache: boolean = false) {
	let item: ItemGetResponse | undefined = global?.cacheUser?.get("item" + key);
	if (!item || ignoreCache) {
		const result = await getItem(key);
		if (!result || !result.item) {
			return null as unknown as ItemGetResponse;
		}
		item = result as ItemGetResponse;
		global?.cacheUser?.set("item" + key, item);
	}
	return item;
}

export async function getCachedItemSmall(key: string, ignoreCache: boolean = false) {
	let item: ItemGetResponse | undefined = global?.cacheUser?.get("itemSmall" + key);
	if (!item || ignoreCache) {
		console.log("getting item small", key);
		const result = await getItem(key);
		if (!result || !result.item) {
			return null as unknown as ItemGetResponse;
		}
		item = result as ItemGetResponse;
		global?.cacheUser?.set("itemSmall" + key, item);
	} else {
		console.log("cached item size in mb", JSON.stringify(item).length / 1024 / 1024);
	}
	return item;
}

export async function setCachedItemSmall(key: string, item: ItemGetResponse) {
	global?.cacheUser?.set("itemSmall" + key, item);
}

export async function getCachedUserCollectionKeys(collectionId: string, ignoreCache: boolean = false) {
	let keys: any = global?.cacheUser?.get("userCollectionKeys" + collectionId);
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
		
		global?.cacheUser?.set("userCollectionKeys" + collectionId, mappedRes);

		keys = mappedRes;
	}

	return keys;
}

export async function updateCachedUserCollectionKeys(collectionId: string) {
	return getCachedUserCollectionKeys(collectionId, true);
}

export async function getCachedUserLikes(userId: string, ignoreCache: boolean = false) {
	let likes: InferSelectModel<typeof usersToLikes>[] | undefined = global?.cacheUser?.get("userLikes" + userId);
	if (!likes || ignoreCache) {
		likes = await db.query.usersToLikes.findMany({
			where: and(eq(usersToLikes.userId, userId), eq(usersToLikes.deleted, false)),
		});
		global?.cacheUser?.set("userLikes" + userId, likes);
	}
	return likes;
}

export async function setCachedUserLikes(userId: string, likes: InferSelectModel<typeof usersToLikes>[]) {
	global?.cacheUser?.set("userLikes" + userId, likes);
}

export async function getCachedStatus(ignoreCache: boolean = false): Promise<InferSelectModel<typeof statusTable>> {
	let status: InferSelectModel<typeof statusTable> | undefined = global?.cacheUser?.get("status");
	if (!status || ignoreCache) {
		const newStatus = await db.query.status.findFirst();
		if (!newStatus) {
			throw new Error('Status not found');
		}
		status = newStatus;
		global?.cacheUser?.set("status", status);
	}
	return status;
}

export async function updateCachedStatus() {
	return getCachedStatus();
}