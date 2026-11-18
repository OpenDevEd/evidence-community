import type { LibraryServerConfig } from "@/config/library-config/schema";
import { resolveTopicNodes, TopicServiceError } from "@/lib/topics/catalog";
import { itemFieldOverride } from "@/db/schema/topics";
import { sourceResolutionsSchema } from "./source-field-contract";
import { publishSourceFieldOverrides, resolveSourceFieldChoices } from "./source-fields";
import type { ConflictingDraft } from "./errors";
import { sameBibliographicCreators } from "@/lib/admin/creator-profile-links";
import { LIBRARY_OWNED_PAYLOAD_FIELDS } from "@/lib/admin/item-fields";
import { isNotNull } from "drizzle-orm";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import {
	and,
	or,
	eq,
	inArray,
	isNull,
	sql,
	type InferInsertModel,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	lockItemMutation,
	lockItemMutations,
} from "@/db/canonical-mutation-lock";
import { reserveItemIdentity } from "@/db/record-identity";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication, sourceFileCleanup } from "@/db/schema/source";
import { itemReview } from "@/db/schema/review";
import { AdminValidationError } from "./errors";
import { publicationTarget } from "@/db/schema/publication";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";

import {
	collectionKeysFromPayload,
	payloadWithCollection,
} from "./item-payload";
import { resolveBibliographicDoi } from "@/lib/publication/bibliographic-doi";
import {
	existingItemKeys,
	getManualLinkKeys,
	removeMirroredSourceRelatedLinks,
	replaceManualLinks,
} from "@/lib/links/item-links";
import { ITEM_LINK_PAYLOAD_KINDS } from "./item-fields";
import {
	applyItemDraftPatch,
	createItemDraftPatch,
	editableItemDatabaseFields,
	materializeItemDraft,
	publishedAdminItemPayload,
} from "./item-draft-patch";
import { rebaseWorkingDraftAfterReview } from "./review-draft-rebase";
import type { ReviewRecord } from "./review-contract";
import { effectiveItemParent } from "./item-draft-merge";
import {
	mergeConcurrentDraftEdits,
	rebaseNativeItemDraftPayload,
} from "./item-draft-rebase";
import {
	NativeItemValidationError,
	validateNativeItemDraft,
} from "./native-item-validation";
import { NATIVE_SOURCE_CONNECTION_KEY as NATIVE_CONNECTION_KEY } from "./constants";
import { itemCollectionSourceIsAssignable } from "./item-collection-policy";
import {
	applyParentWritebackLinks,
	cascadeChildWritebackLinks,
	childItemKeys,
	enqueueFullWritebackForSources,
	enqueueSourceWritebackJob,
	ensureItemWritebackLinks,
	fullItemWritebackFields,
	markItemWritebackDirty,
} from "@/lib/source-writeback/queue";
import {
	importedItemEditBlockReason,
	resolveItemWritebackTargets,
	type SourceWritebackConfiguration,
	type SourceWritebackReason,
} from "@/lib/source-writeback/policy";
import { enqueuePublicationJobsForItem } from "@/lib/publication/queue";
import { removalDoiOf } from "./removal-doi";

type ItemInsert = InferInsertModel<typeof item>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/**
 * Records the library may manage directly: its own, and OpenAlex records,
 * which never write back. They alone can hold library attachments and notes;
 * a Zotero record's children sync back to Zotero.
 */
export function isNativeOrOpenAlex(
	executor: Executor,
	sourceConnectionKey: typeof item.sourceConnectionKey | typeof itemIdentity.sourceConnectionKey,
) {
	return or(
		eq(sourceConnectionKey, NATIVE_CONNECTION_KEY),
		inArray(
			sourceConnectionKey,
			executor.select({ key: sourceConnection.key }).from(sourceConnection).where(inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS)),
		),
	);
}
export type ItemWritebackPolicyOptions = {
	writebackConfig?: SourceWritebackConfiguration & Partial<Pick<LibraryServerConfig, "topics" | "authentication">>;
};

async function validateTopicChange(
  database: Executor,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  options: ItemWritebackPolicyOptions,
  publishingSavedDraft = false,
) {
  const before = topicList(previous.topics);
  const after = topicList(next.topics);
  if (JSON.stringify([...before].sort()) === JSON.stringify([...after].sort())) return;
  const config = options.writebackConfig;
  if (!config?.topics?.enabled && !publishingSavedDraft) throw new AdminValidationError("Topics are turned off for this community.", {topics: "Enable Topics in community configuration before changing them."});
  if (!after.length) return;
  if (!config?.authentication) throw new AdminValidationError("The topic catalog is not configured.");
  await assertCatalogTopics(database, after, config.authentication);
}

function topicList(value: unknown) {
  return Array.isArray(value) ? value as string[] : [];
}

async function assertCatalogTopics(database: Executor, topics: string[], authentication: LibraryServerConfig["authentication"]) {
  try {
    const nodes = await resolveTopicNodes(topics, {database, config: {authentication}});
    if (nodes.some(node => node.level !== "topic")) throw new TopicServiceError(404);
  } catch (error) {
    if (error instanceof TopicServiceError && error.status === 404) throw new AdminValidationError("Choose topics from the catalog.", {topics: "One or more topics no longer exist."});
    throw new AdminValidationError("The topic catalog is unavailable. Try again before saving your topics.");
  }
}

export type ItemPublishOptions = ItemWritebackPolicyOptions & {
	/** Internal review approval input, never accepted from a publication request. */
	review?: { submitted: ReviewRecord; approved: ReviewRecord };
	/**
	 * The sources this record should write back to from now on. Omit to keep
	 * the stored selection. Ignored for attachments and notes, which always
	 * follow their parent.
	 */
	sourceKeys?: readonly string[];
};

export async function advanceOpenItemDraftBaseRevision(
	executor: Executor,
	itemKey: string,
	previousRevision: number,
	nextRevision: number,
) {
	await executor
		.update(itemDraft)
		.set({ baseRevision: nextRevision })
		.where(
			and(
				eq(itemDraft.itemKey, itemKey),
				eq(itemDraft.baseRevision, previousRevision),
			),
		);
}

export class ItemNotFoundError extends Error {
	constructor(itemKey: string) {
		super(`Item was not found: ${itemKey}`);
		this.name = "ItemNotFoundError";
	}
}

export class ItemDraftConflictError extends Error {
	/** Fields changed to different values by this editor and another session. */
	readonly fields: readonly string[];

	constructor(itemKey: string, fields: readonly string[] = [], readonly conflictingDraft?: ConflictingDraft) {
		super(
			fields.length > 0
				? `Item draft changed in another session (${fields.join(", ")}): ${itemKey}`
				: `Item draft is stale: ${itemKey}`,
		);
		this.name = "ItemDraftConflictError";
		this.fields = fields;
	}
}

export class ItemMutationConflictError extends Error {
	constructor(itemKey: string) {
		super(`Item changed concurrently; retry: ${itemKey}`);
		this.name = "ItemMutationConflictError";
	}
}

export class ItemWritebackUnavailableError extends Error {
	readonly reason: SourceWritebackReason;

	constructor(itemKey: string, reason: SourceWritebackReason) {
		super(`Item writeback is unavailable (${reason}): ${itemKey}`);
		this.name = "ItemWritebackUnavailableError";
		this.reason = reason;
	}
}

export class ItemHasPublishedFileError extends Error {
	constructor(itemKey: string) {
		super(
			`Unpublish the file before unpublishing attachment metadata: ${itemKey}`,
		);
		this.name = "ItemHasPublishedFileError";
	}
}

export class ItemHasActivePublicationError extends Error {
	constructor(itemKey: string) {
		super(`Record has an active DOI publication: ${itemKey}`);
		this.name = "ItemHasActivePublicationError";
	}
}

export class ItemHasChildrenError extends Error {
	constructor(itemKey: string) {
		super(`Remove or unpublish child items first: ${itemKey}`);
		this.name = "ItemHasChildrenError";
	}
}

