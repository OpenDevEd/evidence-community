import { removalDoiOf } from "./removal-doi";
import { publicationTarget } from "@/db/schema/publication";
import { readStudyReading } from "@/lib/readings/reading";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { hasUnsubmittedSourceFileChoice, projectSourcePdf, readSourceFileChoices } from "./source-file-choice";
import { readSourceFields } from "./source-fields";
import { sourceTopicAssignment } from "@/db/schema/topics";
import "server-only";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";

import {
	itemDraft,
	itemIdentity,
	itemFileDraft,
	itemSourceLink,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { addedPaper, itemFilePublication } from "@/db/schema/source";
import { itemFileRemoval } from "@/db/schema/review";
import { importChecksOf } from "./import-checks";
import {
	readSourceStatuses,
	type SearchableCache,
} from "@/lib/source-ingestion/source-status";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	getIncomingLinks,
	getManualLinkKeys,
	getOutgoingLinks,
	isManualItemLinkOrigin,
} from "@/lib/links/item-links";
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
	isTopLevelAdminItemType,
} from "./item-fields";
import { readOpenAccessFromSourcesFor } from "@/lib/search-index/open-access";
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
	AdminItemLinkKeys,
	AdminItemLinkKind,
	AdminItemLinks,
	AdminItemSummary,
	AdminLibrarySnapshot,
	AdminLinkRow,
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

export function draftJson(row: typeof itemDraft.$inferSelect, payload: Record<string, unknown>): AdminItemDraft;
export function draftJson(row: typeof itemDraft.$inferSelect | null | undefined, payload: Record<string, unknown>): AdminItemDraft | null;
export function draftJson(
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

function summaryText(
	payload: Record<string, unknown>,
	published: typeof item.$inferSelect | null,
	field: "date" | "itemType" | "title",
) {
	const value = payload[field];
	return typeof value === "string" ? value : published?.[field];
}

/** The PDF a source holds, when the library publishes none: a linked PDF's address, or a Zotero file read through the admin. */
function publishedSourceFileUrl(
	published: typeof item.$inferSelect | null,
	filePublication: unknown,
	sourcePdf: ReturnType<typeof projectSourcePdf>,
) {
	if (filePublication) return null;
	if (sourcePdf) return sourcePdf.sourceFileUrl;
	return published?.contentType?.toLowerCase() === "application/pdf" && published.url ? published.url : null;
}

export function itemSummary(
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
		date: summaryText(payload, published, "date") ?? null,
		fileState: itemFileState(fileDraft, filePublication, published),
		itemType: summaryText(payload, published, "itemType") ?? "Document",
		key: draft?.itemKey ?? published!.key,
		revision: published?.revision ?? 0,
		sourceConnectionKey:
			draft?.sourceConnectionKey ??
			published?.sourceConnectionKey ??
			NATIVE_SOURCE_CONNECTION_KEY,
		state: itemState(published, draft),
		title: summaryText(payload, published, "title")?.trim() || "Untitled",
		updatedAt: dateString(draft?.updatedAt ?? published?.updatedAt),
	};
}

async function getAdminAttachments(
	db: Database,
	parentItemKey: string,
	config: Pick<LibraryServerConfig, "sources">,
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

	const [fileDraftRows, filePublicationRows, tagRows, membershipRows, removalRows, choices] =
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
			db.select({ itemKey: itemFileRemoval.itemKey }).from(itemFileRemoval).where(inArray(itemFileRemoval.itemKey, keys)),
			readSourceFileChoices(db, keys),
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
		const sourcePdf = projectSourcePdf(published, choices.get(key), Boolean(filePublication), config);
		const summary = itemSummary(
			published,
			draft,
			fileDraft,
			filePublication,
			effectivePayload,
		);
		return [
			{
				...summary,
				fileState: sourcePdf?.fileState ?? summary.fileState,
				draft: draftJson(draft, effectivePayload),
				fileDraft: sourcePdf?.fileDraft ?? fileDraftJson(fileDraft),
				filePublication: filePublicationJson(filePublication),
				fileRemovalPending: removalRows.some((row) => row.itemKey === key) || Boolean(sourcePdf?.fileRemovalPending),
				parentItem: effectiveParentItem,
				sourceFileUrl: publishedSourceFileUrl(published, filePublication, sourcePdf),
				sourcePdf: sourcePdf?.sourcePdf ?? null,
			},
		];
	});
}

export function payloadLinkKeys(
	payload: Record<string, unknown>,
): AdminItemLinkKeys | null {
	const value = payload.links;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const list = (kind: AdminItemLinkKind) =>
		Array.isArray(record[kind])
			? (record[kind] as unknown[]).filter(
					(key): key is string => typeof key === "string",
				)
			: [];
	return { cites: list("cites"), related: list("related") };
}

