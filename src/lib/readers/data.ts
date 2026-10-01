import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import {
	READER_COLLECTION_DESCRIPTION_LIMIT,
	READER_COLLECTION_NAME_LIMIT,
	readerAccount,
	readerBookmark,
	readerCollection,
	readerCollectionItem,
	readerUser,
} from "@/db/schema/tables/reader";

import { OPENSCHOLAR_PROVIDER_ID } from "./openscholar";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isReaderCollectionId(value: string) {
	return UUID_PATTERN.test(value);
}

export type ReaderCollectionSummary = {
	id: string;
	name: string;
	description: string | null;
	private: boolean;
	count: number;
	createdAt: string;
};

/** Signs the reader out everywhere and removes everything the library keeps for them. */
export async function deleteReaderByClerkUserId(database: Database, clerkUserId: string) {
	const deleted = await database
		.delete(readerUser)
		.where(
			inArray(
				readerUser.id,
				database
					.select({ userId: readerAccount.userId })
					.from(readerAccount)
					.where(and(eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID), eq(readerAccount.accountId, clerkUserId))),
			),
		)
		.returning({ id: readerUser.id });
	return deleted.length > 0;
}

async function readCollections(database: Database, userId: string, includePrivate: boolean): Promise<ReaderCollectionSummary[]> {
	const rows = await database
		.select({
			id: readerCollection.id,
			name: readerCollection.name,
			description: readerCollection.description,
			private: readerCollection.private,
			createdAt: readerCollection.createdAt,
			count: count(readerCollectionItem.itemKey),
		})
		.from(readerCollection)
		.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
		.where(and(eq(readerCollection.userId, userId), includePrivate ? undefined : eq(readerCollection.private, false)))
		.groupBy(readerCollection.id)
		.orderBy(asc(readerCollection.createdAt));
	return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

async function readBookmarks(database: Database, userId: string) {
	const rows = await database
		.select({ itemKey: readerBookmark.itemKey, createdAt: readerBookmark.createdAt })
		.from(readerBookmark)
		.where(eq(readerBookmark.userId, userId));
	return Object.fromEntries(rows.map((row) => [row.itemKey, row.createdAt.toISOString()]));
}

/** What the signed-in reader's own controls need: their bookmarks, collections and which collections hold each record. */
export async function readOwnReaderData(database: Database, userId: string) {
	const [bookmarks, collections, memberships] = await Promise.all([
		readBookmarks(database, userId),
		readCollections(database, userId, true),
		database
			.select({ collectionId: readerCollectionItem.collectionId, itemKey: readerCollectionItem.itemKey })
			.from(readerCollectionItem)
			.innerJoin(readerCollection, eq(readerCollection.id, readerCollectionItem.collectionId))
			.where(eq(readerCollection.userId, userId)),
	]);
	const itemCollections: Record<string, string[]> = {};
	for (const { collectionId, itemKey } of memberships) (itemCollections[itemKey] ??= []).push(collectionId);
	return { bookmarks, collections, itemCollections };
}

/**
 * A reader's public profile. It names the reader by name and avatar only and
 * lists their private collections only to themselves.
 */
export async function readReaderProfile(database: Database, profileUserId: string, viewerUserId: string | null) {
	const reader = await database.query.readerUser.findFirst({
		where: eq(readerUser.id, profileUserId),
		columns: { id: true, name: true, image: true },
	});
	if (!reader) return null;
	const [bookmarks, collections] = await Promise.all([
		readBookmarks(database, profileUserId),
		readCollections(database, profileUserId, viewerUserId === profileUserId),
	]);
	return { ...reader, bookmarks, collections };
}

export type ReaderListRequest = { userId: string; collectionId: string };

/**
 * The record keys of a reader's bookmarks, or of one of their collections,
 * as the viewer may see them. Someone else's private collection is refused
 * and a collection that is not the reader's does not exist here.
 */
export async function readReaderListKeys(
	database: Database,
	{ userId, collectionId }: ReaderListRequest,
	viewerUserId: string | null,
): Promise<{ keys: string[] } | { refused: 403 | 404 }> {
	if (!collectionId) {
		const rows = await database.select({ itemKey: readerBookmark.itemKey }).from(readerBookmark).where(eq(readerBookmark.userId, userId));
		return { keys: rows.map((row) => row.itemKey) };
	}
	if (!isReaderCollectionId(collectionId)) return { refused: 404 };
	const collection = await database.query.readerCollection.findFirst({
		where: and(eq(readerCollection.id, collectionId), eq(readerCollection.userId, userId)),
		columns: { private: true },
	});
	if (!collection) return { refused: 404 };
	if (collection.private && viewerUserId !== userId) return { refused: 403 };
	const rows = await database
		.select({ itemKey: readerCollectionItem.itemKey })
		.from(readerCollectionItem)
		.where(eq(readerCollectionItem.collectionId, collectionId));
	return { keys: rows.map((row) => row.itemKey) };
}

/** Adds or removes a bookmark and answers whether the record is bookmarked now. */
export async function toggleBookmark(database: Database, userId: string, itemKey: string) {
	return database.transaction(async (transaction) => {
		const removed = await transaction
			.delete(readerBookmark)
			.where(and(eq(readerBookmark.userId, userId), eq(readerBookmark.itemKey, itemKey)))
			.returning({ itemKey: readerBookmark.itemKey });
		if (removed.length > 0) return { bookmarked: false };
		await transaction.insert(readerBookmark).values({ userId, itemKey }).onConflictDoNothing();
		return { bookmarked: true };
	});
}

export const readerCollectionInputSchema = z
	.object({
		name: z.string().trim().min(1).max(READER_COLLECTION_NAME_LIMIT),
		description: z
			.string()
			.trim()
			.max(READER_COLLECTION_DESCRIPTION_LIMIT)
			.transform((value) => value || null)
			.nullable()
			.optional(),
		private: z.boolean(),
	})
	.strict();

export const readerCollectionPatchSchema = readerCollectionInputSchema.partial().strict();

export async function createReaderCollection(
	database: Database,
	userId: string,
	input: z.output<typeof readerCollectionInputSchema>,
) {
	const [collection] = await database
		.insert(readerCollection)
		.values({ userId, name: input.name, description: input.description ?? null, private: input.private })
		.returning({ id: readerCollection.id });
	return collection!;
}

function ownedCollection(userId: string, collectionId: string) {
	return and(eq(readerCollection.id, collectionId), eq(readerCollection.userId, userId));
}

/** Changes a collection the reader owns; null when they own no such collection. */
export async function updateReaderCollection(
	database: Database,
	userId: string,
	collectionId: string,
	patch: z.output<typeof readerCollectionPatchSchema>,
) {
	if (!isReaderCollectionId(collectionId)) return null;
	const [collection] = await database
		.update(readerCollection)
		.set({ ...patch, updatedAt: new Date() })
		.where(ownedCollection(userId, collectionId))
		.returning({ id: readerCollection.id });
	return collection ?? null;
}

/** Deletes a collection the reader owns. Its records stay bookmarked. */
export async function deleteReaderCollection(database: Database, userId: string, collectionId: string) {
	if (!isReaderCollectionId(collectionId)) return false;
	const deleted = await database.delete(readerCollection).where(ownedCollection(userId, collectionId)).returning({ id: readerCollection.id });
	return deleted.length > 0;
}

/**
 * Puts a record into one of the reader's own collections or takes it out.
 * Null when the reader owns no such collection.
 */
export async function toggleCollectionItem(database: Database, userId: string, collectionId: string, itemKey: string) {
	if (!isReaderCollectionId(collectionId)) return null;
	return database.transaction(async (transaction) => {
		const [collection] = await transaction
			.select({ id: readerCollection.id })
			.from(readerCollection)
			.where(ownedCollection(userId, collectionId))
			.for("update");
		if (!collection) return null;
		const removed = await transaction
			.delete(readerCollectionItem)
			.where(and(eq(readerCollectionItem.collectionId, collectionId), eq(readerCollectionItem.itemKey, itemKey)))
			.returning({ itemKey: readerCollectionItem.itemKey });
		if (removed.length > 0) return { inCollection: false };
		await transaction.insert(readerCollectionItem).values({ collectionId, itemKey }).onConflictDoNothing();
		return { inCollection: true };
	});
}