export class ItemParentUnavailableError extends Error {
	constructor(itemKey: string) {
		super(`Parent must be an active top-level item: ${itemKey}`);
		this.name = "ItemParentUnavailableError";
	}
}

async function requireItemDraftAccess(
	executor: Executor,
	itemKey: string,
	options: ItemWritebackPolicyOptions = {},
) {
	const [identity] = await executor
		.select({
			key: itemIdentity.key,
			sourceConnectionKey: itemIdentity.sourceConnectionKey,
			sourceRecordKey: itemIdentity.sourceRecordKey,
		})
		.from(itemIdentity)
		.where(eq(itemIdentity.key, itemKey))
		.limit(1);
	if (!identity) throw new ItemNotFoundError(itemKey);
	if (identity.sourceConnectionKey === NATIVE_CONNECTION_KEY) {
		return { identity };
	}

	// An imported record stays editable while its origin source can receive
	// writeback, even when the admin has unchecked that source for this record.
	const targets = await resolveItemWritebackTargets(
		executor,
		itemKey,
		options.writebackConfig ?? { sources: [] },
	);
	const blocked = importedItemEditBlockReason(targets);
	if (blocked) throw new ItemWritebackUnavailableError(itemKey, blocked);
	return { identity };
}

export function assertValidItemCollectionMemberships({
	baselineCollectionKeys,
	collectionRows,
	itemSourceConnectionKey,
	desiredCollectionKeys,
}: {
	baselineCollectionKeys: string[];
	collectionRows: Array<{
		deleted: number | null;
		key: string;
		sourceConnectionKey: string;
	}>;
	itemSourceConnectionKey: string;
	desiredCollectionKeys: string[];
}) {
	const collectionsByKey = new Map(
		collectionRows.map((row) => [row.key, row]),
	);
	const baselineKeys = new Set(baselineCollectionKeys);
	const baselineForeignKeys = new Set(
		baselineCollectionKeys.filter((key) => {
			const sourceConnectionKey =
				collectionsByKey.get(key)?.sourceConnectionKey;
			return (
				typeof sourceConnectionKey !== "string" ||
				!itemCollectionSourceIsAssignable(
					itemSourceConnectionKey,
					sourceConnectionKey,
				)
			);
		}),
	);
	const desiredForeignKeys = new Set<string>();

	for (const key of desiredCollectionKeys) {
		const target = collectionsByKey.get(key);
		if (!target) {
			throw new NativeItemValidationError(
				"One or more selected collections no longer exist.",
				{
					collections:
						"Refresh the page and choose an available collection.",
				},
			);
		}
		if (target.deleted === 1 && !baselineKeys.has(key)) {
			throw new NativeItemValidationError(
				"One or more selected collections have been deleted.",
				{
					collections:
						"Remove deleted collections before publishing.",
				},
			);
		}
		if (
			!itemCollectionSourceIsAssignable(
				itemSourceConnectionKey,
				target.sourceConnectionKey,
			)
		) {
			desiredForeignKeys.add(key);
		}
	}

	const unchangedForeignMemberships =
		baselineForeignKeys.size === desiredForeignKeys.size &&
		[...baselineForeignKeys].every((key) => desiredForeignKeys.has(key));
	if (!unchangedForeignMemberships) {
		throw new NativeItemValidationError(
			"Collections from another source cannot be changed here.",
			{
				collections:
					"Only collections from this record's source can be changed.",
			},
		);
	}
}

export function itemCollectionBaselineKeys(
	publishedCollectionKeys: string[],
	draftPayload: unknown,
) {
	const draftCollectionKeys = collectionKeysFromPayload(draftPayload);
	return [...new Set([...publishedCollectionKeys, ...draftCollectionKeys])];
}

export async function assertValidItemCollectionMembershipsInDatabase(
	db: Executor,
	itemKey: string | null,
	itemSourceConnectionKey: string,
	desiredCollectionKeys: string[],
) {
	const [baselineRows, existingDraft] = itemKey
		? await Promise.all([
				db
					.select({ key: itemToCollection.collectionKey })
					.from(itemToCollection)
					.where(eq(itemToCollection.itemKey, itemKey)),
				db
					.select({ patch: itemDraft.patch })
					.from(itemDraft)
					.where(eq(itemDraft.itemKey, itemKey))
					.limit(1)
					.then((rows) => rows[0] ?? null),
			])
		: [[], null];
	const baselineCollectionKeys = itemCollectionBaselineKeys(
		baselineRows.map(({ key }) => key),
		existingDraft?.patch,
	);
	const relevantKeys = [
		...new Set([...baselineCollectionKeys, ...desiredCollectionKeys]),
	];
	const collectionRows =
		relevantKeys.length > 0
			? await db
					.select({
						deleted: collection.deleted,
						key: collection.key,
						sourceConnectionKey: collection.sourceConnectionKey,
					})
					.from(collection)
					.where(inArray(collection.key, relevantKeys))
					.for("key share")
			: [];
	assertValidItemCollectionMemberships({
		baselineCollectionKeys,
		collectionRows,
		itemSourceConnectionKey,
		desiredCollectionKeys,
	});
}

async function sourceCollectionMembershipChanged(
	db: Executor,
	itemKey: string,
	sourceConnectionKey: string,
	desiredCollectionKeys: string[],
) {
	if (sourceConnectionKey === NATIVE_CONNECTION_KEY) return false;
	const [currentRows, desiredRows] = await Promise.all([
		db
			.select({ key: itemToCollection.collectionKey })
			.from(itemToCollection)
			.innerJoin(
				collection,
				eq(collection.key, itemToCollection.collectionKey),
			)
			.where(
				and(
					eq(itemToCollection.itemKey, itemKey),
					eq(collection.sourceConnectionKey, sourceConnectionKey),
				),
			),
		desiredCollectionKeys.length === 0
			? Promise.resolve([])
			: db
					.select({ key: collection.key })
					.from(collection)
					.where(
						and(
							inArray(collection.key, desiredCollectionKeys),
							eq(
								collection.sourceConnectionKey,
								sourceConnectionKey,
							),
						),
					),
	]);
	const currentKeys = new Set(currentRows.map(({ key }) => key));
	const desiredKeys = new Set(desiredRows.map(({ key }) => key));
	return (
		currentKeys.size !== desiredKeys.size ||
		[...currentKeys].some((key) => !desiredKeys.has(key))
	);
}

function publishedItemValues(
	validated: ReturnType<typeof validateNativeItemDraft>,
) {
	const snapshot = Object.fromEntries(
		editableItemDatabaseFields.map((field) => [field, null]),
	) as Partial<ItemInsert>;
	return {
		...snapshot,
		...validated.item,
	};
}

export async function loadPublishedItemPayload(
	executor: Executor,
	itemKey: string,
	published?: typeof item.$inferSelect | null,
) {
	const [publishedRow, tagRows, collectionRows, filePublication, links] =
		await Promise.all([
			published === undefined
				? executor
						.select()
						.from(item)
						.where(eq(item.key, itemKey))
						.limit(1)
						.then((rows) => rows[0] ?? null)
				: Promise.resolve(published),
			executor
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, itemKey)),
			executor
				.select({ key: itemToCollection.collectionKey })
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, itemKey)),
			executor
				.select({ itemKey: itemFilePublication.itemKey })
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1)
				.then((rows) => rows[0] ?? null),
			getManualLinkKeys(executor, itemKey),
		]);
	return publishedAdminItemPayload(publishedRow, {
		collectionKeys: collectionRows.map(({ key }) => key),
		hasPublishedFile: Boolean(filePublication),
		links,
		tags: tagRows.map(({ name }) => name),
	});
}

