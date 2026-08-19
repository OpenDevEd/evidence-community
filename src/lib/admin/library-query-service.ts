import "server-only";

import {
	itemDraft,
	itemFileDraft,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { itemFilePublication } from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	evaluateSourceWritebackPolicy,
	importedItemEditBlockReason,
	resolveItemWritebackTargets,
} from "@/lib/source-writeback/policy";

import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import { sourceDisplayLabel } from "./source-label";
import {
	adminCanonicalDraftToItemFields,
	adminCanonicalPayloadToItemFields,
} from "./item-fields";
import {
	applyItemDraftPatch,
	publishedAdminItemPayload,
} from "./item-draft-patch";
import { effectiveItemParent } from "./item-draft-merge";
import { payloadStringList } from "./item-payload";
import {
	fileDraftJson,
	filePublicationJson,
	publishedItemJson,
} from "./file-projection";
import { ItemNotFoundError } from "./native-item-service";
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

function groupRowsByItemKey<T extends { itemKey: string }>(rows: T[]) {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		const group = grouped.get(row.itemKey);
		if (group) group.push(row);
		else grouped.set(row.itemKey, [row]);
	}
	return grouped;
}

function draftJson(
	row: typeof itemDraft.$inferSelect | null | undefined,
	payload: Record<string, unknown>,
): AdminItemDraft | null {
	if (!row) return null;
	return adminCanonicalDraftToItemFields({
		...row,
		createdAt: dateString(row.createdAt),
		payload,
		updatedAt: dateString(row.updatedAt),
	});
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
	draftPayload: Record<string, unknown> = {},
): AdminItemSummary {
	const payload = draft ? draftPayload : {};
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
	const publishedRows = await db
		.select()
		.from(item)
		.where(eq(item.parentItem, parentItemKey))
		.orderBy(asc(item.dateAdded), asc(item.key));
	const publishedKeys = publishedRows.map(({ key }) => key);
	const draftParentCondition = sql`${itemDraft.patch} ->> 'parentItem' = ${parentItemKey}`;
	const draftRows = await db
		.select()
		.from(itemDraft)
		.where(
			publishedKeys.length > 0
				? or(
						draftParentCondition,
						inArray(itemDraft.itemKey, publishedKeys),
					)
				: draftParentCondition,
		)
		.orderBy(asc(itemDraft.createdAt));
	const keys = [
		...new Set([
			...publishedRows.map(({ key }) => key),
			...draftRows.map(({ itemKey }) => itemKey),
		]),
	];
	if (keys.length === 0) return [];

	const [fileDraftRows, filePublicationRows, tagRows, membershipRows] =
		await Promise.all([
			db
				.select()
				.from(itemFileDraft)
				.where(inArray(itemFileDraft.itemKey, keys)),
			db
				.select()
				.from(itemFilePublication)
				.where(inArray(itemFilePublication.itemKey, keys)),
			db
				.select({ itemKey: itemToTag.itemKey, name: itemToTag.tagName })
				.from(itemToTag)
				.where(inArray(itemToTag.itemKey, keys)),
			db
				.select({
					itemKey: itemToCollection.itemKey,
					key: itemToCollection.collectionKey,
				})
				.from(itemToCollection)
				.where(inArray(itemToCollection.itemKey, keys)),
		]);
	const publishedByKey = new Map(publishedRows.map((row) => [row.key, row]));
	const draftByKey = new Map(draftRows.map((row) => [row.itemKey, row]));
	const fileDraftByKey = new Map(
		fileDraftRows.map((row) => [row.itemKey, row]),
	);
	const filePublicationByKey = new Map(
		filePublicationRows.map((row) => [row.itemKey, row]),
	);
	const tagsByKey = groupRowsByItemKey(tagRows);
	const collectionsByKey = groupRowsByItemKey(membershipRows);

	return keys.flatMap((key) => {
		const published = publishedByKey.get(key) ?? null;
		const draft = draftByKey.get(key) ?? null;
		const fileDraft = fileDraftByKey.get(key) ?? null;
		const filePublication = filePublicationByKey.get(key) ?? null;
		const basePayload = publishedAdminItemPayload(published, {
			collectionKeys:
				collectionsByKey.get(key)?.map(({ key }) => key) ?? [],
			hasPublishedFile: Boolean(filePublication),
			tags: tagsByKey.get(key)?.map(({ name }) => name) ?? [],
		});
		const effectivePayload = draft
			? applyItemDraftPatch(basePayload, draft.patch)
			: basePayload;
		const effectiveParentItem = effectiveItemParent(
			published?.parentItem,
			draft?.patch,
		);
		if (effectiveParentItem !== parentItemKey) return [];
		return [
			{
				...itemSummary(
					published,
					draft,
					fileDraft,
					filePublication,
					effectivePayload,
				),
				draft: draftJson(draft, effectivePayload),
				fileDraft: fileDraftJson(fileDraft),
				filePublication: filePublicationJson(filePublication),
				parentItem: effectiveParentItem,
				sourceFileUrl:
					!filePublication &&
					published?.contentType?.toLowerCase() ===
						"application/pdf" &&
					published.url
						? published.url
						: null,
			},
		];
	});
}

