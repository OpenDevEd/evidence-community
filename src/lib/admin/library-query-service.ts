import "server-only";

import {
	itemDraft,
	itemFileDraft,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { itemFilePublication } from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";

import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import { payloadStringList } from "./item-payload";
import {
	fileDraftJson,
	filePublicationJson,
	publishedItemJson,
} from "./file-projection";
import { NativeItemNotFoundError } from "./native-item-service";
import type {
	AdminAttachment,
	AdminCollection,
	AdminCreator,
	AdminFileState,
	AdminItemDetail,
	AdminItemDraft,
	AdminItemSummary,
	AdminLibrarySnapshot,
	AdminRecordState,
} from "./types";

function dateString(value: Date | string | null | undefined) {
	if (!value) return "";
	return value instanceof Date ? value.toISOString() : value;
}

function draftJson(
	row: typeof itemDraft.$inferSelect | null | undefined,
): AdminItemDraft | null {
	if (!row) return null;
	return {
		...row,
		createdAt: dateString(row.createdAt),
		updatedAt: dateString(row.updatedAt),
	};
}

function itemState(
	published: typeof item.$inferSelect | null,
	draft: typeof itemDraft.$inferSelect | null,
): AdminRecordState {
	if (published?.deleted === 1) return "deleted";
	if (!published) return "draft";
	return draft ? "edited" : "published";
}

function itemFileState(
	fileDraft: typeof itemFileDraft.$inferSelect | null,
	filePublication: typeof itemFilePublication.$inferSelect | null,
	published: typeof item.$inferSelect | null = null,
): AdminFileState {
	if (filePublication) return "published";
	if (
		published?.itemType === "Attachment" &&
		published.deleted !== 1 &&
		published.contentType?.toLowerCase() === "application/pdf" &&
		published.url
	) {
		return "published";
	}
	if (fileDraft?.readyAt) return "staged";
	if (fileDraft) return "processing";
	return "none";
}

function itemSummary(
	published: typeof item.$inferSelect | null,
	draft: typeof itemDraft.$inferSelect | null,
	fileDraft: typeof itemFileDraft.$inferSelect | null = null,
	filePublication: typeof itemFilePublication.$inferSelect | null = null,
): AdminItemSummary {
	const payload = draft?.payload ?? {};
	return {
		creators: (payload.creators ??
			published?.creators ??
			[]) as AdminCreator[],
		date:
			typeof payload.date === "string"
				? payload.date
				: (published?.date ?? null),
		fileState: itemFileState(fileDraft, filePublication, published),
		itemType:
			typeof payload.itemType === "string"
				? payload.itemType
				: (published?.itemType ?? "Document"),
		key: draft?.itemKey ?? published!.key,
		revision: published?.revision ?? 0,
		sourceConnectionKey:
			draft?.sourceConnectionKey ??
			published?.sourceConnectionKey ??
			NATIVE_SOURCE_CONNECTION_KEY,
		state: itemState(published, draft),
		title:
			(typeof payload.title === "string"
				? payload.title
				: published?.title
			)?.trim() || "Untitled",
		updatedAt: dateString(draft?.updatedAt ?? published?.updatedAt),
	};
}

async function getAdminAttachments(
	db: Database,
	parentItemKey: string,
): Promise<AdminAttachment[]> {
	const [publishedRows, draftRows] = await Promise.all([
		db
			.select()
			.from(item)
			.where(eq(item.parentItem, parentItemKey))
			.orderBy(asc(item.dateAdded), asc(item.key)),
		db
			.select()
			.from(itemDraft)
			.where(
				sql`${itemDraft.payload} ->> 'parentItem' = ${parentItemKey}`,
			)
			.orderBy(asc(itemDraft.createdAt)),
	]);
	const keys = [
		...new Set([
			...publishedRows.map(({ key }) => key),
			...draftRows.map(({ itemKey }) => itemKey),
		]),
	];
	if (keys.length === 0) return [];

	const [fileDraftRows, filePublicationRows] = await Promise.all([
		db
			.select()
			.from(itemFileDraft)
			.where(inArray(itemFileDraft.itemKey, keys)),
		db
			.select()
			.from(itemFilePublication)
			.where(inArray(itemFilePublication.itemKey, keys)),
	]);
	const publishedByKey = new Map(publishedRows.map((row) => [row.key, row]));
	const draftByKey = new Map(draftRows.map((row) => [row.itemKey, row]));
	const fileDraftByKey = new Map(
		fileDraftRows.map((row) => [row.itemKey, row]),
	);
	const filePublicationByKey = new Map(
		filePublicationRows.map((row) => [row.itemKey, row]),
	);

	return keys.map((key) => {
		const published = publishedByKey.get(key) ?? null;
		const draft = draftByKey.get(key) ?? null;
		const fileDraft = fileDraftByKey.get(key) ?? null;
		const filePublication = filePublicationByKey.get(key) ?? null;
		return {
			...itemSummary(published, draft, fileDraft, filePublication),
			draft: draftJson(draft),
			fileDraft: fileDraftJson(fileDraft),
			filePublication: filePublicationJson(filePublication),
			parentItem: parentItemKey,
			sourceFileUrl:
				!filePublication &&
				published?.contentType?.toLowerCase() === "application/pdf" &&
				published.url
					? published.url
					: null,
		};
	});
}

export async function getAdminItemDetail(
	db: Database,
	itemKey: string,
): Promise<AdminItemDetail> {
	const [published, draft, fileDraft, filePublication] = await Promise.all([
		db
			.select()
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, itemKey))
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);
	if (!published && !draft) throw new NativeItemNotFoundError(itemKey);

	const [tagRows, membershipRows, attachments] = await Promise.all([
		published
			? db
					.select({ name: itemToTag.tagName })
					.from(itemToTag)
					.where(eq(itemToTag.itemKey, itemKey))
			: Promise.resolve([]),
		published
			? db
					.select({ key: itemToCollection.collectionKey })
					.from(itemToCollection)
					.where(eq(itemToCollection.itemKey, itemKey))
			: Promise.resolve([]),
		getAdminAttachments(db, itemKey),
	]);
	const payload = draft?.payload ?? {};
	const draftTags = draft ? payloadStringList(payload, "tags") : null;
	const draftCollections = draft
		? payloadStringList(payload, "collections")
		: null;
	const parentItem =
		typeof payload.parentItem === "string"
			? payload.parentItem
			: (published?.parentItem ?? null);
	const [parentPublished, parentDraft] = parentItem
		? await Promise.all([
				db
					.select()
					.from(item)
					.where(eq(item.key, parentItem))
					.limit(1)
					.then((rows) => rows[0] ?? null),
				db
					.select()
					.from(itemDraft)
					.where(eq(itemDraft.itemKey, parentItem))
					.limit(1)
					.then((rows) => rows[0] ?? null),
			])
		: [null, null];

	const summary = itemSummary(published, draft, fileDraft, filePublication);
	const attachmentFileState = attachments.reduce<AdminFileState>(
		(current, attachment) => {
			const priority: Record<AdminFileState, number> = {
				none: 0,
				processing: 1,
				staged: 2,
				published: 3,
			};
			return priority[attachment.fileState] > priority[current]
				? attachment.fileState
				: current;
		},
		"none",
	);

	return {
		...summary,
		fileState:
			summary.itemType === "Attachment"
				? summary.fileState
				: attachmentFileState,
		attachments,
		collectionKeys:
			draftCollections ?? membershipRows.map(({ key }) => key),
		draft: draftJson(draft),
		fileDraft: fileDraftJson(fileDraft),
		filePublication: filePublicationJson(filePublication),
		parentItem,
		parentState:
			parentItem && (parentPublished || parentDraft)
				? itemState(parentPublished, parentDraft)
				: null,
		published: publishedItemJson(published),
		publishedCollectionKeys: membershipRows.map(({ key }) => key),
		publishedTags: tagRows.map(({ name }) => name),
		sourceFileUrl:
			!filePublication &&
			published?.contentType?.toLowerCase() === "application/pdf" &&
			published.url
				? published.url
				: null,
		tags: draftTags ?? tagRows.map(({ name }) => name),
	};
}

