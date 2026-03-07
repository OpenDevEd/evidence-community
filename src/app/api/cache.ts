import { db } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { getItem, getItemRaw } from "./item/[key]/route";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { userCollection } from "@/db/schema/tables/userCollection";
import { status as statusTable } from "@/db/schema/tables/status";
import { getCollections } from "./collections/route";
import { Collection } from "./collections/types";
import { cacheLife, cacheTag } from "next/cache";
import { createPerfTrace, getApproxJsonBytes } from "@/lib/perf-log";

const IS_COUNTRY_LIBRARY = process.env.NEXT_PUBLIC_IS_COUNTRY_LIBRARY === "true";
const REVALIDATE = IS_COUNTRY_LIBRARY ? 60 * 60 * 24 * 30 : 60;
const REVALIDATE_COLLECTIONS = IS_COUNTRY_LIBRARY ? 60 * 60 * 24 * 30 : 300;
const EMPTY_STATUS_ID = "00000000-0000-0000-0000-000000000000";

const FALLBACK_STATUS: InferSelectModel<typeof statusTable> = {
	id: EMPTY_STATUS_ID,
	totalRecords: null,
	totalItems: null,
	databaseUpdatedAt: null,
	companyName: null,
	companyLogo: null,
	companyFooter: {},
	links: [],
	externalLinks: {},
	docsLink: null,
	style: null,
	allRISURL: null,
	allBibTeXURL: null,
	createdAt: null,
	updatedAt: null,
};

function getErrorCode(error: unknown): string | null {
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : null;
	}
	return null;
}

function getErrorMessages(error: unknown): string[] {
	const messages: string[] = [];

	if (error instanceof Error) {
		messages.push(error.message);
		if ("cause" in error && error.cause) {
			messages.push(...getErrorMessages(error.cause));
		}
	} else if (typeof error === "string") {
		messages.push(error);
	}

	return messages;
}

function isTransientDbError(error: unknown): boolean {
	const code = getErrorCode(error);
	if (
		code &&
		["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "57P03", "53300"].includes(code)
	) {
		return true;
	}

	const combinedMessage = getErrorMessages(error).join(" ").toLowerCase();
	return [
		"connection terminated unexpectedly",
		"connection reset",
		"connection closed",
		"terminating connection",
		"server closed the connection unexpectedly",
		"too many clients already",
	].some((snippet) => combinedMessage.includes(snippet));
}

async function withTransientDbRetry<T>(
	operation: () => Promise<T>,
	maxRetries: number = 2
): Promise<T> {
	let attempt = 0;
	for (;;) {
		try {
			return await operation();
		} catch (error) {
			if (!isTransientDbError(error) || attempt >= maxRetries) {
				throw error;
			}
			const backoffMs = 100 * 2 ** attempt;
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
			attempt++;
		}
	}
}

// --- Collections ---

export async function getCachedCollections() {
	'use cache'
	cacheLife({ revalidate: REVALIDATE_COLLECTIONS })
	cacheTag('collections')
	return getCollections();
}

// --- Hydrate helper (unchanged) ---

function hydrateCollections(item: NonNullable<Awaited<ReturnType<typeof getItemRaw>>["item"]>, collections: Collection[]) {
	item.collectionsData = item.collectionsAncestry
		?.map((collection) => collections.find((c) => c.key === collection))
		.filter((c) => c !== undefined) as Collection[];
	return item;
}

// --- Items (revalidate: 60s) ---

async function _getItemRawCached(key: string) {
	'use cache'
	cacheLife({ revalidate: REVALIDATE })
	cacheTag('item-' + key)
	return getItemRaw(key);
}

export async function getCachedItem(key: string, ignoreCache: boolean = false) {
	if (ignoreCache) {
		return getItem(key);
	}

	const result = await _getItemRawCached(key);

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

async function _getItemSmallCached(key: string): Promise<ReturnType<typeof getItemRaw>> {
	'use cache'
	cacheLife({ revalidate: REVALIDATE })
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
	const trace = createPerfTrace("getCachedItemSmall", {
		key,
		ignoreCache,
	});

	if (ignoreCache) {
		trace.step("fetching-uncached-item");
		const item = await getItem(key);
		trace.step("uncached-item-loaded", {
			hasItem: Boolean(item.item),
			bytes: getApproxJsonBytes(item.item),
		});
		if (!item.item) return item;
		const { fullTextPDFs, ...rest } = item.item;
		trace.end({
			hasItem: true,
			bytes: getApproxJsonBytes(rest),
		});
		return { item: stripNulls(rest) as typeof item.item };
	}

	const result = await _getItemSmallCached(key);
	trace.step("small-cache-loaded", {
		hasItem: Boolean(result?.item),
		bytes: getApproxJsonBytes(result?.item),
	});

	if (!result || !result.item) {
		trace.step("small-cache-miss-fallback");
		const item = await getItem(key);
		trace.step("fallback-item-loaded", {
			hasItem: Boolean(item.item),
			bytes: getApproxJsonBytes(item.item),
		});
		if (!item.item) return item;
		trace.end({
			hasItem: true,
			bytes: getApproxJsonBytes(item.item),
			usedFallback: true,
		});
		return { item: { ...item.item, fullTextPDFs: undefined } };
	}

	const collections = await getCachedCollections();
	trace.step("collections-loaded", {
		collectionsCount: Array.isArray(collections) ? collections.length : 0,
	});
	if (collections) {
		hydrateCollections(result.item, collections as Collection[]);
	}

	trace.end({
		hasItem: true,
		bytes: getApproxJsonBytes(result.item),
		attachmentsCount: result.item.attachmentsData?.length ?? 0,
		collectionsCount: result.item.collectionsData?.length ?? 0,
		creatorsCount: result.item.creators?.length ?? 0,
		relationsCount:
			Object.values(result.item.relations ?? {}).reduce(
				(total, relationGroup) =>
					total + (Array.isArray(relationGroup) ? relationGroup.length : 0),
				0,
			) ?? 0,
	});

	return result;
}

// --- User data (revalidate: 60s) ---

export async function getCachedUserCollectionKeys(collectionId: string) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('userCollectionKeys-' + collectionId)
	return getUserCollectionKeysDirect(collectionId);
}

export async function getUserCollectionKeysDirect(collectionId: string) {
	const collection = await db.query.userCollection.findFirst({
		where: and(
			eq(userCollection.id, collectionId),
			eq(userCollection.deleted, false)
		),
		columns: {
			private: true,
			userId: true,
		},
	});

	if (!collection) {
		return null;
	}

	const itemKeys = await db.query.itemToUserCollection.findMany({
		where: and(
			eq(itemToUserCollection.userCollectionId, collectionId),
			eq(itemToUserCollection.deleted, false)
		),
		columns: {
			itemKey: true,
		},
	});

	return {
		private: collection.private ?? false,
		userId: collection.userId,
		itemKeys: itemKeys.map((item) => item.itemKey),
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

	try {
		const newStatus = await withTransientDbRetry(() => db.query.status.findFirst());
		if (!newStatus) {
			console.error("Status not found, using fallback status");
			return FALLBACK_STATUS;
		}
		return newStatus;
	} catch (error) {
		console.error("Failed to load status, using fallback status:", error);
		return FALLBACK_STATUS;
	}
}
