import "server-only";

import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
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

/** One page of a list of collections: its rows, which page it is of how many, and how many rows the list has. */
export type CollectionsPage<Row = ReaderCollectionSummary> = { rows: Row[]; page: number; pages: number; total: number };

/** A profile's page of collections, and the chosen one wherever it is, which the list beside them shows. */
export type ProfileCollectionsPage = CollectionsPage & { chosen: ReaderCollectionSummary | null };

/** A collection the record picker offers: the reader's own or one they edit, with its owner, and whether it holds the record. */
export type PickerCollection = ReaderCollectionSummary & { ownerId: string; owner: ReaderPerson | null; holdsRecord: boolean };

/** Most rows any page of collections holds. */
export const MAX_COLLECTIONS_PAGE_SIZE = 24;

const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));
const clampPage = (page: number, pages: number) => Math.min(Math.max(1, Math.trunc(page) || 1), pages);

/** Who may see which of a reader's collections: all of them for the reader, and for anyone else the public ones and the private ones shared with them. */
function visibleCollections(database: Database, ownerUserId: string, viewerUserId: string | null) {
	return and(
		eq(readerCollection.userId, ownerUserId),
		viewerUserId === ownerUserId ? undefined : or(eq(readerCollection.private, false), viewerUserId ? memberOf(database, viewerUserId) : undefined),
	);
}

/** Rows of a reader's collections as the viewer sees them: who each is shared with shows only to its owner and its members. */
async function asViewerSees(database: Database, rows: { id: string; createdAt: Date }[], ownerUserId: string, viewerUserId: string | null) {
	const members = viewerUserId ? await readMembers(database, rows.map((row) => row.id)) : new Map<string, CollectionMember[]>();
	return <Row extends { id: string; createdAt: Date; userId: string }>(row: Row) => {
		const { userId: _owner, ...rest } = row;
		const shared = members.get(row.id) ?? [];
		const access: CollectionAccess = viewerUserId === ownerUserId ? "owner" : (shared.find((member) => member.id === viewerUserId)?.role ?? null);
		return { ...rest, createdAt: row.createdAt.toISOString(), access, members: access ? shared : [] };
	};
}

/**
 * How many of a list's collections sort before one, oldest first: its position, from which the page it is on follows.
 * The comparison reads the collection's own row, so two made in the same instant still sort by their IDs.
 */
async function positionOf(database: Database, where: SQL | undefined, collectionId: string) {
	const chosen = alias(readerCollection, "chosen");
	const chosenRow = database.select({ createdAt: chosen.createdAt, id: chosen.id }).from(chosen).where(eq(chosen.id, collectionId));
	const [row] = await database
		.select({ before: count() })
		.from(readerCollection)
		.where(and(where, sql`(${readerCollection.createdAt}, ${readerCollection.id}) < (${chosenRow})`));
	return row?.before ?? 0;
}

/**
 * A page of a reader's collections as the viewer may see them, oldest first. Without a page asked for, it is the page
 * the chosen collection is on, so a collection opened from a link or just made is in view; the chosen collection comes
 * with it either way, for whatever shows it beside the list.
 */
export async function readProfileCollections(
	database: Database,
	ownerUserId: string,
	viewerUserId: string | null,
	request: { chosenId?: string | null; page?: number | null; pageSize: number },
): Promise<ProfileCollectionsPage> {
	const where = visibleCollections(database, ownerUserId, viewerUserId);
	const chosenId = request.chosenId && isReaderCollectionId(request.chosenId) ? request.chosenId : null;
	const [[counted], chosenRows] = await Promise.all([
		database.select({ total: count() }).from(readerCollection).where(where),
		chosenId ? collectionSummaries(database, and(where, eq(readerCollection.id, chosenId))) : [],
	]);
	const total = counted?.total ?? 0;
	const pages = pageCount(total, request.pageSize);
	const chosenRow = chosenRows[0];
	const page = clampPage(request.page ?? (chosenRow ? Math.floor((await positionOf(database, where, chosenRow.id)) / request.pageSize) + 1 : 1), pages);
	const rows = await collectionSummaries(database, where).orderBy(asc(readerCollection.createdAt), asc(readerCollection.id)).limit(request.pageSize).offset((page - 1) * request.pageSize);
	const summarize = await asViewerSees(database, chosenRow ? [...rows, chosenRow] : rows, ownerUserId, viewerUserId);
	return { rows: rows.map(summarize), chosen: chosenRow ? summarize(chosenRow) : null, page, pages, total };
}

/** Collections with their record counts, for whichever list asks. */
function collectionSummaries(database: Database, where: SQL | undefined) {
	return database
		.select(collectionSummaryColumns)
		.from(readerCollection)
		.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
		.where(where)
		.groupBy(readerCollection.id)
		.$dynamic();
}