/** Every record this draft links to or currently links to, so publish can lock them in one sorted set. */
async function linkTargetKeys(
	executor: Executor,
	itemKey: string,
	patch: Record<string, unknown>,
) {
	const current = await getManualLinkKeys(executor, itemKey);
	const patched = patch.links;
	const fromPatch =
		patched && typeof patched === "object" && !Array.isArray(patched)
			? ITEM_LINK_PAYLOAD_KINDS.flatMap((kind) => {
					const value = (patched as Record<string, unknown>)[kind];
					return Array.isArray(value)
						? value.filter((key): key is string => typeof key === "string")
						: [];
				})
			: [];
	return [...new Set([...current.cites, ...current.related, ...fromPatch])].filter(
		(key) => key !== itemKey,
	);
}

/**
 * Writes the editor's links for a record and returns every other record whose
 * "cited by" or "related" view changed, so the caller can reindex them.
 */
/**
 * A save that says nothing about links keeps the links the editor already has.
 * Only an explicit `links` value (even empty lists) changes them.
 */
function keepLinksWhenOmitted(
	payload: unknown,
	currentPayload: Record<string, unknown>,
) {
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		Object.hasOwn(payload, "links") ||
		currentPayload.links === undefined
	) {
		return payload;
	}
	return { ...(payload as Record<string, unknown>), links: currentPayload.links };
}

function assertNoSelfLinks(
	itemKey: string,
	links: { cites: string[]; related: string[] },
) {
	for (const kind of ITEM_LINK_PAYLOAD_KINDS) {
		if (links[kind].includes(itemKey)) {
			throw new NativeItemValidationError(
				"A record cannot link to itself.",
				{ links: "A record cannot link to itself." },
			);
		}
	}
}

async function publishItemLinks(
	transaction: Transaction,
	itemKey: string,
	links: { cites: string[]; related: string[] },
) {
	assertNoSelfLinks(itemKey, links);
	const wanted = [...new Set([...links.cites, ...links.related])];
	const existing = await existingItemKeys(transaction, wanted);
	const missing = wanted.filter((key) => !existing.has(key));
	if (missing.length > 0) {
		throw new NativeItemValidationError(
			`Linked record ${missing[0]} no longer exists.`,
			{ links: `Linked record ${missing.join(", ")} no longer exists.` },
		);
	}
	const changed = new Set<string>();
	let relatedChanged = false;
	const removedRelated: string[] = [];
	for (const kind of ITEM_LINK_PAYLOAD_KINDS) {
		const result = await replaceManualLinks(transaction, {
			fromKey: itemKey,
			kind,
			toKeys: links[kind],
		});
		for (const key of [...result.added, ...result.removed]) changed.add(key);
		if (kind === "related" && (result.added.length > 0 || result.removed.length > 0)) {
			relatedChanged = true;
			removedRelated.push(...result.removed);
		}
	}
	return {
		changedTargets: [...changed].sort((left, right) => left.localeCompare(right)),
		relatedChanged,
		removedRelated,
	};
}

export async function createNativeItemDraft(db: Database, payload: unknown, options: ItemWritebackPolicyOptions = {}) {
	const validated = validateNativeItemDraft(payload, {
		allowIncompleteCreators: true,
	});

	return db.transaction(async (transaction) => {
		await validateTopicChange(transaction, {}, validated.payload, options);
		await assertValidItemCollectionMembershipsInDatabase(
			transaction,
			null,
			NATIVE_CONNECTION_KEY,
			validated.collectionKeys,
		);
		const parentItemKey = validated.item.parentItem;
		if (typeof parentItemKey === "string") {
			const [parentIdentity] = await transaction
				.select({ key: itemIdentity.key })
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.key, parentItemKey),
						isNativeOrOpenAlex(transaction, itemIdentity.sourceConnectionKey),
					),
				)
				.for("update")
				.limit(1);
			if (!parentIdentity) {
				throw new ItemParentUnavailableError(parentItemKey);
			}
			await openItemDraftInTransaction(transaction, parentItemKey);
		}
		const itemKey = await reserveItemIdentity(transaction, {
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
		});
    await transaction.update(itemIdentity).set({ kind: "created" }).where(eq(itemIdentity.key, itemKey));
		const [draft] = await transaction
			.insert(itemDraft)
			.values({
				itemKey,
				sourceConnectionKey: NATIVE_CONNECTION_KEY,
				patch: validated.payload,
			})
			.returning();

		return materializeItemDraft(draft!, {});
	});
}

/** Materialize current metadata without creating or changing a draft. */
export async function loadWorkingItemPayload(executor: Executor, itemKey: string) {
	const [draft] = await executor.select().from(itemDraft).where(eq(itemDraft.itemKey, itemKey)).limit(1);
	return applyItemDraftPatch(await loadPublishedItemPayload(executor, itemKey), draft?.patch ?? {});
}

export async function getItemDraft(db: Database, itemKey: string) {
	const [draft] = await db
		.select()
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.limit(1);
	if (!draft) {
		throw new ItemNotFoundError(itemKey);
	}
	return materializeItemDraft(
		draft,
		await loadPublishedItemPayload(db, itemKey),
	);
}

async function openItemDraftInTransaction(
	transaction: Transaction,
	itemKey: string,
	options: ItemWritebackPolicyOptions = {},
) {
	const access = await requireItemDraftAccess(transaction, itemKey, options);
	const [existingDraft] = await transaction
		.select()
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	if (existingDraft) {
		return materializeItemDraft(
			existingDraft,
			await loadPublishedItemPayload(transaction, itemKey),
		);
	}

	const [published] = await transaction
		.select()
		.from(item)
		.where(eq(item.key, itemKey))
		.for("update")
		.limit(1);
	if (!published) {
		throw new ItemNotFoundError(itemKey);
	}

	const payload = await loadPublishedItemPayload(
		transaction,
		itemKey,
		published,
	);
	const validated = validateNativeItemDraft(payload);
	const [draft] = await transaction
		.insert(itemDraft)
		.values({
			itemKey,
			sourceConnectionKey: access.identity.sourceConnectionKey,
			patch: {},
			baseRevision: published.revision,
		})
		.onConflictDoNothing()
		.returning();
	if (draft) return materializeItemDraft(draft, validated.payload);

	const [concurrentDraft] = await transaction
		.select()
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.limit(1);
	if (!concurrentDraft) {
		throw new ItemDraftConflictError(itemKey);
	}
	return materializeItemDraft(
		concurrentDraft,
		await loadPublishedItemPayload(transaction, itemKey, published),
	);
}

export async function openItemDraft(
	db: Database,
	itemKey: string,
	options: ItemWritebackPolicyOptions = {},
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		return openItemDraftInTransaction(transaction, itemKey, options);
	});
}

async function assertLockedExternalDoiUnchanged(
	transaction: Transaction,
	itemKey: string,
	payload: Record<string, unknown>,
) {
	const targets = await transaction
		.select({ lockedExternalDoi: publicationTarget.lockedExternalDoi })
		.from(publicationTarget)
		.where(
			and(
				eq(publicationTarget.itemKey, itemKey),
				eq(publicationTarget.provider, "zenodo"),
				eq(publicationTarget.identifierPolicy, "reuse-external"),
				isNull(publicationTarget.deactivatedAt),
                    isNotNull(publicationTarget.activatedAt),
			),
		);
	if (!targets.some(target => target.lockedExternalDoi)) return;
	const doi = resolveBibliographicDoi({
		DOI: typeof payload.DOI === "string" ? payload.DOI : null,
		extra: typeof payload.extra === "string" ? payload.extra : null,
	});
	if (doi.status === "resolved" && targets.every(target => !target.lockedExternalDoi || doi.doi === target.lockedExternalDoi)) return;
	throw new NativeItemValidationError(
		"The DOI cannot change after Zenodo is activated under that DOI.",
		{ DOI: "Deactivate Zenodo before changing this DOI." },
	);
}