export async function adminItemLinks(
	db: Database,
	itemKey: string,
	keys: { keys: AdminItemLinkKeys; publishedKeys: AdminItemLinkKeys },
): Promise<AdminItemLinks> {
	const [outgoing, incoming] = await Promise.all([
		getOutgoingLinks(db, itemKey),
		getIncomingLinks(db, itemKey),
	]);
	// "related" is one link seen from both sides, so a source row pointing at this
	// record is shown like one starting here. Only "cites" keeps a direction.
	const fromSources: AdminLinkRow[] = [
		...outgoing
			.filter((row) => !isManualItemLinkOrigin(row.origin))
			.map((row) => ({ key: row.toKey, kind: row.kind, origin: row.origin })),
		...incoming
			.filter(
				(row) => row.kind === "related" && !isManualItemLinkOrigin(row.origin),
			)
			.map((row) => ({ key: row.fromKey, kind: row.kind, origin: row.origin })),
	];
	const citedBy: AdminLinkRow[] = incoming
		.filter((row) => row.kind === "cites")
		.map((row) => ({ key: row.fromKey, kind: row.kind, origin: row.origin }));
	const targetKeys = [
		...new Set([
			...keys.keys.cites,
			...keys.keys.related,
			...keys.publishedKeys.cites,
			...keys.publishedKeys.related,
			...fromSources.map((row) => row.key),
			...citedBy.map((row) => row.key),
		]),
	];
	const targetRows =
		targetKeys.length > 0
			? await db
					.select({
						deleted: item.deleted,
						itemType: item.itemType,
						key: item.key,
						title: item.title,
					})
					.from(item)
					.where(inArray(item.key, targetKeys))
			: [];
	return {
		citedBy,
		fromSources,
		keys: keys.keys,
		publishedKeys: keys.publishedKeys,
		targets: targetRows.map((row) => ({
			deleted: row.deleted === 1,
			itemType: row.itemType,
			key: row.key,
			title: row.title?.trim() || "Untitled record",
		})),
	};
}

/**
 * The OpenAlex work a record is, when a source that reads OpenAlex works holds it, or an added paper waiting for review
 * names it (its source link comes with approval): null for one found by DOI alone.
 */
/** Whether the record is a paper someone sent through Added papers. */
export const isAddedPaper = async (db: Database, itemKey: string) =>
	(await db.select({ key: addedPaper.itemKey }).from(addedPaper).where(eq(addedPaper.itemKey, itemKey)).limit(1)).length > 0;

export async function openAlexWorkOf(db: Database, itemKey: string) {
	const [links, added] = await Promise.all([
		db
			.select({ key: itemSourceLink.sourceRecordKey })
			.from(itemSourceLink)
			.innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
			.where(and(eq(itemSourceLink.itemKey, itemKey), inArray(sourceConnection.provider, [...OPENALEX_WORK_PROVIDERS]))),
		db.select({ key: addedPaper.openalexId }).from(addedPaper).where(eq(addedPaper.itemKey, itemKey)).limit(1),
	]);
	return [...links, ...added].map((row) => row.key).find((key): key is string => typeof key === "string" && /^W\d+$/u.test(key)) ?? null;
}