/**
 * One page of a list of collections, kept within the list, with who each collection on it is shared with. `rowsFrom`
 * reads the page's rows from where they start.
 */
async function pageOfCollections<Row extends { id: string }>(
	database: Database,
	counted: PromiseLike<{ total: number }[]>,
	request: { page: number; pageSize: number },
	rowsFrom: (offset: number) => PromiseLike<Row[]>,
) {
	const [{ total } = { total: 0 }] = await counted;
	const pages = pageCount(total, request.pageSize);
	const page = clampPage(request.page, pages);
	const rows = await rowsFrom((page - 1) * request.pageSize);
	return { rows, members: await readMembers(database, rows.map((row) => row.id)), page, pages, total };
}

/** A page of the collections other readers shared with this one, newest share first. */
export async function readSharedCollections(database: Database, userId: string, request: { page: number; pageSize: number }): Promise<CollectionsPage<SharedCollectionSummary>> {
	const mine = eq(readerCollectionMember.userId, userId);
	const owner = alias(readerUser, "owner");
	const { rows, members, ...at } = await pageOfCollections(database, database.select({ total: count() }).from(readerCollectionMember).where(mine), request, (offset) =>
		database
			.select({ ...collectionSummaryColumns, role: readerCollectionMember.role, ownerName: owner.name, ownerImage: owner.image })
			.from(readerCollectionMember)
			.innerJoin(readerCollection, eq(readerCollection.id, readerCollectionMember.collectionId))
			.innerJoin(owner, eq(owner.id, readerCollection.userId))
			.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
			.where(mine)
			.groupBy(readerCollection.id, readerCollectionMember.role, readerCollectionMember.createdAt, owner.id)
			.orderBy(desc(readerCollectionMember.createdAt), asc(readerCollection.id))
			.limit(request.pageSize)
			.offset(offset),
	);
	return {
		...at,
		rows: rows.map(({ userId: ownerId, role, ownerName, ownerImage, ...row }) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			access: role,
			owner: { id: ownerId, name: ownerName, image: ownerImage },
			members: members.get(row.id) ?? [],
		})),
	};
}

