import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem } from "./item/[key]/route";
import { ItemGetResponse } from "./item/types";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";

export const cachedItems = new Map<string, ItemGetResponse>();
export const cachedUserCollectionKeys = new Map<string, { private: boolean, userId: string, itemKeys: string[] }>();
export const cachedUserLikes = new Map<string, InferSelectModel<typeof usersToLikes>[]>();
export const cachedStatus: any = {};

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

export async function getCachedUserCollectionKeys(collectionId: string, ignoreCache: boolean = false) {
	let keys = cachedUserCollectionKeys.get(collectionId);
	if (!keys || ignoreCache) {
		console.log("fetching for the first time");

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
	if (Object.keys(cachedStatus).length === 0 || ignoreCache) {
		const table = await db.query.status.findFirst();
		if (table) {
			Object.keys(table).forEach(key => {
				cachedStatus[key] = table[key as keyof typeof table];
			});
		}
	}
	return cachedStatus;
}

export async function updateCachedStatus() {
	return getCachedStatus();
}