export async function getAdminItemDetail(
	db: Database,
	itemKey: string,
): Promise<AdminItemDetail> {
	const config = await getLibraryConfig();
	const [published, draft, fileDraft, filePublication, writeback] =
		await Promise.all([
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
			resolveItemWritebackTargets(db, itemKey, config),
		]);
	if (!published && !draft) throw new ItemNotFoundError(itemKey);

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
	const basePayload = publishedAdminItemPayload(published, {
		collectionKeys: membershipRows.map(({ key }) => key),
		hasPublishedFile: Boolean(filePublication),
		tags: tagRows.map(({ name }) => name),
	});
	const payload = draft
		? applyItemDraftPatch(basePayload, draft.patch)
		: basePayload;
	const draftTags = draft ? payloadStringList(payload, "tags") : null;
	const draftCollections = draft
		? payloadStringList(payload, "collections")
		: null;
	const parentItem =
		typeof payload.parentItem === "string" ? payload.parentItem : null;
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

	const summary = itemSummary(
		published,
		draft,
		fileDraft,
		filePublication,
		payload,
	);
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
		draft: draftJson(draft, payload),
		editable:
			summary.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY ||
			importedItemEditBlockReason(writeback) === null,
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
		writeback,
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
	const [sourceRows, config, collectionCounts] = await Promise.all([
		db
			.select()
			.from(sourceConnection)
			.orderBy(asc(sourceConnection.provider), asc(sourceConnection.key)),
		getLibraryConfig(),
		db
			.select({
				count: sql<number>`count(*)::int`,
				sourceConnectionKey: collection.sourceConnectionKey,
			})
			.from(collection)
			.where(eq(collection.deleted, 0))
			.groupBy(collection.sourceConnectionKey),
	]);
	const collectionCountBySource = new Map(
		collectionCounts.map((row) => [row.sourceConnectionKey, row.count]),
	);
	const sources = sourceRows.map((row) => {
		const policy = evaluateSourceWritebackPolicy(
			{
				displayName: row.displayName,
				externalScopeKey: row.externalScopeKey,
				itemEnabled: true,
				provider: row.provider,
				sourceKey: row.key,
				sourceStatus: row.status,
			},
			config,
		);
		return {
			collectionCount: collectionCountBySource.get(row.key) ?? 0,
			key: row.key,
			label: sourceDisplayLabel(row),
			provider: row.provider,
			readOnly:
				row.provider !== NATIVE_SOURCE_CONNECTION_KEY &&
				!policy.effective,
			status: row.status,
			writeback: {
				enabled: policy.sourceEnabled,
				supported: policy.supported,
			},
		};
	});
	if (!sources.some(({ key }) => key === NATIVE_SOURCE_CONNECTION_KEY)) {
		sources.unshift({
			collectionCount:
				collectionCountBySource.get(NATIVE_SOURCE_CONNECTION_KEY) ?? 0,
			key: NATIVE_SOURCE_CONNECTION_KEY,
			label: "Native",
			provider: NATIVE_SOURCE_CONNECTION_KEY,
			readOnly: false,
			status: "active",
			writeback: {
				enabled: false,
				supported: false,
			},
		});
	}

	return {
		sources,
	};
}