export async function saveItemDraftInTransaction(
	transaction: Transaction,
	{
		expectedDraftGeneration,
		expectedDraftRevision,
		expectedPayload,
		itemKey,
		payload,
	}: {
		expectedDraftGeneration: string;
		expectedDraftRevision: number;
		expectedPayload: unknown;
		itemKey: string;
		payload: unknown;
	},
	options: ItemWritebackPolicyOptions = {},
) {
	const access = await requireItemDraftAccess(transaction, itemKey, options);
	const [currentDraft] = await transaction
		.select()
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	if (!currentDraft) {
		throw new ItemDraftConflictError(itemKey);
	}
	if (currentDraft.generation !== expectedDraftGeneration) {
		throw new ItemDraftConflictError(itemKey);
	}
	const [published] = await transaction
		.select()
		.from(item)
		.where(eq(item.key, itemKey))
		.for("update")
		.limit(1);
	const basePayload = await loadPublishedItemPayload(
		transaction,
		itemKey,
		published ?? null,
	);
	const currentPayload = applyItemDraftPatch(basePayload, currentDraft.patch);
	let submittedPayload = keepLinksWhenOmitted(payload, currentPayload);
	let baselinePayload = expectedPayload;
	if (currentDraft.draftRevision !== expectedDraftRevision) {
		// Another session saved this draft after the editor loaded it (for
		// example a second browser tab). Keep both sets of changes when they
		// touched different fields; refuse only a same-field disagreement.
		const merge = mergeConcurrentDraftEdits({
			currentPayload,
			expectedPayload,
			payload: submittedPayload,
		});
		if (merge.kind === "conflict") {
			throw new ItemDraftConflictError(itemKey, merge.fields, {
				generation: currentDraft.generation,
				draftRevision: currentDraft.draftRevision,
				payload: currentPayload,
			});
		}
		submittedPayload = merge.payload;
		baselinePayload = currentPayload;
	}
	const validated = rebaseNativeItemDraftPayload({
		currentPayload,
		expectedPayload: baselinePayload,
		payload: submittedPayload,
	});
	await validateTopicChange(transaction, currentPayload, validated.payload, options);
	await assertLockedExternalDoiUnchanged(transaction, itemKey, validated.payload);
	const patch = createItemDraftPatch(basePayload, validated.payload);
	assertNoSelfLinks(itemKey, validated.links);
	await assertValidItemCollectionMembershipsInDatabase(
		transaction,
		itemKey,
		access.identity.sourceConnectionKey,
		validated.collectionKeys,
	);
	const [draft] = await transaction
		.update(itemDraft)
		.set({
			baseRevision: published?.revision ?? 0,
			patch,
			draftRevision: sql`${itemDraft.draftRevision} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(itemDraft.itemKey, itemKey),
				eq(itemDraft.draftRevision, currentDraft.draftRevision),
			),
		)
		.returning();
	if (!draft) {
		throw new ItemDraftConflictError(itemKey);
	}
	return materializeItemDraft(draft, basePayload);
}

export async function saveItemDraft(
	db: Database,
	args: {
		expectedDraftGeneration?: string;
		expectedDraftRevision: number;
		expectedPayload: unknown;
		itemKey: string;
		payload: unknown;
	},
	options: ItemWritebackPolicyOptions = {},
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, args.itemKey);
		let expectedDraftGeneration = args.expectedDraftGeneration;
		if (!expectedDraftGeneration) {
			const [draft] = await transaction
				.select({ generation: itemDraft.generation })
				.from(itemDraft)
				.where(eq(itemDraft.itemKey, args.itemKey))
				.limit(1);
			if (!draft) throw new ItemDraftConflictError(args.itemKey);
			expectedDraftGeneration = draft.generation;
		}
		return saveItemDraftInTransaction(
			transaction,
			{ ...args, expectedDraftGeneration },
			options,
		);
	});
}

export async function assignItemDraftToCollection(
	db: Database,
	itemKey: string,
	collectionKey: string,
	options: ItemWritebackPolicyOptions = {},
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		await requireItemDraftAccess(transaction, itemKey, options);
		const [published] = await transaction
			.select({ key: item.key })
			.from(item)
			.where(eq(item.key, itemKey))
			.for("update")
			.limit(1);

		const [existingDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.for("update")
			.limit(1);
		const existingDraftPayload = existingDraft
			? applyItemDraftPatch(
					await loadPublishedItemPayload(transaction, itemKey),
					existingDraft.patch,
				)
			: null;
		if (
			existingDraftPayload &&
			collectionKeysFromPayload(existingDraftPayload).includes(
				collectionKey,
			)
		) {
			return { changed: false };
		}

		if (!existingDraft && published) {
			const [existingMembership] = await transaction
				.select({ itemKey: itemToCollection.itemKey })
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, itemKey),
						eq(itemToCollection.collectionKey, collectionKey),
					),
				)
				.limit(1);
			if (existingMembership) return { changed: false };
		}

		const openedDraft = existingDraft
			? null
			: await openItemDraftInTransaction(transaction, itemKey, options);
		const draftRevision =
			existingDraft?.draftRevision ?? openedDraft!.draftRevision;
		const draftPayload = existingDraftPayload ?? openedDraft!.payload;
		await saveItemDraftInTransaction(
			transaction,
			{
				expectedDraftGeneration:
					(existingDraft ?? openedDraft!).generation,
				expectedDraftRevision: draftRevision,
				expectedPayload: draftPayload,
				itemKey,
				payload: payloadWithCollection(draftPayload, collectionKey),
			},
			options,
		);
		return { changed: true };
	});
}

export async function publishItemDraftWithContext(
	db: Executor,
	itemKey: string,
	options: ItemPublishOptions = {},
) {
	const [lockCandidate, lockDraft] = await Promise.all([
		db
			.select({ parentItem: item.parentItem })
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1)
			.then((rows) => rows[0]),
		db
			.select({
				draftRevision: itemDraft.draftRevision,
				patch: itemDraft.patch,
			})
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1)
			.then((rows) => rows[0]),
	]);
	if (!lockDraft && !options.review) throw new ItemNotFoundError(itemKey);
	const publicationPatch = options.review?.approved.payload ?? lockDraft!.patch;
	const lockedParentItem = effectiveItemParent(
		options.review ? null : lockCandidate?.parentItem,
		publicationPatch,
	);
	// A top-level record also locks its attachments and notes: publishing
	// may change which sources they follow, and their own publish must not
	// copy a selection that is about to change.
	const childKeys = lockedParentItem ? [] : await childItemKeys(db, itemKey);
	const lockLinkTargets = await linkTargetKeys(db, itemKey, publicationPatch);
	const advisoryLockKeys = [
		...new Set(
			[
				itemKey,
				lockCandidate?.parentItem,
				lockedParentItem,
				...childKeys,
				...lockLinkTargets,
			].filter((key): key is string => typeof key === "string"),
		),
	];
	return db.transaction(async (transaction) => {
		await lockItemMutations(transaction, advisoryLockKeys);
		const access = await requireItemDraftAccess(
			transaction,
			itemKey,
			options,
		);
		const [initialDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1);
		if (!initialDraft && !options.review) {
			throw new ItemNotFoundError(itemKey);
		}
		const [candidate] = await transaction
			.select({ parentItem: item.parentItem })
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1);
		if (
			initialDraft?.draftRevision !== lockDraft?.draftRevision ||
			(candidate?.parentItem ?? null) !==
				(lockCandidate?.parentItem ?? null) ||
			effectiveItemParent(options.review ? null : candidate?.parentItem, options.review?.approved.payload ?? initialDraft?.patch) !==
				lockedParentItem
		) {
			throw new ItemDraftConflictError(itemKey);
		}

		const initialValidated = validateNativeItemDraft(
			options.review?.approved.payload ?? applyItemDraftPatch(
				await loadPublishedItemPayload(transaction, itemKey),
				initialDraft!.patch,
			),
			{ requireTitle: true },
		);
		const parentItemKey = initialValidated.item.parentItem;
		const relatedParentKeys = [
			...new Set(
				[parentItemKey, candidate?.parentItem].filter(
					(key): key is string => typeof key === "string",
				),
			),
		];
		const lockedItems = await transaction
			.select()
			.from(item)
			.where(inArray(item.key, advisoryLockKeys))
			.orderBy(item.key)
			.for("update");
		const lockedDrafts = await transaction
			.select()
			.from(itemDraft)
			.where(inArray(itemDraft.itemKey, advisoryLockKeys))
			.orderBy(itemDraft.itemKey)
			.for("update");
		const draft = lockedDrafts.find(
			(candidate) => candidate.itemKey === itemKey,
		);
		if ((!draft && !options.review) || draft?.draftRevision !== initialDraft?.draftRevision) {
			throw new ItemDraftConflictError(itemKey);
		}
		const current = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		const basePayload = await loadPublishedItemPayload(transaction, itemKey, current ?? null);
		const workingPayload = draft ? applyItemDraftPatch(basePayload, draft.patch) : null;
		const validated = validateNativeItemDraft(
			await resolveSourceFieldChoices(transaction, itemKey, (options.review?.approved.payload ?? workingPayload)!),
			{ requireTitle: true },
		);
		await validateTopicChange(transaction, basePayload, validated.payload, options, true);
		await assertLockedExternalDoiUnchanged(transaction, itemKey, validated.payload);
		if (validated.item.parentItem !== parentItemKey) {
			throw new ItemDraftConflictError(itemKey);
		}
		await assertValidItemCollectionMembershipsInDatabase(
			transaction,
			itemKey,
			access.identity.sourceConnectionKey,
			validated.collectionKeys,
		);
		const sourceMembershipChanged = await sourceCollectionMembershipChanged(
			transaction,
			itemKey,
			access.identity.sourceConnectionKey,
			validated.collectionKeys,
		);
		if ((current?.parentItem ?? null) !== (candidate?.parentItem ?? null)) {
			throw new ItemDraftConflictError(itemKey);
		}
		const parent =
			typeof parentItemKey === "string"
				? lockedItems.find(
						(candidate) => candidate.key === parentItemKey,
					)
				: undefined;
		const currentRevision = current?.revision ?? 0;
		if (options.review && (
			options.review.submitted.itemKey !== itemKey ||
			options.review.approved.itemKey !== itemKey ||
			options.review.submitted.baseRevision !== currentRevision
		)) throw new ItemDraftConflictError(itemKey);
		if (
			typeof parentItemKey === "string" &&
			(parentItemKey === itemKey ||
				!parent ||
				parent.deleted === 1 ||
				parent.parentItem !== null)
		) {
			throw new ItemParentUnavailableError(parentItemKey);
		}
		if (typeof parentItemKey === "string") {
			const [liveChild] = await transaction
				.select({ key: item.key })
				.from(item)
				.where(and(eq(item.parentItem, itemKey), eq(item.deleted, 0)))
				.limit(1);
			if (liveChild) {
				throw new ItemHasChildrenError(itemKey);
			}
		}

		await publishSourceFieldOverrides(transaction, itemKey, basePayload, validated.payload, { firstPublish: !current });
		await transaction.delete(itemFieldOverride).where(and(eq(itemFieldOverride.itemKey, itemKey), eq(itemFieldOverride.field, "deleted")));
		if (current?.deleted === 1) await restoreSourceChildren(transaction, itemKey);
		const reinstated = current?.deleted === 1 && current.deletedAt ? await reinstateOwnChildren(transaction, itemKey, current.deletedAt) : [];
		const nextRevision = currentRevision + 1;
		const now = new Date();
		const values = {
			...publishedItemValues(validated),
			topics: validated.item.topics ?? [],
			key: itemKey,
			sourceConnectionKey: access.identity.sourceConnectionKey,
			sourceRecordKey:
				current?.sourceRecordKey ?? access.identity.sourceRecordKey,
			revision: nextRevision,
			dateAdded: current?.dateAdded ?? now,
			dateModified: now,
			deleted: 0,
			deletedAt: null,
			withdrawnAt: null,
			withdrawalReason: null,
			updatedAt: now,
		} as ItemInsert;
		let publishedTags = validated.tags;
		if (current && validated.item.itemType === "Attachment") {
			const [filePublication] = await transaction
				.select({
					publicationTags: itemFilePublication.publicationTags,
					publicUrl: itemFilePublication.publicUrl,
				})
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1);
			if (filePublication) {
				values.url = filePublication.publicUrl;
				publishedTags = [
					...new Set([
						...validated.tags,
						...filePublication.publicationTags,
					]),
				].sort();
			}
		}

		let published;
		if (current) {
			[published] = await transaction
				.update(item)
				.set(values)
				.where(eq(item.key, itemKey))
				.returning();
		} else {
			[published] = await transaction
				.insert(item)
				.values(values)
				.returning();
		}

		await transaction
			.delete(itemToTag)
			.where(eq(itemToTag.itemKey, itemKey));
		if (publishedTags.length > 0) {
			await transaction
				.insert(tag)
				.values(publishedTags.map((name) => ({ name })))
				.onConflictDoNothing();
			await transaction.insert(itemToTag).values(
				publishedTags.map((tagName) => ({
					itemKey,
					tagName,
				})),
			);
		}

		await transaction
			.delete(itemToCollection)
			.where(eq(itemToCollection.itemKey, itemKey));
		if (validated.collectionKeys.length > 0) {
			await transaction.insert(itemToCollection).values(
				validated.collectionKeys.map((collectionKey) => ({
					itemKey,
					collectionKey,
				})),
			);
		}

		const publishedLinks = await publishItemLinks(
			transaction,
			itemKey,
			validated.links,
		);
		const changedLinkTargets = publishedLinks.changedTargets;
		if (
			changedLinkTargets.some((key) => !advisoryLockKeys.includes(key))
		) {
			throw new ItemDraftConflictError(itemKey);
		}
		if (publishedLinks.removedRelated.length > 0) {
			const writebackSources = await transaction
				.select({ sourceConnectionKey: itemSourceLink.sourceConnectionKey })
				.from(itemSourceLink)
				.where(
					and(
						eq(itemSourceLink.itemKey, itemKey),
						eq(itemSourceLink.writebackEnabled, true),
					),
				);
			await removeMirroredSourceRelatedLinks(transaction, {
				itemKey,
				sourceConnectionKeys: writebackSources.map(
					(row) => row.sourceConnectionKey,
				),
				targetKeys: publishedLinks.removedRelated,
			});
		}

		await transaction.insert(outbox).values({
			entityType: "item",
			entityKey: itemKey,
			operation: "upsert",
			revision: nextRevision,
		});
		const indexingRecords = [{ key: itemKey, revision: nextRevision }, ...reinstated];
		for (const linkTargetKey of changedLinkTargets) {
			if (relatedParentKeys.includes(linkTargetKey)) continue;
			const target = lockedItems.find(
				(candidate) => candidate.key === linkTargetKey,
			);
			if (!target) continue;
			const targetRevision = target.revision + 1;
			await transaction
				.update(item)
				.set({ revision: targetRevision, updatedAt: now })
				.where(eq(item.key, target.key));
			await advanceOpenItemDraftBaseRevision(
				transaction,
				target.key,
				target.revision,
				targetRevision,
			);
			await transaction.insert(outbox).values({
				entityType: "item",
				entityKey: target.key,
				operation: "upsert",
				revision: targetRevision,
			});
			indexingRecords.push({ key: target.key, revision: targetRevision });
		}
		for (const relatedParentKey of relatedParentKeys) {
			const relatedParent = lockedItems.find(
				(candidate) => candidate.key === relatedParentKey,
			);
			if (!relatedParent) {
				throw new ItemParentUnavailableError(relatedParentKey);
			}
			const parentRevision = relatedParent.revision + 1;
			await transaction
				.update(item)
				.set({
					revision: parentRevision,
					updatedAt: now,
				})
				.where(eq(item.key, relatedParent.key));
			await advanceOpenItemDraftBaseRevision(
				transaction,
				relatedParent.key,
				relatedParent.revision,
				parentRevision,
			);
			await transaction.insert(outbox).values({
				entityType: "item",
				entityKey: relatedParent.key,
				operation: "upsert",
				revision: parentRevision,
			});
			indexingRecords.push({
				key: relatedParent.key,
				revision: parentRevision,
			});
		}
		const publishedPatch: Record<string, unknown> = options.review
			? createItemDraftPatch(basePayload, options.review.approved.payload)
			: draft!.patch;
		const sourceChoices = sourceResolutionsSchema.parse(validated.payload.sourceResolutions ?? {});
		const changedFields = Object.keys(publishedPatch).filter(
			(field) =>
				sourceChoices[field]?.choice !== "source" &&
				field !== "collections" &&
				!LIBRARY_OWNED_PAYLOAD_FIELDS.has(field) &&
				// A new profile link or affiliation is nothing a source can hold.
				!(
					field === "creators" &&
					sameBibliographicCreators(
						basePayload.creators,
						publishedPatch.creators,
					)
				),
		);
		// A changed "related" set changes what the source shows as Related, so the
		// record's relations must be written back. "Cites" never reaches a source.
		if (publishedLinks.relatedChanged) changedFields.push("relations");
		if (current?.deleted === 1) {
			changedFields.push(
				...editableItemDatabaseFields,
				"tags",
			);
		}
		// The record's source selection is saved with the publish. Children
		// always copy their parent; top-level records use the request, or keep
		// what was stored. Sources enabled just now receive the whole record.
		const selection = lockedParentItem
			? await applyParentWritebackLinks(transaction, {
					itemKey,
					parentItemKey: lockedParentItem,
				})
			: options.sourceKeys !== undefined
				? await ensureItemWritebackLinks(transaction, {
						configuration: options.writebackConfig ?? { sources: [] },
						itemKey,
						sourceKeys: options.sourceKeys,
					})
				: { enabled: [], newlyEnabled: [] };
		const changedChildren = lockedParentItem
			? []
			: await cascadeChildWritebackLinks(transaction, itemKey);
		const dirtyFieldsBySource: Record<string, readonly string[]> = {};
		if (sourceMembershipChanged) {
			dirtyFieldsBySource[access.identity.sourceConnectionKey] = [
				"collections",
			];
		}
		for (const sourceKey of selection.newlyEnabled) {
			dirtyFieldsBySource[sourceKey] = fullItemWritebackFields();
		}
		if (
			changedFields.length > 0 ||
			Object.keys(dirtyFieldsBySource).length > 0
		) {
			await markItemWritebackDirty(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: changedFields,
				dirtyFieldsBySource,
				itemKey,
				updatedAt: now,
			});
		}
		for (const child of changedChildren) {
			await enqueueFullWritebackForSources(transaction, {
				itemKey: child.itemKey,
				sourceKeys: child.newlyEnabled,
				updatedAt: now,
			});
		}
		const publicationRecordKey = validated.item.parentItem ?? itemKey;
		const publicationRecordRevision = indexingRecords.find(
			(record) => record.key === publicationRecordKey,
		)?.revision;
		if (publicationRecordRevision) {
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: publicationRecordKey,
				canonicalRevision: publicationRecordRevision,
				reason: "record_changed",
				now,
			});
		}
		const rebased = options.review && workingPayload
			? rebaseWorkingDraftAfterReview({ submitted: options.review.submitted.payload, approved: validated.payload, working: workingPayload })
			: null;
		const remainingPatch = rebased ? createItemDraftPatch(validated.payload, rebased.payload) : {};
		if (draft && Object.keys(remainingPatch).length > 0) {
			await transaction.update(itemDraft).set({
				baseRevision: nextRevision,
				patch: remainingPatch,
				draftRevision: sql`${itemDraft.draftRevision} + 1`,
				updatedAt: now,
			}).where(eq(itemDraft.itemKey, itemKey));
		} else {
			await transaction.delete(itemDraft).where(eq(itemDraft.itemKey, itemKey));
		}

		return {
			draftConflicts: rebased?.conflicts ?? [],
			indexingRecords,
			item: published!,
			previousParentItem: candidate?.parentItem ?? null,
			/** Attachments removed with the record and back with it, whose files go public again (withdrawn-files). */
			reinstatedAttachments: reinstated.map(({ key }) => key),
		};
	});
}

export async function publishItemDraft(
	db: Database,
	itemKey: string,
	options: ItemWritebackPolicyOptions = {},
) {
	return (await publishItemDraftWithContext(db, itemKey, options)).item;
}

class NativeItemLockSetChangedError extends Error {}

export type ItemUnpublishOptions = {
	/**
	 * Selected sources that should also delete their copy. Omit to remove the
	 * record from every source it currently writes to. Unlisted sources keep
	 * their copy and stay selected.
	 */
	removeFromSourceKeys?: readonly string[];
	/**
	 * Withdraws a record with a real DOI, which can't be deleted: it leaves like an unpublished record, its page becomes
	 * a tombstone giving this reason, and Crossref and Zenodo are told. Ignored for a record without one.
	 */
	withdrawal?: { reason: string };
};

/** Keeps a withdrawn OpenAlex record withdrawn when the next import brings it again. */
async function keepSourceRecordDeleted(transaction: Transaction, itemKey: string, now: Date) {
	const [originLink] = await transaction.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, itemKey)).limit(1);
	if (originLink) await transaction.insert(itemFieldOverride).values({itemKey, field: "deleted", value: 1, sourceValue: 0,
		sourceConnectionKey: originLink.sourceConnectionKey, sourceVersion: originLink.remoteVersion}).onConflictDoUpdate({target: [itemFieldOverride.itemKey, itemFieldOverride.field], set: {value: 1, updatedAt: now}});
}

/** The source owns these children, such as an OpenAlex PDF, so they leave with their record. */
async function withdrawSourceChildren(transaction: Transaction, children: readonly { key: string; revision: number }[], now: Date) {
	for (const child of children) {
		const revision = child.revision + 1;
		await keepSourceRecordDeleted(transaction, child.key, now);
		await transaction.update(item).set({ deleted: 1, deletedAt: now, revision, updatedAt: now }).where(eq(item.key, child.key));
		await advanceOpenItemDraftBaseRevision(transaction, child.key, child.revision, revision);
		await transaction.insert(outbox).values({ entityType: "item", entityKey: child.key, operation: "delete", revision });
		const files = await transaction.delete(itemFilePublication).where(eq(itemFilePublication.itemKey, child.key))
			.returning({ sourceConnectionKey: itemFilePublication.sourceConnectionKey, objectPath: itemFilePublication.objectPath, coverObjectPath: itemFilePublication.coverObjectPath });
		const paths = files.flatMap((file) => [file.objectPath, file.coverObjectPath].flatMap((objectPath) => objectPath ? [{ sourceConnectionKey: file.sourceConnectionKey, objectPath, updatedAt: now }] : []));
		if (paths.length) await transaction.insert(sourceFileCleanup).values(paths).onConflictDoUpdate({
			target: [sourceFileCleanup.sourceConnectionKey, sourceFileCleanup.objectPath],
			set: { attempts: 0, deadLetteredAt: null, lastError: null, updatedAt: now },
		});
	}
	return children.map((child) => ({ key: child.key, revision: child.revision + 1 }));
}

/**
 * A removed record takes its own attachments with it, at its moment, so restoring it brings back exactly those
 * (reinstateOwnChildren). Their public files leave public view after the removal commits (hideRemovedFiles).
 */
async function removeOwnChildren(transaction: Transaction, children: readonly { key: string; revision: number }[], now: Date, withdrawn: boolean) {
	for (const child of children) {
		const revision = child.revision + 1;
		await transaction.update(item).set({ deleted: 1, deletedAt: now, revision, updatedAt: now, withdrawnAt: withdrawn ? now : null }).where(eq(item.key, child.key));
		await advanceOpenItemDraftBaseRevision(transaction, child.key, child.revision, revision);
		await transaction.insert(outbox).values({ entityType: "item", entityKey: child.key, operation: "delete", revision });
	}
	return children.map((child) => ({ key: child.key, revision: child.revision + 1 }));
}

/**
 * Restoring a record brings back its own attachments removed with it, the ones removed at its moment: a record with a
 * record takes them when it is withdrawn or removed (removeOwnChildren). A source's attachments come back with their source.
 */
async function reinstateOwnChildren(transaction: Transaction, itemKey: string, deletedAt: Date) {
	const children = await transaction
		.select({ key: item.key, revision: item.revision })
		.from(item)
		.where(and(eq(item.parentItem, itemKey), eq(item.deleted, 1), eq(item.deletedAt, deletedAt), eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY)))
		.for("update");
	const now = new Date();
	for (const child of children) {
		const revision = child.revision + 1;
		await transaction.update(item).set({ deleted: 0, deletedAt: null, withdrawnAt: null, revision, updatedAt: now }).where(eq(item.key, child.key));
		await advanceOpenItemDraftBaseRevision(transaction, child.key, child.revision, revision);
		await transaction.insert(outbox).values({ entityType: "item", entityKey: child.key, operation: "upsert", revision });
	}
	return children.map((child) => ({ key: child.key, revision: child.revision + 1 }));
}

/**
 * Undoes withdrawSourceChildren when the record is published again. The PDF was
 * removed from storage, so the source brings it back: the next run of each
 * supplying source rescans in full instead of fetching only updated works.
 */
async function restoreSourceChildren(transaction: Transaction, itemKey: string) {
	const children = (await transaction.select({ key: item.key }).from(item)
		.innerJoin(itemFieldOverride, and(eq(itemFieldOverride.itemKey, item.key), eq(itemFieldOverride.field, "deleted")))
		.where(eq(item.parentItem, itemKey))).map(({ key }) => key);
	if (!children.length) return;
	await transaction.delete(itemFieldOverride).where(and(inArray(itemFieldOverride.itemKey, children), eq(itemFieldOverride.field, "deleted")));
	const sources = transaction.select({ key: itemSourceLink.sourceConnectionKey }).from(itemSourceLink).where(inArray(itemSourceLink.itemKey, children));
	// A run in progress keeps its cursor; the daily full rescan still covers it.
	await transaction.update(sourceConnection)
		.set({ syncCursor: sql`jsonb_set(${sourceConnection.syncCursor}, '{reconciledAt}', 'null'::jsonb)` })
		.where(and(inArray(sourceConnection.key, sources), sql`${sourceConnection.syncCursor}->>'completedAt' is not null`));
}

async function unpublishNativeItemAttempt(
	db: Database,
	itemKey: string,
	discardDraft: boolean,
	options: ItemUnpublishOptions = {},
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [candidate] = await transaction
			.select()
			.from(item)
			.where(
				and(
					eq(item.key, itemKey),
					isNativeOrOpenAlex(transaction, item.sourceConnectionKey),
				),
			)
			.limit(1);
		if (!candidate) {
			if (discardDraft) {
				const discarded =
					await discardNativeItemDraftIfPresentInTransaction(
						transaction,
						itemKey,
						true,
					);
				if (discarded) {
					return {
						changed: true,
						indexingRecords: [],
						item: null,
						stagedPrivatePaths: discarded.stagedPrivatePaths,
					};
				}
			}
			throw new ItemNotFoundError(itemKey);
		}
		const childrenToLock = await transaction
			.select({ key: item.key })
			.from(item)
			.where(and(eq(item.parentItem, itemKey), eq(item.deleted, 0)))
			.orderBy(item.key);
		const keysToLock =
			typeof candidate.parentItem === "string"
				? [
						itemKey,
						candidate.parentItem,
						...childrenToLock.map(({ key }) => key),
					]
				: [itemKey, ...childrenToLock.map(({ key }) => key)];
		const lockedItems = await transaction
			.select()
			.from(item)
			.where(inArray(item.key, keysToLock))
			.orderBy(item.key)
			.for("update");
		const current = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		if (!current) throw new ItemNotFoundError(itemKey);
		if (current.deleted === 1) {
			const discarded = discardDraft
				? await discardNativeItemDraftIfPresentInTransaction(
						transaction,
						itemKey,
						true,
					)
				: null;
			return {
				changed: Boolean(discarded),
				indexingRecords: [],
				item: current,
				stagedPrivatePaths: discarded?.stagedPrivatePaths ?? [],
			};
		}
		// A record leaves with its own attachments. One whose DOIs are all test ones (Zenodo sandbox, Crossref test), as on
		// a demo community, is removed for good and its DOI targets switched off: nothing public points at a test DOI. One
		// with a real DOI can only be withdrawn, with a reason its tombstone gives.
		const activeTargets = await transaction
			.select({ provider: publicationTarget.provider, environment: publicationTarget.environment })
			.from(publicationTarget)
			.where(
				and(
					eq(publicationTarget.itemKey, itemKey),
					isNull(publicationTarget.deactivatedAt),
                    isNotNull(publicationTarget.activatedAt),
				),
			)
			.for("update");
		const realDoi = removalDoiOf(activeTargets) === "real";
		if (realDoi && !options.withdrawal) {
			throw new ItemHasActivePublicationError(itemKey);
		}
		const withdrawal = realDoi ? options.withdrawal : undefined;
		const liveChildren = await transaction
			.select({ key: item.key, revision: item.revision, sourceConnectionKey: item.sourceConnectionKey })
			.from(item)
			.where(and(eq(item.parentItem, itemKey), eq(item.deleted, 0)))
			.orderBy(item.key);
		if ((current.parentItem ?? null) !== (candidate.parentItem ?? null)) {
			throw new NativeItemLockSetChangedError();
		}
		const sourceChildren = current.sourceConnectionKey === NATIVE_CONNECTION_KEY
			? []
			: liveChildren.filter((child) => child.sourceConnectionKey !== NATIVE_CONNECTION_KEY);
		const ownChildren = liveChildren.filter((child) => !sourceChildren.includes(child));
		const draftKeysToLock = [
			...new Set(
				[itemKey, current.parentItem].filter(
					(key): key is string => typeof key === "string",
				),
			),
		];
		await transaction
			.select({ itemKey: itemDraft.itemKey })
			.from(itemDraft)
			.where(inArray(itemDraft.itemKey, draftKeysToLock))
			.orderBy(itemDraft.itemKey)
			.for("update");
		if (current.itemType === "Attachment") {
			const [filePublication] = await transaction
				.select({ itemKey: itemFilePublication.itemKey })
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1);
			if (filePublication) {
				throw new ItemHasPublishedFileError(itemKey);
			}
		}

		const nextRevision = current.revision + 1;
		const now = new Date();
		if (current.sourceConnectionKey !== NATIVE_CONNECTION_KEY) await keepSourceRecordDeleted(transaction, itemKey, now);
		if (activeTargets.length && !realDoi) {
			await transaction
				.update(publicationTarget)
				.set({ deactivatedAt: now, updatedAt: now })
				.where(and(eq(publicationTarget.itemKey, itemKey), isNull(publicationTarget.deactivatedAt)));
		}
		const [unpublished] = await transaction
			.update(item)
			.set({
				deleted: 1,
				deletedAt: now,
				revision: nextRevision,
				updatedAt: now,
				withdrawnAt: withdrawal ? now : null,
				withdrawalReason: withdrawal?.reason ?? null,
			})
			.where(eq(item.key, itemKey))
			.returning();
		const ownChildRecords = await removeOwnChildren(transaction, ownChildren, now, Boolean(withdrawal));
		// Crossref and Zenodo get the record again, now withdrawn: "WITHDRAWN: " before its title, its full text gone.
		if (withdrawal) {
			await enqueuePublicationJobsForItem(transaction, { itemKey, canonicalRevision: nextRevision, reason: "record_changed", now });
		}
		await advanceOpenItemDraftBaseRevision(
			transaction,
			itemKey,
			current.revision,
			nextRevision,
		);
		await transaction.insert(outbox).values({
			entityType: "item",
			entityKey: itemKey,
			operation: "delete",
			revision: nextRevision,
		});
		const writebackLinks = await transaction
			.select()
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.writebackEnabled, true),
				),
			)
			.orderBy(itemSourceLink.sourceConnectionKey)
			.for("update");
		const removeFrom = options.removeFromSourceKeys
			? new Set(options.removeFromSourceKeys)
			: null;
		for (const writebackLink of writebackLinks) {
			if (removeFrom && !removeFrom.has(writebackLink.sourceConnectionKey)) {
				continue;
			}
			await enqueueSourceWritebackJob(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: writebackLink.dirtyFields,
				itemKey,
				operation: "delete",
				sourceConnectionKey: writebackLink.sourceConnectionKey,
			});
		}
		const indexingRecords = [
			{ key: itemKey, revision: nextRevision },
			...(await withdrawSourceChildren(transaction, sourceChildren, now)),
			...ownChildRecords,
		];
		const parent =
			typeof current.parentItem === "string"
				? lockedItems.find(
						(candidate) => candidate.key === current.parentItem,
					)
				: undefined;
		if (parent) {
			const parentRevision = parent.revision + 1;
			await transaction
				.update(item)
				.set({
					revision: parentRevision,
					updatedAt: now,
				})
				.where(eq(item.key, parent.key));
			await advanceOpenItemDraftBaseRevision(
				transaction,
				parent.key,
				parent.revision,
				parentRevision,
			);
			await transaction.insert(outbox).values({
				entityType: "item",
				entityKey: parent.key,
				operation: "upsert",
				revision: parentRevision,
			});
			indexingRecords.push({ key: parent.key, revision: parentRevision });
		}
		const discarded = discardDraft
			? await discardNativeItemDraftIfPresentInTransaction(
					transaction,
					itemKey,
					true,
				)
			: null;
		return {
			changed: true,
			indexingRecords,
			item: unpublished!,
			stagedPrivatePaths: discarded?.stagedPrivatePaths ?? [],
		};
	});
}

export async function unpublishNativeItemWithOutcome(
	db: Database,
	itemKey: string,
	options: ItemUnpublishOptions = {},
) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const outcome = await unpublishNativeItemAttempt(
				db,
				itemKey,
				false,
				options,
			);
			if (!outcome.item) throw new ItemNotFoundError(itemKey);
			return { ...outcome, item: outcome.item };
		} catch (error) {
			if (!(error instanceof NativeItemLockSetChangedError)) throw error;
		}
	}
	throw new ItemMutationConflictError(itemKey);
}

export async function unpublishNativeItem(db: Database, itemKey: string) {
	return (await unpublishNativeItemWithOutcome(db, itemKey)).item;
}

async function validateUnpublishedDraftRemoval(transaction: Transaction, itemKey: string) {
	const [pendingReview] = await transaction.select({ id: itemReview.id }).from(itemReview)
		.where(and(eq(itemReview.state, "pending"), sql`${itemReview.snapshot}->'records' @> ${JSON.stringify([{ itemKey }])}::jsonb`)).limit(1);
	if (pendingReview) throw new AdminValidationError("Withdraw or return the pending review before deleting this draft.");
	const [childDraft] = await transaction
		.select({ itemKey: itemDraft.itemKey })
		.from(itemDraft)
		.where(sql`${itemDraft.patch} ->> 'parentItem' = ${itemKey}`)
		.limit(1);
	const [publishedChild] = await transaction
		.select({ key: item.key })
		.from(item)
		.where(eq(item.parentItem, itemKey))
		.limit(1);
	if (childDraft || publishedChild) {
		throw new ItemHasChildrenError(itemKey);
	}
}

async function discardMetadataDraft(transaction: Transaction, itemKey: string) {
 const [discarded] = await transaction.delete(itemDraft).where(eq(itemDraft.itemKey, itemKey)).returning({itemKey: itemDraft.itemKey});
 if (!discarded) throw new ItemDraftConflictError(itemKey);
 await transaction.update(itemReview).set({remainingConflicts: sql`${itemReview.remainingConflicts} - ${itemKey}`, revision: sql`${itemReview.revision} + 1`}).where(sql`${itemReview.remainingConflicts} ? ${itemKey}`);
}

async function discardStagedFileReferences(transaction: Transaction, itemKey: string, staged: {objectPath: string; coverObjectPath: string | null} | undefined, published: boolean, removeFileDraft: boolean) {
 if (!staged || (published && !removeFileDraft)) return [];
 await transaction.delete(itemFileDraft).where(eq(itemFileDraft.itemKey, itemKey));
 return [staged.objectPath, staged.coverObjectPath].filter((path): path is string => Boolean(path));
}

async function loadDiscardableDraft(transaction: Transaction, itemKey: string, removeFileDraft: boolean, requireMetadataDraft: boolean) {
	const [staged] = await transaction
		.select({
			coverObjectPath: itemFileDraft.coverObjectPath,
			objectPath: itemFileDraft.objectPath,
		})
		.from(itemFileDraft)
		.where(eq(itemFileDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	const [draft] = await transaction
		.select({
			itemKey: itemDraft.itemKey,
			sourceConnectionKey: itemDraft.sourceConnectionKey,
		})
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	if (!draft && !(removeFileDraft && staged)) {
		if (!requireMetadataDraft) return null;
		throw new ItemNotFoundError(itemKey);
	}
 return {staged, draft, sourceConnectionKey: draft?.sourceConnectionKey ?? NATIVE_CONNECTION_KEY};
}

async function discardItemDraftInTransaction(
	transaction: Transaction,
	itemKey: string,
	{
		removeFileDraft = false,
		requireMetadataDraft = true,
	}: {
		removeFileDraft?: boolean;
		requireMetadataDraft?: boolean;
	} = {},
) {
 const discardable = await loadDiscardableDraft(transaction, itemKey, removeFileDraft, requireMetadataDraft);
 if (!discardable) return null;
 const {staged, draft, sourceConnectionKey} = discardable;
	const [identity] = await transaction
		.select({ key: itemIdentity.key })
		.from(itemIdentity)
		.where(
			and(
				eq(itemIdentity.key, itemKey),
				eq(
					itemIdentity.sourceConnectionKey,
					sourceConnectionKey,
				),
			),
		)
		.for("update")
		.limit(1);
	if (!identity) {
		throw new ItemNotFoundError(itemKey);
	}
	const [published] = await transaction
		.select({ key: item.key })
		.from(item)
		.where(eq(item.key, itemKey))
		.limit(1);
	if (!published) await validateUnpublishedDraftRemoval(transaction, itemKey);
	if (draft) await discardMetadataDraft(transaction, itemKey);
 const stagedPrivatePaths = await discardStagedFileReferences(transaction, itemKey, staged, Boolean(published), removeFileDraft);
	return {stagedPrivatePaths};
}

async function discardNativeItemDraftIfPresentInTransaction(
	transaction: Transaction,
	itemKey: string,
	removeFileDraft = false,
) {
	return discardItemDraftInTransaction(transaction, itemKey, {
		removeFileDraft,
		requireMetadataDraft: false,
	});
}

export async function discardItemDraft(db: Database, itemKey: string) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const discarded = await discardItemDraftInTransaction(
			transaction,
			itemKey,
		);
		if (!discarded) throw new ItemNotFoundError(itemKey);
		return discarded;
	});
}

export async function removeNativeItem(db: Database, itemKey: string) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const removed = await unpublishNativeItemAttempt(db, itemKey, true);
			return {
				changed: removed.changed,
				indexingRecords: removed.indexingRecords,
				item: removed.item,
				stagedPrivatePaths: removed.stagedPrivatePaths,
			};
		} catch (error) {
			if (error instanceof NativeItemLockSetChangedError) continue;
			throw error;
		}
	}
	throw new ItemMutationConflictError(itemKey);
}
