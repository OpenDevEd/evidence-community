import "server-only";

import { and, asc, count, eq, exists, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import {
	READER_COLLECTION_DESCRIPTION_LIMIT,
	READER_COLLECTION_NAME_LIMIT,
	readerAccount,
	readerBookmark,
	readerCollection,
	readerCollectionItem,
	readerCollectionMember,
	readerCollectionInvitationUse,
	readerUser,
	type ReaderCollectionRole,
} from "@/db/schema/tables/reader";

import { OPENSCHOLAR_PROVIDER_ID } from "./openscholar";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isReaderCollectionId(value: string) {
	return UUID_PATTERN.test(value);
}

/** A reader as anyone may see them: their name and avatar, never their address. */
export type ReaderPerson = { id: string; name: string; image: string | null };

export type CollectionMember = ReaderPerson & { role: ReaderCollectionRole; joinedAt: string };

/** What the signed-in reader may do with a collection: own it, edit or view what it was shared with them as, or nothing. */
export type CollectionAccess = "owner" | ReaderCollectionRole | null;

export type ReaderCollectionSummary = {
	id: string;
	name: string;
	description: string | null;
	private: boolean;
	count: number;
	createdAt: string;
	access: CollectionAccess;
	/** Who it is shared with, for its owner and its members only; empty for anyone else. */
	members: CollectionMember[];
};

/** A collection someone else owns and shared with the reader. */
export type SharedCollectionSummary = ReaderCollectionSummary & { owner: ReaderPerson; access: ReaderCollectionRole };

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

/** A collection's own columns and its record count, as every list of them shows them. */
const collectionSummaryColumns = {
	id: readerCollection.id,
	userId: readerCollection.userId,
	name: readerCollection.name,
	description: readerCollection.description,
	private: readerCollection.private,
	createdAt: readerCollection.createdAt,
	count: count(readerCollectionItem.itemKey),
};

/** The viewer is a member of the collection the query is on. */
function memberOf(database: Database, viewerUserId: string) {
	return exists(
		database
			.select({ one: sql`1` })
			.from(readerCollectionMember)
			.where(and(eq(readerCollectionMember.collectionId, readerCollection.id), eq(readerCollectionMember.userId, viewerUserId))),
	);
}

/** Each collection's members, in the order they joined. */
async function readMembers(database: Database, collectionIds: string[]) {
	const members = new Map<string, CollectionMember[]>();
	if (collectionIds.length === 0) return members;
	const rows = await database
		.select({
			collectionId: readerCollectionMember.collectionId,
			id: readerUser.id,
			name: readerUser.name,
			image: readerUser.image,
			role: readerCollectionMember.role,
			joinedAt: readerCollectionMember.createdAt,
		})
		.from(readerCollectionMember)
		.innerJoin(readerUser, eq(readerUser.id, readerCollectionMember.userId))
		.where(inArray(readerCollectionMember.collectionId, collectionIds))
		.orderBy(asc(readerCollectionMember.createdAt));
	for (const { collectionId, joinedAt, ...member } of rows) {
		const list = members.get(collectionId) ?? [];
		list.push({ ...member, joinedAt: joinedAt.toISOString() });
		members.set(collectionId, list);
	}
	return members;
}

/**
 * A reader's collections as the viewer may see them: all of them for the
 * reader, and for anyone else the public ones and the private ones shared
 * with them. Who a collection is shared with shows only to its owner and its members.
 */
async function readCollections(database: Database, ownerUserId: string, viewerUserId: string | null): Promise<ReaderCollectionSummary[]> {
	const isOwner = viewerUserId === ownerUserId;
	const rows = await database
		.select(collectionSummaryColumns)
		.from(readerCollection)
		.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
		.where(
			and(
				eq(readerCollection.userId, ownerUserId),
				isOwner ? undefined : or(eq(readerCollection.private, false), viewerUserId ? memberOf(database, viewerUserId) : undefined),
			),
		)
		.groupBy(readerCollection.id)
		.orderBy(asc(readerCollection.createdAt));
	const members = viewerUserId ? await readMembers(database, rows.map((row) => row.id)) : new Map<string, CollectionMember[]>();
	return rows.map(({ userId: _owner, ...row }) => {
		const shared = members.get(row.id) ?? [];
		const own = shared.find((member) => member.id === viewerUserId);
		const access: CollectionAccess = isOwner ? "owner" : (own?.role ?? null);
		return { ...row, createdAt: row.createdAt.toISOString(), access, members: access ? shared : [] };
	});
}

/** The collections other readers shared with this one, newest share first. */
async function readSharedCollections(database: Database, userId: string): Promise<SharedCollectionSummary[]> {
	const rows = await database
		.select({ ...collectionSummaryColumns, role: readerCollectionMember.role, sharedAt: readerCollectionMember.createdAt })
		.from(readerCollectionMember)
		.innerJoin(readerCollection, eq(readerCollection.id, readerCollectionMember.collectionId))
		.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
		.where(eq(readerCollectionMember.userId, userId))
		.groupBy(readerCollection.id, readerCollectionMember.role, readerCollectionMember.createdAt)
		.orderBy(sql`${readerCollectionMember.createdAt} desc`);
	if (rows.length === 0) return [];
	const ownerIds = [...new Set(rows.map((row) => row.userId))];
	const [owners, members] = await Promise.all([
		database.select({ id: readerUser.id, name: readerUser.name, image: readerUser.image }).from(readerUser).where(inArray(readerUser.id, ownerIds)),
		readMembers(database, rows.map((row) => row.id)),
	]);
	const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
	return rows.flatMap(({ userId: ownerId, role, sharedAt: _sharedAt, ...row }) => {
		const owner = ownerById.get(ownerId);
		return owner
			? [{ ...row, createdAt: row.createdAt.toISOString(), access: role, owner, members: members.get(row.id) ?? [] }]
			: [];
	});
}

async function readBookmarks(database: Database, userId: string) {
	const rows = await database
		.select({ itemKey: readerBookmark.itemKey, createdAt: readerBookmark.createdAt })
		.from(readerBookmark)
		.where(eq(readerBookmark.userId, userId));
	return Object.fromEntries(rows.map((row) => [row.itemKey, row.createdAt.toISOString()]));
}

/**
 * What the signed-in reader's own controls need: their bookmarks, their
 * collections, the ones shared with them, and which of the collections they
 * can add to hold each record.
 */
export async function readOwnReaderData(database: Database, userId: string) {
	const [bookmarks, collections, shared, memberships] = await Promise.all([
		readBookmarks(database, userId),
		readCollections(database, userId, userId),
		readSharedCollections(database, userId),
		database
			.select({ collectionId: readerCollectionItem.collectionId, itemKey: readerCollectionItem.itemKey })
			.from(readerCollectionItem)
			.innerJoin(readerCollection, eq(readerCollection.id, readerCollectionItem.collectionId))
			.where(or(eq(readerCollection.userId, userId), editorOf(database, userId))),
	]);
	const itemCollections: Record<string, string[]> = {};
	for (const { collectionId, itemKey } of memberships) (itemCollections[itemKey] ??= []).push(collectionId);
	return { bookmarks, collections, shared, itemCollections };
}

/** The reader is an editor of the collection the query is on. */
function editorOf(database: Database, userId: string) {
	return exists(
		database
			.select({ one: sql`1` })
			.from(readerCollectionMember)
			.where(
				and(
					eq(readerCollectionMember.collectionId, readerCollection.id),
					eq(readerCollectionMember.userId, userId),
					eq(readerCollectionMember.role, "editor"),
				),
			),
	);
}

/**
 * A reader's public profile. It names the reader by name and avatar only and
 * lists a private collection only to its owner and the people it is shared with.
 */
export async function readReaderProfile(database: Database, profileUserId: string, viewerUserId: string | null) {
	const reader = await database.query.readerUser.findFirst({
		where: eq(readerUser.id, profileUserId),
		columns: { id: true, name: true, image: true },
	});
	if (!reader) return null;
	const [bookmarks, collections] = await Promise.all([
		readBookmarks(database, profileUserId),
		readCollections(database, profileUserId, viewerUserId),
	]);
	return { ...reader, bookmarks, collections };
}

export type ReaderListRequest = { userId: string; collectionId: string };

/**
 * The record keys of a reader's bookmarks, or of one of their collections,
 * as the viewer may see them. A private collection is refused to anyone but
 * its owner and its members, and a collection that is not the reader's does
 * not exist here.
 */
async function readerListQuery(
	database: Database,
	{ userId, collectionId }: ReaderListRequest,
	viewerUserId: string | null,
) {
	if (!collectionId) {
		return { query: database.select({ itemKey: readerBookmark.itemKey }).from(readerBookmark).where(eq(readerBookmark.userId, userId)) };
	}
	if (!isReaderCollectionId(collectionId)) return { refused: 404 as const };
	const collection = await database.query.readerCollection.findFirst({
		where: and(eq(readerCollection.id, collectionId), eq(readerCollection.userId, userId)),
		columns: { private: true },
	});
	if (!collection) return { refused: 404 as const };
	if (collection.private && viewerUserId !== userId && !(viewerUserId && (await memberRole(database, collectionId, viewerUserId)))) {
		return { refused: 403 as const };
	}
	return { query: database
		.select({ itemKey: readerCollectionItem.itemKey })
		.from(readerCollectionItem)
		.where(eq(readerCollectionItem.collectionId, collectionId)) };
}

export async function readReaderListKeys(database: Database, request: ReaderListRequest, viewerUserId: string | null): Promise<{ keys: string[] } | { refused: 403 | 404 }> {
	const selection = await readerListQuery(database, request, viewerUserId);
	if (selection.refused) return { refused: selection.refused };
	const rows = await selection.query;
	return { keys: rows.map((row) => row.itemKey) };
}

/** Compare membership without sending the entire collection over the network for every export page. */
export async function readReaderListRevision(database: Database, request: ReaderListRequest, viewerUserId: string | null): Promise<{ revision: string } | { refused: 403 | 404 }> {
	const selection = await readerListQuery(database, request, viewerUserId);
	if (selection.refused) return { refused: selection.refused };
	const membership = selection.query.as("membership");
	const [state] = await database.select({ revision: sql<string>`encode(sha256(convert_to(coalesce(string_agg(${membership.itemKey}, ',' order by ${membership.itemKey} collate "C"), ''), 'UTF8')), 'hex')` }).from(membership);
	return state;
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

async function memberRole(database: Pick<Database, "select">, collectionId: string, userId: string) {
	const [member] = await database
		.select({ role: readerCollectionMember.role })
		.from(readerCollectionMember)
		.where(and(eq(readerCollectionMember.collectionId, collectionId), eq(readerCollectionMember.userId, userId)));
	return member?.role ?? null;
}

/** What the reader may do with a collection: the one check every change to it and its people goes through. */
async function collectionAccess(database: Pick<Database, "select">, userId: string, collectionId: string): Promise<CollectionAccess> {
	if (!isReaderCollectionId(collectionId)) return null;
	const [collection] = await database.select({ owner: readerCollection.userId }).from(readerCollection).where(eq(readerCollection.id, collectionId));
	if (!collection) return null;
	return collection.owner === userId ? "owner" : memberRole(database, collectionId, userId);
}

/** The name of a collection the reader owns, as its invitations' email gives it; null when they own no such collection. */
export async function ownedCollectionName(database: Pick<Database, "select">, userId: string, collectionId: string) {
	if (!isReaderCollectionId(collectionId)) return null;
	const [collection] = await database.select({ name: readerCollection.name }).from(readerCollection).where(ownedCollection(userId, collectionId));
	return collection?.name ?? null;
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
 * Puts a record into a collection the reader owns or edits, or takes it out,
 * whoever added it. Null when the reader can't change such a collection.
 */
export async function toggleCollectionItem(database: Database, userId: string, collectionId: string, itemKey: string) {
	if (!isReaderCollectionId(collectionId)) return null;
	return database.transaction(async (transaction) => {
		const [collection] = await transaction
			.select({ id: readerCollection.id })
			.from(readerCollection)
			.where(and(eq(readerCollection.id, collectionId), or(eq(readerCollection.userId, userId), editorOf(database, userId))))
			.for("update", { of: readerCollection });
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

/** The Clerk user ID OpenScholar knows the reader by, which every call about them to OpenScholar carries. */
export async function clerkUserIdOf(database: Pick<Database, "select">, userId: string) {
	const [account] = await database
		.select({ clerkUserId: readerAccount.accountId })
		.from(readerAccount)
		.where(and(eq(readerAccount.userId, userId), eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID)));
	return account?.clerkUserId ?? null;
}

/** A collection with its owner, for its invitation page. */
export async function readCollectionForInvitation(database: Database, collectionId: string) {
	if (!isReaderCollectionId(collectionId)) return null;
	const [collection] = await database
		.select({ ...collectionSummaryColumns, ownerName: readerUser.name, ownerImage: readerUser.image })
		.from(readerCollection)
		.innerJoin(readerUser, eq(readerUser.id, readerCollection.userId))
		.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
		.where(eq(readerCollection.id, collectionId))
		.groupBy(readerCollection.id, readerUser.id);
	if (!collection) return null;
	const { userId, ownerName, ownerImage, ...row } = collection;
	return { ...row, createdAt: row.createdAt.toISOString(), owner: { id: userId, name: ownerName, image: ownerImage } };
}

/**
 * Makes the reader a member once OpenScholar accepted their invitation, and
 * says whose collection it is. Each invitation makes a member once: accepting
 * it again, as a retry after a failed write does, finds the membership it
 * made, and finds none once the owner ended it. A newer invitation to someone
 * already in the collection gives them its role. `gone` when the collection
 * was deleted, `ended` when the owner ended what this invitation gave.
 */
export async function joinCollection(database: Database, invitationId: string, collectionId: string, userId: string, role: ReaderCollectionRole) {
	return database.transaction(async (transaction) => {
		const [collection] = await transaction.select({ ownerId: readerCollection.userId }).from(readerCollection).where(eq(readerCollection.id, collectionId)).for("update");
		if (!collection) return { gone: true as const };
		// The owner accepting an invitation to their own collection changes nothing.
		if (collection.ownerId === userId) return { ownerId: collection.ownerId };
		const [first] = await transaction
			.insert(readerCollectionInvitationUse)
			.values({ invitationId, collectionId, userId })
			.onConflictDoNothing()
			.returning({ invitationId: readerCollectionInvitationUse.invitationId });
		if (first) {
			await transaction
				.insert(readerCollectionMember)
				.values({ collectionId, userId, role })
				.onConflictDoUpdate({ target: [readerCollectionMember.collectionId, readerCollectionMember.userId], set: { role, updatedAt: new Date() } });
			return { ownerId: collection.ownerId };
		}
		return (await memberRole(transaction, collectionId, userId)) ? { ownerId: collection.ownerId } : { ended: true as const };
	});
}

/** Changes a member's role. Owner only; false when there is no such member. */
export async function setCollectionMemberRole(database: Database, ownerUserId: string, collectionId: string, memberUserId: string, role: ReaderCollectionRole) {
	if ((await collectionAccess(database, ownerUserId, collectionId)) !== "owner") return false;
	const updated = await database
		.update(readerCollectionMember)
		.set({ role, updatedAt: new Date() })
		.where(and(eq(readerCollectionMember.collectionId, collectionId), eq(readerCollectionMember.userId, memberUserId)))
		.returning({ userId: readerCollectionMember.userId });
	return updated.length > 0;
}

/** The owner takes someone out of a collection, or a member leaves it. False when neither applies. */
export async function removeCollectionMember(database: Database, actorUserId: string, collectionId: string, memberUserId: string) {
	if (actorUserId !== memberUserId && (await collectionAccess(database, actorUserId, collectionId)) !== "owner") return false;
	const removed = await database
		.delete(readerCollectionMember)
		.where(and(eq(readerCollectionMember.collectionId, collectionId), eq(readerCollectionMember.userId, memberUserId)))
		.returning({ userId: readerCollectionMember.userId });
	return removed.length > 0;
}
