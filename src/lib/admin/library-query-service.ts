import { readSourceFields } from "./source-fields";
import { sourceTopicAssignment } from "@/db/schema/topics";
import "server-only";

import {
	itemDraft,
	itemIdentity,
	itemFileDraft,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/database-schema";
import {
	itemFilePublication,
	itemSourceLink,
	sourceRecordIssue,
	sourceSyncRun,
	sourceSyncState,
} from "@/db/schema/source";
import { itemFileRemoval } from "@/db/schema/review";
import { AdminValidationError } from "./errors";
import { sourceSyncSummary } from "./source-sync-summary";
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
	AdminItemLinkKeys,
	AdminItemLinkKind,
	AdminItemLinks,
	AdminItemSummary,
	AdminLibrarySnapshot,
	AdminLinkRow,
	AdminRecordState,
	AdminSourceIssue,
	AdminSourceIssuesPage,
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

	const [fileDraftRows, filePublicationRows, tagRows, membershipRows, removalRows] =
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
				fileRemovalPending: removalRows.some((row) => row.itemKey === key),
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

export async function getAdminItemDetail(
	db: Database,
	itemKey: string,
): Promise<AdminItemDetail> {
	const config = await getLibraryConfig();
	const [published, draft, fileDraft, filePublication, writeback, identity, removal, sourceFields, importedTopics] =
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
			getAdminAttachments(db, itemKey),
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
		sourceFields: sourceFields.filter(field => config.topics.enabled || field.field !== "topics"),
		importedTopics,
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
		fileDraft: fileDraftJson(fileDraft),
		filePublication: filePublicationJson(filePublication),
		fileRemovalPending: Boolean(removal),
		links,
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
	const [sourceRows, config, collectionCounts, syncStates, issueCounts] =
		await Promise.all([
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
			db
				.select({
					activeRunStartedAt: sourceSyncRun.startedAt,
					lastError: sourceSyncState.lastError,
					lastFailureAt: sourceSyncState.lastFailureAt,
					lastResult: sourceSyncState.lastResult,
					lastSuccessAt: sourceSyncState.lastSuccessAt,
					leaseExpiresAt: sourceSyncState.leaseExpiresAt,
					sourceConnectionKey: sourceSyncState.sourceConnectionKey,
				})
				.from(sourceSyncState)
				.leftJoin(
					sourceSyncRun,
					eq(sourceSyncState.activeRunId, sourceSyncRun.id),
				),
			db
				.select({
					count: sql<number>`count(*)::int`,
					sourceConnectionKey: sourceRecordIssue.sourceConnectionKey,
				})
				.from(sourceRecordIssue)
				.where(isNull(sourceRecordIssue.dismissedAt))
				.groupBy(sourceRecordIssue.sourceConnectionKey),
		]);
	const collectionCountBySource = new Map(
		collectionCounts.map((row) => [row.sourceConnectionKey, row.count]),
	);
	const syncStateBySource = new Map(
		syncStates.map((row) => [row.sourceConnectionKey, row]),
	);
	const issueCountBySource = new Map(
		issueCounts.map((row) => [row.sourceConnectionKey, row.count]),
	);
	const now = new Date();
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
			sync:
				row.provider === NATIVE_SOURCE_CONNECTION_KEY
					? null
					: sourceSyncSummary({
							activeRunStartedAt: null,
							lastError: null,
							lastFailureAt: null,
							lastResult: null,
							lastSuccessAt: null,
							leaseExpiresAt: null,
							...syncStateBySource.get(row.key),
							issueCount: issueCountBySource.get(row.key) ?? 0,
							now,
							syncCursor: row.syncCursor,
						}),
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
			sync: null,
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

const ADMIN_SOURCE_ISSUE_PAGE_SIZE = 50;

type AdminSourceIssueCursor = { sourceRecordKey: string; updatedAt: string };

function encodeSourceIssueCursor(cursor: AdminSourceIssueCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSourceIssueCursor(encoded: string): AdminSourceIssueCursor {
	try {
		const parsed = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		) as Partial<AdminSourceIssueCursor>;
		// The encoder writes toISOString() output; anything else, including a
		// date JavaScript would silently normalise, is rejected before SQL.
		if (
			typeof parsed.sourceRecordKey === "string" &&
			typeof parsed.updatedAt === "string" &&
			new Date(parsed.updatedAt).toISOString() === parsed.updatedAt
		) {
			return { sourceRecordKey: parsed.sourceRecordKey, updatedAt: parsed.updatedAt };
		}
	} catch {}
	throw new AdminValidationError("The issue list cursor is not valid.", {
		cursor: "Reload the list.",
	});
}

function sourceIssueRowFilter(
	sourceConnectionKey: string,
	options: { cursor: AdminSourceIssueCursor | null; dismissed: boolean },
) {
	return and(
		eq(sourceRecordIssue.sourceConnectionKey, sourceConnectionKey),
		options.dismissed
			? isNotNull(sourceRecordIssue.dismissedAt)
			: isNull(sourceRecordIssue.dismissedAt),
		options.cursor
			? sql`(${sourceRecordIssue.updatedAt}, ${sourceRecordIssue.sourceRecordKey}) < (${options.cursor.updatedAt}::timestamptz, ${options.cursor.sourceRecordKey})`
			: undefined,
	);
}

function toAdminSourceIssue(row: {
	attachmentFilename: string | null;
	code: string;
	dismissedAt: Date | string | null;
	itemKey: string | null;
	message: string;
	sourceRecordKey: string;
	title: string | null;
	updatedAt: Date | string;
}): AdminSourceIssue {
	return {
		...row,
		attachmentFilename: row.attachmentFilename?.trim() || null,
		dismissedAt: row.dismissedAt ? dateString(row.dismissedAt) : null,
		title: row.title?.trim() || null,
		updatedAt: dateString(row.updatedAt) ?? "",
	};
}

/** Marks one saved import issue as dismissed or open again. */
export async function setAdminSourceIssueDismissed(
	db: Database,
	sourceConnectionKey: string,
	sourceRecordKey: string,
	dismissed: boolean,
) {
	const [row] = await db
		.update(sourceRecordIssue)
		.set({ dismissedAt: dismissed ? new Date() : null })
		.where(
			and(
				eq(sourceRecordIssue.sourceConnectionKey, sourceConnectionKey),
				eq(sourceRecordIssue.sourceRecordKey, sourceRecordKey),
			),
		)
		.returning({ dismissedAt: sourceRecordIssue.dismissedAt });
	if (!row) throw new ItemNotFoundError(sourceRecordKey);
	return { dismissedAt: row.dismissedAt ? dateString(row.dismissedAt) : null };
}

/** Records of one source with a saved import issue, newest first. */
export async function getAdminSourceIssues(
	db: Database,
	sourceConnectionKey: string,
	options: { cursor?: string | null; dismissed?: boolean } = {},
): Promise<AdminSourceIssuesPage> {
	// An attachment issue is shown on the record it belongs to, with the file
	// named, because that is what the reader opens in Zotero.
	const parent = alias(item, "parent");
	const filter = sourceIssueRowFilter(sourceConnectionKey, {
		cursor: options.cursor ? decodeSourceIssueCursor(options.cursor) : null,
		dismissed: Boolean(options.dismissed),
	});
	const [[totals], rows] = await Promise.all([
		db
			.select({
				dismissedTotal: sql<number>`count(*) filter (where ${sourceRecordIssue.dismissedAt} is not null)::int`,
				total: sql<number>`count(*) filter (where ${sourceRecordIssue.dismissedAt} is null)::int`,
			})
			.from(sourceRecordIssue)
			.where(eq(sourceRecordIssue.sourceConnectionKey, sourceConnectionKey)),
		db
		.select({
			attachmentFilename: sql<string | null>`case when ${item.itemType} = 'Attachment' then ${item.filename} end`,
			code: sourceRecordIssue.code,
			dismissedAt: sourceRecordIssue.dismissedAt,
			itemKey: sql<string | null>`coalesce(${parent.key}, ${item.key})`,
			message: sourceRecordIssue.message,
			sourceRecordKey: sourceRecordIssue.sourceRecordKey,
			title: sql<string | null>`coalesce(${parent.title}, ${item.title})`,
			updatedAt: sourceRecordIssue.updatedAt,
		})
		.from(sourceRecordIssue)
		.leftJoin(
			itemSourceLink,
			and(
				eq(itemSourceLink.sourceConnectionKey, sourceRecordIssue.sourceConnectionKey),
				eq(itemSourceLink.sourceRecordKey, sourceRecordIssue.sourceRecordKey),
			),
		)
		.leftJoin(item, eq(item.key, itemSourceLink.itemKey))
		.leftJoin(parent, eq(parent.key, item.parentItem))
		.where(filter)
		// Newest first; the same order the keyset cursor compares against.
		.orderBy(desc(sourceRecordIssue.updatedAt), desc(sourceRecordIssue.sourceRecordKey))
		.limit(ADMIN_SOURCE_ISSUE_PAGE_SIZE + 1),
	]);
	const hasMore = rows.length > ADMIN_SOURCE_ISSUE_PAGE_SIZE;
	const page = hasMore ? rows.slice(0, ADMIN_SOURCE_ISSUE_PAGE_SIZE) : rows;
	const last = hasMore ? page.at(-1) : undefined;
	return {
		dismissedTotal: totals?.dismissedTotal ?? 0,
		hasMore,
		issues: page.map(toAdminSourceIssue),
		nextCursor: last
			? encodeSourceIssueCursor({
					sourceRecordKey: last.sourceRecordKey,
					updatedAt: new Date(last.updatedAt).toISOString(),
				})
			: null,
		total: totals?.total ?? 0,
	};
}