/** `text` for a LIKE pattern that matches it anywhere, with its own wildcards taken literally. */
const containing = (text: string) => `%${text.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;

/**
 * A page of the collections a record can go into: the reader's own, newest first, then the ones shared with them that
 * they edit; or all of them by name. A search matches names and descriptions. Each says whether it holds the record.
 */
export async function readPickerCollections(
	database: Database,
	userId: string,
	request: { search: string; sort: "recent" | "name"; page: number; pageSize: number; itemKey: string | null },
): Promise<CollectionsPage<PickerCollection>> {
	const mine = eq(readerCollection.userId, userId);
	const search = request.search.trim();
	const where = and(
		or(mine, editorOf(database, userId)),
		search ? or(ilike(readerCollection.name, containing(search)), ilike(readerCollection.description, containing(search))) : undefined,
	);
	const holds = request.itemKey
		? exists(database.select({ one: sql`1` }).from(readerCollectionItem).where(and(eq(readerCollectionItem.collectionId, readerCollection.id), eq(readerCollectionItem.itemKey, request.itemKey))))
		: sql<boolean>`false`;
	// The reader's own membership: a collection shared with them is as recent as its share.
	const membership = alias(readerCollectionMember, "membership");
	const order =
		request.sort === "name"
			? [asc(sql`lower(${readerCollection.name})`), asc(readerCollection.id)]
			: [desc(sql`${mine}`), desc(sql`coalesce(${membership.createdAt}, ${readerCollection.createdAt})`), desc(readerCollection.id)];
	const owner = alias(readerUser, "owner");
	const { rows, members, ...at } = await pageOfCollections(database, database.select({ total: count() }).from(readerCollection).where(where), request, (offset) =>
		database
			.select({ ...collectionSummaryColumns, ownerName: owner.name, ownerImage: owner.image, holdsRecord: sql<boolean>`${holds}` })
			.from(readerCollection)
			.innerJoin(owner, eq(owner.id, readerCollection.userId))
			.leftJoin(membership, and(eq(membership.collectionId, readerCollection.id), eq(membership.userId, userId)))
			.leftJoin(readerCollectionItem, eq(readerCollectionItem.collectionId, readerCollection.id))
			.where(where)
			.groupBy(readerCollection.id, owner.id, membership.createdAt)
			.orderBy(...order)
			.limit(request.pageSize)
			.offset(offset),
	);
	return {
		...at,
		rows: rows.map(({ userId: ownerId, ownerName, ownerImage, ...row }) => {
			const own = ownerId === userId;
			return {
				...row,
				createdAt: row.createdAt.toISOString(),
				access: own ? ("owner" as const) : ("editor" as const),
				ownerId,
				owner: own ? null : { id: ownerId, name: ownerName, image: ownerImage },
				members: own ? (members.get(row.id) ?? []) : [],
				holdsRecord: Boolean(row.holdsRecord),
			};
		}),
	};
}

async function readBookmarks(database: Database, userId: string) {
	const rows = await database
		.select({ itemKey: readerBookmark.itemKey, createdAt: readerBookmark.createdAt })
		.from(readerBookmark)
		.where(eq(readerBookmark.userId, userId));
	return Object.fromEntries(rows.map((row) => [row.itemKey, row.createdAt.toISOString()]));
}

/** What the signed-in reader's own controls need everywhere: their bookmarks. Their collections come a page at a time where they are listed. */
export async function readOwnReaderData(database: Database, userId: string) {
	return { bookmarks: await readBookmarks(database, userId) };
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
 * A reader's public profile. It names the reader by name and avatar only, and brings the page of their collections
 * the chosen one is on; a private collection lists only to its owner and the people it is shared with. Their own
 * profile also brings the first page of the collections shared with them.
 */
export async function readReaderProfile(
	database: Database,
	profileUserId: string,
	viewerUserId: string | null,
	collections: { chosenId: string | null; pageSize: number },
) {
	const reader = await database.query.readerUser.findFirst({
		where: eq(readerUser.id, profileUserId),
		columns: { id: true, name: true, image: true },
	});
	if (!reader) return null;
	const [bookmarks, page, shared] = await Promise.all([
		readBookmarks(database, profileUserId),
		readProfileCollections(database, profileUserId, viewerUserId, { ...collections, page: null }),
		viewerUserId === profileUserId ? readSharedCollections(database, profileUserId, { page: 1, pageSize: collections.pageSize }) : null,
	]);
	return { ...reader, viewer: viewerUserId, bookmarks, collections: page, shared };
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

/**
 * The ID a reader's collection made for one request gets: the same reader and request always give the same ID, so a
 * request made again makes nothing new (OpenScholar's `requestId`).
 */
function requestedCollectionId(userId: string, requestId: string) {
	const hex = createHash("sha256").update(`${userId}\n${requestId}`).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Makes a collection for the reader once per `requestId`, and answers its ID: the collection that request made before, if it did. */
export async function createReaderCollectionOnce(
	database: Database,
	userId: string,
	input: z.output<typeof readerCollectionInputSchema>,
	requestId: string,
) {
	const id = requestedCollectionId(userId, requestId);
	await database
		.insert(readerCollection)
		.values({ id, userId, name: input.name, description: input.description ?? null, private: input.private })
		.onConflictDoNothing();
	return id;
}

/**
 * Puts records into a collection the reader owns or edits, or takes them out, whoever added them. Answers how many it
 * holds after, the keys that went in or came out, and the keys it took; `refused` when the reader can't change it (`404` no such
 * collection, `403` they may only view it). `allowed` names the keys an add may put in, read in the same transaction.
 */
export async function changeCollectionItems(
	database: Database,
	userId: string,
	collectionId: string,
	keys: string[],
	change: "add" | "remove",
	allowed: (transaction: DatabaseTransaction, keys: string[]) => Promise<string[]> = async (_transaction, all) => all,
) {
	if (!isReaderCollectionId(collectionId)) return { refused: 404 as const };
	return database.transaction(async (transaction) => {
		const access = await lockedAccess(transaction, userId, collectionId);
		if (access !== "owner" && access !== "editor") return { refused: access ? (403 as const) : (404 as const) };
		const unique = [...new Set(keys)];
		const taken = change === "add" ? await allowed(transaction, unique) : unique;
		const changed = taken.length === 0 ? [] : change === "add"
			? await transaction.insert(readerCollectionItem).values(taken.map((itemKey) => ({ collectionId, itemKey }))).onConflictDoNothing().returning({ itemKey: readerCollectionItem.itemKey })
			: await transaction.delete(readerCollectionItem).where(and(eq(readerCollectionItem.collectionId, collectionId), inArray(readerCollectionItem.itemKey, taken))).returning({ itemKey: readerCollectionItem.itemKey });
		const [held] = await transaction.select({ count: count() }).from(readerCollectionItem).where(eq(readerCollectionItem.collectionId, collectionId));
		return { count: held?.count ?? 0, changed: changed.map((row) => row.itemKey), taken };
	});
}

/**
 * The reader's access to a collection, with the collection locked, one change to it at a time as a single record's
 * toggle takes it, and their membership under a share lock, so an owner's change to their role waits for the caller's
 * transaction and a role taken away is never used after.
 */
async function lockedAccess(transaction: DatabaseTransaction, userId: string, collectionId: string): Promise<CollectionAccess> {
	const [collection] = await transaction.select({ owner: readerCollection.userId }).from(readerCollection).where(eq(readerCollection.id, collectionId)).for("update", { of: readerCollection });
	if (!collection) return null;
	if (collection.owner === userId) return "owner";
	const [member] = await transaction
		.select({ role: readerCollectionMember.role })
		.from(readerCollectionMember)
		.where(and(eq(readerCollectionMember.collectionId, collectionId), eq(readerCollectionMember.userId, userId)))
		.for("share");
	return member?.role ?? null;
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
 * Deletes a collection the reader owns, as OpenScholar asks for them. Its records stay bookmarked. With `expect`, only
 * while it still has that name and holds that many records, read under a lock: undoing a collection OpenScholar made
 * never takes away what the reader changed since. Refused (403) for someone it is shared with, 404 for anyone else.
 */
export async function deleteOwnedCollection(database: Database, userId: string, collectionId: string, expect?: { name: string; records: number }) {
	const read = await readCollectionFor(database, collectionId, userId);
	if ("refused" in read) return { refused: 404 as const };
	if (read.collection.ownerId !== userId) return { refused: read.collection.access ? (403 as const) : (404 as const) };
	return database.transaction(async (transaction) => {
		const [collection] = await transaction.select({ name: readerCollection.name }).from(readerCollection).where(ownedCollection(userId, collectionId)).for("update");
		if (!collection) return { refused: 404 as const };
		if (expect) {
			const [held] = await transaction.select({ records: count() }).from(readerCollectionItem).where(eq(readerCollectionItem.collectionId, collectionId));
			const records = held?.records ?? 0;
			if (collection.name !== expect.name || records !== expect.records) return { changed: { name: collection.name, records } };
		}
		await transaction.delete(readerCollection).where(ownedCollection(userId, collectionId));
		return { deleted: true as const };
	});
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
/** The reader an OpenScholar account signed in as, by its Clerk user ID; null for one that never signed in here. */
export async function readerIdOfClerkUser(database: Pick<Database, "select">, clerkUserId: string) {
	const [account] = await database
		.select({ userId: readerAccount.userId })
		.from(readerAccount)
		.where(and(eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID), eq(readerAccount.accountId, clerkUserId)));
	return account?.userId ?? null;
}

/** A page of the Clerk accounts that signed in here, in their order, from after `after`. */
export async function readOpenScholarReaders(database: Pick<Database, "select">, after: string | null, limit: number) {
	const rows = await database
		.select({ clerkUserId: readerAccount.accountId })
		.from(readerAccount)
		.where(and(eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID), after ? sql`${readerAccount.accountId} > ${after}` : undefined))
		.orderBy(asc(readerAccount.accountId))
		.limit(limit + 1);
	return { readers: rows.slice(0, limit).map((row) => row.clerkUserId), next: rows.length > limit ? rows[limit - 1]!.clerkUserId : null };
}

/**
 * One collection as a viewer may see it, with its owner and the viewer's access: a private one is refused to anyone
 * but its owner and its members.
 */
export async function readCollectionFor(database: Database, collectionId: string, viewerUserId: string | null) {
	if (!isReaderCollectionId(collectionId)) return { refused: 404 as const };
	const [row] = await collectionSummaries(database, eq(readerCollection.id, collectionId));
	if (!row) return { refused: 404 as const };
	const access: CollectionAccess = viewerUserId === row.userId ? "owner" : viewerUserId ? await memberRole(database, collectionId, viewerUserId) : null;
	if (row.private && !access) return { refused: 403 as const };
	const [person] = await database.select({ id: readerUser.id, name: readerUser.name, image: readerUser.image }).from(readerUser).where(eq(readerUser.id, row.userId));
	const { userId: ownerId, createdAt, ...rest } = row;
	return { collection: { ...rest, createdAt: createdAt.toISOString(), access, ownerId, owner: person ?? null } };
}

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

/**
 * Where a reader stands with the collection an invitation they accepted was to: their role in it now, `ended` once
 * the owner took them out, or `unrecorded` when the library never recorded the acceptance, which accepting finishes.
 */
export async function invitationStanding(database: Pick<Database, "select">, invitationId: string, collectionId: string, userId: string) {
	const role = await memberRole(database, collectionId, userId);
	if (role) return role;
	const [used] = await database
		.select({ invitationId: readerCollectionInvitationUse.invitationId })
		.from(readerCollectionInvitationUse)
		.where(eq(readerCollectionInvitationUse.invitationId, invitationId));
	return used ? ("ended" as const) : ("unrecorded" as const);
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
	if (!isReaderCollectionId(collectionId)) return false;
	if (actorUserId !== memberUserId && (await collectionAccess(database, actorUserId, collectionId)) !== "owner") return false;
	const removed = await database
		.delete(readerCollectionMember)
		.where(and(eq(readerCollectionMember.collectionId, collectionId), eq(readerCollectionMember.userId, memberUserId)))
		.returning({ userId: readerCollectionMember.userId });
	return removed.length > 0;
}
