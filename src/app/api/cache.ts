import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem } from "./item/[key]/route";
import { ItemGetResponse } from "./item/types";
import { eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";

export const cachedItems = new Map<string, ItemGetResponse>();
export const cachedUserCollectionKeys = new Map<string, { private: boolean, userId: string, itemKeys: string[] }>();
export const cachedUserLikes = new Map<string, { itemKey: string, createdAt: Date }[]>();

export async function getCachedItem(key: string) {
	let item = cachedItems.get(key);
	if (!item) {
		item = await getItem(key);
		if (!item || !item.item) {
			return null;
		}
		cachedItems.set(key, item);
	}
	return item;
}

export async function getCachedUserCollectionKeys(collectionId: string, ignoreCache: boolean = false) {
	let keys = cachedUserCollectionKeys.get(collectionId);
	if (!keys || ignoreCache) {
		console.log("fetching for the first time");

		const res = await db.query.itemToUserCollection.findMany({
			where: eq(itemToUserCollection.userCollectionId, collectionId),
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
			columns: {
				itemKey: true,
				createdAt: true,
			},
		});

		cachedUserLikes.set(userId, likes);
	}

	return likes;
}