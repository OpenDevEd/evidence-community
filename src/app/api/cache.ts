import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem } from "./item/[key]/route";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { status as statusTable } from "@/db/schema/tables/status";
import { getCollections } from "./collections/route";
import { unstable_cache } from "next/cache";
import { ItemGetResponse } from "./item/types";

export async function getCachedCollections(ignoreCache: boolean = false) {
	const getData = async () => {
		return await getCollections();
	}

	const cache = unstable_cache(getData, ["collections"], {
		revalidate: 60 * 60,
	});
	
	return cache();
}

export async function getCachedItem(key: string, ignoreCache: boolean = false) {
	const getData = async () => {
		return await getItem(key);
	}

	const cache = unstable_cache(getData, ["item" + key], {
		revalidate: 60,
	});
	
	return cache();
}

export async function getCachedItemSmall(key: string, ignoreCache: boolean = false) {
	const getData = async (): Promise<ReturnType<typeof getItem>> => {
		const item = await getItem(key);

		if (!item.item) {	
			return item;
		}
	
		return {
			item: {
				...item.item,
				fullTextPDFs: undefined,
			}
		};
	}

	const cache = unstable_cache(getData, ["itemSmall" + key]);
	
	return cache();
}

// export async function setCachedItemSmall(key: string, item: ItemGetResponse) {
// 	global?.cacheUser?.set("itemSmall" + key, item);
// }

export async function getCachedUserCollectionKeys(collectionId: string, ignoreCache: boolean = false) {
	const getData = async () => {
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

		return mappedRes;
	}

	const cache = unstable_cache(getData, ["userCollectionKeys" + collectionId], {
		revalidate: 60,
	});

	return cache();
}

export async function updateCachedUserCollectionKeys(collectionId: string) {
	return getCachedUserCollectionKeys(collectionId, true);
}

export async function getCachedUserLikes(userId: string, ignoreCache: boolean = false) {
	const getData = async () => {
		const likes = await db.query.usersToLikes.findMany({
			where: and(eq(usersToLikes.userId, userId), eq(usersToLikes.deleted, false)),
		});
		return likes;
	}

	const cache = unstable_cache(getData, ["userLikes" + userId], {
		revalidate: 60,
	});

	return cache();
}

// export async function setCachedUserLikes(userId: string, likes: InferSelectModel<typeof usersToLikes>[]) {
// 	global?.cacheUser?.set("userLikes" + userId, likes);
// }

export async function getCachedStatus(ignoreCache: boolean = false): Promise<InferSelectModel<typeof statusTable>> {
	const getData = async () => {
		const newStatus = await db.query.status.findFirst();
		if (!newStatus) {
			throw new Error('Status not found');
		}
		return newStatus;
	}

	const cache = unstable_cache(getData, ["status"], {
		revalidate: 60,
	});

	return cache();
}

// export async function updateCachedStatus() {
// 	return getCachedStatus();
// }