export async function getAdminItemDetail(
	db: Database,
	itemKey: string,
): Promise<AdminItemDetail> {
	const config = await getLibraryConfig();
	const [published, draft, fileDraft, filePublication, writeback, identity, removal, sourceFields, importedTopics, importChecks] =
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
			db.select().from(itemIdentity).where(eq(itemIdentity.key, itemKey)).limit(1).then((rows) => rows[0]),
			db.select().from(itemFileRemoval).where(eq(itemFileRemoval.itemKey, itemKey)).limit(1).then((rows) => rows[0]),
			readSourceFields(db, itemKey),
			config.topics.enabled ? db.select({topicId: sourceTopicAssignment.topicId, score: sourceTopicAssignment.score, primary: sourceTopicAssignment.primary}).from(sourceTopicAssignment).where(eq(sourceTopicAssignment.itemKey, itemKey)) : Promise.resolve([]),
			importChecksOf(db, itemKey),
		]);
	if (!identity || (!published && !draft)) throw new ItemNotFoundError(itemKey);

	const [tagRows, membershipRows, attachments, publishedLinkKeys] =
		await Promise.all([
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
			getAdminAttachments(db, itemKey, config),
			getManualLinkKeys(db, itemKey),
		]);
	const basePayload = publishedAdminItemPayload(published, {
		collectionKeys: membershipRows.map(({ key }) => key),
		hasPublishedFile: Boolean(filePublication),
		links: publishedLinkKeys,
		tags: tagRows.map(({ name }) => name),
	});
	const payload = draft
		? applyItemDraftPatch(basePayload, draft.patch)
		: basePayload;
	const topLevel = published && isTopLevelAdminItemType(published.itemType);
	const [fromSources, readingStudyType] = topLevel
		? await Promise.all([readOpenAccessFromSourcesFor(db, itemKey, payload), readStudyReading(db, itemKey)])
		: [null, null];
	const draftTags = draft ? payloadStringList(payload, "tags") : null;
	const draftCollections = draft
		? payloadStringList(payload, "collections")
		: null;
	const draftLinkKeys = payloadLinkKeys(payload) ?? publishedLinkKeys;
	const links = await adminItemLinks(db, itemKey, {
		keys: draftLinkKeys,
		publishedKeys: publishedLinkKeys,
	});
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

	const [choices, sourcePdfChangePending, openalexId, addedPaper] = await Promise.all([
		readSourceFileChoices(db, [itemKey]),
		hasUnsubmittedSourceFileChoice(db, [itemKey, ...attachments.map((attachment) => attachment.key)]),
		openAlexWorkOf(db, itemKey),
		isAddedPaper(db, parentItem ?? itemKey),
	]);
	const sourcePdf = projectSourcePdf(published, choices.get(itemKey), Boolean(filePublication), config);
	const plainSummary = itemSummary(
		published,
		draft,
		fileDraft,
		filePublication,
		payload,
	);
	const summary = { ...plainSummary, fileState: sourcePdf?.fileState ?? plainSummary.fileState };
	const attachmentFileState = attachments.reduce<AdminFileState>(
		(current, attachment) => {
			const priority: Record<AdminFileState, number> = {
				none: 0,
				unpublished: 0.5,
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
		sourceFields: sourceFields.filter(field => config.topics.enabled || field.field !== "topics"),
		importedTopics,
		importChecks,
		kind: identity.kind,
		importMethod: identity.importMethod,
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
		fileDraft: sourcePdf?.fileDraft ?? fileDraftJson(fileDraft),
		filePublication: filePublicationJson(filePublication),
		fileRemovalPending: Boolean(removal) || Boolean(sourcePdf?.fileRemovalPending),
		links,
		openalexId,
		addedPaper,
		openAccessFromSources: fromSources,
		readingStudyType,
		parentItem,
		parentState:
			parentItem && (parentPublished || parentDraft)
				? itemState(parentPublished, parentDraft)
				: null,
		published: publishedItemJson(published),
		publishedCollectionKeys: membershipRows.map(({ key }) => key),
		removalDoi: removalDoiOf(await db
			.select({ environment: publicationTarget.environment })
			.from(publicationTarget)
			.where(and(eq(publicationTarget.itemKey, itemKey), isNotNull(publicationTarget.activatedAt), isNull(publicationTarget.deactivatedAt)))),
		publishedTags: tagRows.map(({ name }) => name),
		sourceFileUrl: publishedSourceFileUrl(published, filePublication, sourcePdf),
		sourcePdf: sourcePdf?.sourcePdf ?? null,
		sourcePdfChangePending,
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

// Counting a source's searchable records reads all of them, so the admin's
// polling recounts a source only when its state changed or after a minute.
const searchableCache: SearchableCache = new Map();

export async function getAdminLibrarySnapshot(
	db: Database,
): Promise<AdminLibrarySnapshot> {
	const config = await getLibraryConfig();
	const [sourceRows, collectionCounts, statuses] = await Promise.all([
		db
			.select()
			.from(sourceConnection)
			.orderBy(asc(sourceConnection.provider), asc(sourceConnection.key)),
		db
			.select({
				count: sql<number>`count(*)::int`,
				sourceConnectionKey: collection.sourceConnectionKey,
			})
			.from(collection)
			.where(eq(collection.deleted, 0))
			.groupBy(collection.sourceConnectionKey),
		readSourceStatuses(db, {
			cache: searchableCache,
			hiddenTags: config.content.tags.hidden,
		}),
	]);
	const collectionCountBySource = new Map(
		collectionCounts.map((row) => [row.sourceConnectionKey, row.count]),
	);
	const statusBySource = new Map(statuses.map((status) => [status.key, status]));
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
			activity: statusBySource.get(row.key) ?? null,
			collectionCount: collectionCountBySource.get(row.key) ?? 0,
			externalScopeKey: row.externalScopeKey,
			key: row.key,
			label: sourceDisplayLabel(row),
			provider: row.provider,
			readOnly:
				row.provider !== NATIVE_SOURCE_CONNECTION_KEY &&
				!policy.effective,
			scopeKind: row.scopeKind,
			status: row.status,
			writeback: {
				enabled: policy.sourceEnabled,
				supported: policy.supported,
			},
		};
	});
	if (!sources.some(({ key }) => key === NATIVE_SOURCE_CONNECTION_KEY)) {
		sources.unshift({
			activity: null,
			collectionCount:
				collectionCountBySource.get(NATIVE_SOURCE_CONNECTION_KEY) ?? 0,
			externalScopeKey: null,
			key: NATIVE_SOURCE_CONNECTION_KEY,
			label: "Native",
			provider: NATIVE_SOURCE_CONNECTION_KEY,
			readOnly: false,
			scopeKind: "library",
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