export function toAdminCollection(
	row: typeof collection.$inferSelect,
): AdminCollection {
	return {
		deleted: row.deleted === 1,
		key: row.key,
		name: row.name?.trim() || "Untitled collection",
		parentCollection: row.parentCollection,
		revision: row.revision,
		sortOrder: row.sortOrder,
		sourceConnectionKey: row.sourceConnectionKey,
		updatedAt: dateString(row.updatedAt),
	};
}

export async function getAdminLibrarySnapshot(
	db: Database,
): Promise<AdminLibrarySnapshot> {
	const [sourceRows, collectionRows] = await Promise.all([
		db
			.select()
			.from(sourceConnection)
			.orderBy(asc(sourceConnection.provider), asc(sourceConnection.key)),
		db
			.select()
			.from(collection)
			.orderBy(
				asc(collection.sourceConnectionKey),
				sql`${collection.sortOrder} ASC NULLS LAST`,
				sql`lower(coalesce(${collection.name}, ''))`,
				asc(collection.key),
			),
	]);
	const sources = sourceRows.map((row) => ({
		key: row.key,
		label:
			row.provider === NATIVE_SOURCE_CONNECTION_KEY
				? "Native"
				: `${row.provider[0]!.toUpperCase()}${row.provider.slice(1)} · ${
						row.externalScopeKey ?? row.key
					}`,
		provider: row.provider,
		readOnly: row.provider !== NATIVE_SOURCE_CONNECTION_KEY,
		status: row.status,
	}));
	if (!sources.some(({ key }) => key === NATIVE_SOURCE_CONNECTION_KEY)) {
		sources.unshift({
			key: NATIVE_SOURCE_CONNECTION_KEY,
			label: "Native",
			provider: NATIVE_SOURCE_CONNECTION_KEY,
			readOnly: false,
			status: "active",
		});
	}

	return {
		collections: collectionRows.map(toAdminCollection),
		sources,
	};
}
