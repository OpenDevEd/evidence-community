import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, sql, type InferInsertModel } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { lockItemMutation } from "@/db/item-mutation-lock";
import { reserveItemIdentity } from "@/db/record-identity";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";

import {
	collectionKeysFromPayload,
	payloadWithCollection,
} from "./item-payload";
import { adminDatabaseFieldToPayloadField } from "./item-fields";
import {
	applyItemDraftPatch,
	createItemDraftPatch,
	editableItemDatabaseFields,
	materializeItemDraft,
	publishedAdminItemPayload,
} from "./item-draft-patch";
import {
	NativeItemValidationError,
	validateNativeItemDraft,
} from "./native-item-validation";
import { NATIVE_SOURCE_CONNECTION_KEY as NATIVE_CONNECTION_KEY } from "./constants";
import {
	enqueueSourceWritebackJob,
	ensureDefaultWritebackLink,
	markItemWritebackDirty,
} from "@/lib/source-writeback/queue";

type ItemInsert = InferInsertModel<typeof item>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

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
	constructor(itemKey: string) {
		super(`Item draft is stale: ${itemKey}`);
		this.name = "ItemDraftConflictError";
	}
}

export class ItemMutationConflictError extends Error {
	constructor(itemKey: string) {
		super(`Item changed concurrently; retry: ${itemKey}`);
		this.name = "ItemMutationConflictError";
	}
}

export class ItemWritebackUnavailableError extends Error {
	constructor(itemKey: string) {
		super(`Item has no enabled writeback source: ${itemKey}`);
		this.name = "ItemWritebackUnavailableError";
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

async function requireItemDraftAccess(executor: Executor, itemKey: string) {
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

	const [writebackLink] = await executor
		.select()
		.from(itemSourceLink)
		.where(
			and(
				eq(itemSourceLink.itemKey, itemKey),
				eq(itemSourceLink.writebackEnabled, true),
			),
		)
		.limit(1);
	if (
		identity.sourceConnectionKey !== NATIVE_CONNECTION_KEY &&
		!writebackLink
	) {
		throw new ItemWritebackUnavailableError(itemKey);
	}
	return { identity, writebackLink: writebackLink ?? null };
}

export function assertValidItemCollectionMemberships({
	baselineCollectionKeys,
	collectionRows,
	desiredCollectionKeys,
}: {
	baselineCollectionKeys: string[];
	collectionRows: Array<{
		deleted: number | null;
		key: string;
		sourceConnectionKey: string;
	}>;
	desiredCollectionKeys: string[];
}) {
	const collectionsByKey = new Map(
		collectionRows.map((row) => [row.key, row]),
	);
	const baselineKeys = new Set(baselineCollectionKeys);
	const baselineImportedKeys = new Set(
		baselineCollectionKeys.filter(
			(key) =>
				collectionsByKey.get(key)?.sourceConnectionKey !==
				NATIVE_CONNECTION_KEY,
		),
	);
	const desiredImportedKeys = new Set<string>();

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
		if (target.sourceConnectionKey === NATIVE_CONNECTION_KEY) {
			if (target.deleted === 1 && !baselineKeys.has(key)) {
				throw new NativeItemValidationError(
					"One or more selected collections have been deleted.",
					{
						collections:
							"Remove deleted collections before publishing.",
					},
				);
			}
		} else {
			desiredImportedKeys.add(key);
		}
	}

	const unchangedImportedMemberships =
		baselineImportedKeys.size === desiredImportedKeys.size &&
		[...baselineImportedKeys].every((key) => desiredImportedKeys.has(key));
	if (!unchangedImportedMemberships) {
		throw new NativeItemValidationError(
			"Imported collection memberships cannot be changed here.",
			{
				collections: "Imported collection memberships are read only.",
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

async function assertValidItemCollectionMembershipsInDatabase(
	db: Executor,
	itemKey: string | null,
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
		desiredCollectionKeys,
	});
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

async function loadPublishedItemPayload(
	executor: Executor,
	itemKey: string,
	published?: typeof item.$inferSelect | null,
) {
	const [publishedRow, tagRows, collectionRows, filePublication] =
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
		]);
	return publishedAdminItemPayload(publishedRow, {
		collectionKeys: collectionRows.map(({ key }) => key),
		hasPublishedFile: Boolean(filePublication),
		tags: tagRows.map(({ name }) => name),
	});
}

export async function createNativeItemDraft(db: Database, payload: unknown) {
	const validated = validateNativeItemDraft(payload, {
		allowIncompleteCreators: true,
	});

	return db.transaction(async (transaction) => {
		await assertValidItemCollectionMembershipsInDatabase(
			transaction,
			null,
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
						eq(
							itemIdentity.sourceConnectionKey,
							NATIVE_CONNECTION_KEY,
						),
					),
				)
				.for("update")
				.limit(1);
			if (!parentIdentity) {
				throw new ItemParentUnavailableError(parentItemKey);
			}
		}
		const itemKey = await reserveItemIdentity(transaction, {
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
		});
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
) {
	const access = await requireItemDraftAccess(transaction, itemKey);
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

export async function openItemDraft(db: Database, itemKey: string) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		return openItemDraftInTransaction(transaction, itemKey);
	});
}

async function saveItemDraftInTransaction(
	transaction: Transaction,
	{
		expectedDraftRevision,
		expectedPayload,
		itemKey,
		payload,
	}: {
		expectedDraftRevision: number;
		expectedPayload: unknown;
		itemKey: string;
		payload: unknown;
	},
) {
	await requireItemDraftAccess(transaction, itemKey);
	const expected = validateNativeItemDraft(expectedPayload, {
		allowIncompleteCreators: true,
	});
	const submitted = validateNativeItemDraft(payload, {
		allowIncompleteCreators: true,
	});
	const [currentDraft] = await transaction
		.select()
		.from(itemDraft)
		.where(eq(itemDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	if (currentDraft?.draftRevision !== expectedDraftRevision) {
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
	const editorChanges = createItemDraftPatch(
		expected.payload,
		submitted.payload,
	);
	const intendedPayload = applyItemDraftPatch(currentPayload, editorChanges);
	const validated = validateNativeItemDraft(intendedPayload, {
		allowIncompleteCreators: true,
	});
	const patch = createItemDraftPatch(basePayload, validated.payload);
	await assertValidItemCollectionMembershipsInDatabase(
		transaction,
		itemKey,
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
				eq(itemDraft.draftRevision, expectedDraftRevision),
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
		expectedDraftRevision: number;
		expectedPayload: unknown;
		itemKey: string;
		payload: unknown;
	},
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, args.itemKey);
		return saveItemDraftInTransaction(transaction, args);
	});
}

export async function assignItemDraftToCollection(
	db: Database,
	itemKey: string,
	collectionKey: string,
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		await requireItemDraftAccess(transaction, itemKey);
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
			: await openItemDraftInTransaction(transaction, itemKey);
		const draftRevision =
			existingDraft?.draftRevision ?? openedDraft!.draftRevision;
		const draftPayload = existingDraftPayload ?? openedDraft!.payload;
		await saveItemDraftInTransaction(transaction, {
			expectedDraftRevision: draftRevision,
			expectedPayload: draftPayload,
			itemKey,
			payload: payloadWithCollection(draftPayload, collectionKey),
		});
		return { changed: true };
	});
}

export async function publishItemDraftWithContext(
	db: Database,
	itemKey: string,
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const access = await requireItemDraftAccess(transaction, itemKey);
		const [initialDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1);
		if (!initialDraft) {
			throw new ItemNotFoundError(itemKey);
		}

		const initialValidated = validateNativeItemDraft(
			applyItemDraftPatch(
				await loadPublishedItemPayload(transaction, itemKey),
				initialDraft.patch,
			),
		);
		const [candidate] = await transaction
			.select({ parentItem: item.parentItem })
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1);
		const parentItemKey = initialValidated.item.parentItem;
		const relatedParentKeys = [
			...new Set(
				[parentItemKey, candidate?.parentItem].filter(
					(key): key is string => typeof key === "string",
				),
			),
		];
		const keysToLock = [...new Set([itemKey, ...relatedParentKeys])];
		const lockedItems = await transaction
			.select()
			.from(item)
			.where(inArray(item.key, keysToLock))
			.orderBy(item.key)
			.for("update");
		const lockedDrafts = await transaction
			.select()
			.from(itemDraft)
			.where(inArray(itemDraft.itemKey, keysToLock))
			.orderBy(itemDraft.itemKey)
			.for("update");
		const draft = lockedDrafts.find(
			(candidate) => candidate.itemKey === itemKey,
		);
		if (!draft || draft.draftRevision !== initialDraft.draftRevision) {
			throw new ItemDraftConflictError(itemKey);
		}
		const current = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		const validated = validateNativeItemDraft(
			applyItemDraftPatch(
				await loadPublishedItemPayload(
					transaction,
					itemKey,
					current ?? null,
				),
				draft.patch,
			),
		);
		if (validated.item.parentItem !== parentItemKey) {
			throw new ItemDraftConflictError(itemKey);
		}
		await assertValidItemCollectionMembershipsInDatabase(
			transaction,
			itemKey,
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

		const nextRevision = currentRevision + 1;
		const now = new Date();
		const values = {
			...publishedItemValues(validated),
			key: itemKey,
			sourceConnectionKey: access.identity.sourceConnectionKey,
			sourceRecordKey:
				current?.sourceRecordKey ?? access.identity.sourceRecordKey,
			revision: nextRevision,
			dateAdded: current?.dateAdded ?? now,
			dateModified: now,
			deleted: 0,
			deletedAt: null,
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

		await transaction.insert(outbox).values({
			entityType: "item",
			entityKey: itemKey,
			operation: "upsert",
			revision: nextRevision,
		});
		const indexingRecords = [{ key: itemKey, revision: nextRevision }];
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
		const changedFields = Object.keys(draft.patch).filter(
			(field) => field !== "collections",
		);
		if (current?.deleted === 1) {
			changedFields.push(
				...editableItemDatabaseFields.map(
					adminDatabaseFieldToPayloadField,
				),
				"tags",
			);
		}
		if (changedFields.length > 0) {
			if (access.identity.sourceConnectionKey === NATIVE_CONNECTION_KEY) {
				await ensureDefaultWritebackLink(transaction, itemKey);
			}
			await markItemWritebackDirty(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: changedFields,
				itemKey,
				updatedAt: now,
			});
		}
		await transaction
			.delete(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey));

		return {
			indexingRecords,
			item: published!,
			previousParentItem: candidate?.parentItem ?? null,
		};
	});
}

export async function publishItemDraft(db: Database, itemKey: string) {
	return (await publishItemDraftWithContext(db, itemKey)).item;
}

class NativeItemLockSetChangedError extends Error {}

async function unpublishNativeItemAttempt(
	db: Database,
	itemKey: string,
	discardDraft: boolean,
) {
	return db.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [candidate] = await transaction
			.select()
			.from(item)
			.where(
				and(
					eq(item.key, itemKey),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
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
		const liveChildren = await transaction
			.select({ key: item.key })
			.from(item)
			.where(and(eq(item.parentItem, itemKey), eq(item.deleted, 0)))
			.orderBy(item.key);
		if ((current.parentItem ?? null) !== (candidate.parentItem ?? null)) {
			throw new NativeItemLockSetChangedError();
		}
		if (liveChildren.length > 0) {
			throw new ItemHasChildrenError(itemKey);
		}
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
		const [unpublished] = await transaction
			.update(item)
			.set({
				deleted: 1,
				deletedAt: now,
				revision: nextRevision,
				updatedAt: now,
			})
			.where(eq(item.key, itemKey))
			.returning();
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
		const [writebackLink] = await transaction
			.select()
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.writebackEnabled, true),
				),
			)
			.limit(1)
			.for("update");
		if (writebackLink) {
			await enqueueSourceWritebackJob(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: writebackLink.dirtyFields,
				itemKey,
				operation: "delete",
				sourceConnectionKey: writebackLink.sourceConnectionKey,
			});
		}
		const indexingRecords = [{ key: itemKey, revision: nextRevision }];
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
) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const outcome = await unpublishNativeItemAttempt(
				db,
				itemKey,
				false,
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
	const [identity] = await transaction
		.select({ key: itemIdentity.key })
		.from(itemIdentity)
		.where(
			and(
				eq(itemIdentity.key, itemKey),
				eq(
					itemIdentity.sourceConnectionKey,
					draft?.sourceConnectionKey ?? NATIVE_CONNECTION_KEY,
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
	if (!published) {
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
	const [discarded] = draft
		? await transaction
				.delete(itemDraft)
				.where(eq(itemDraft.itemKey, itemKey))
				.returning({ itemKey: itemDraft.itemKey })
		: [null];
	if (draft && !discarded) throw new ItemDraftConflictError(itemKey);
	if (removeFileDraft && staged) {
		await transaction
			.delete(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey));
	}
	if (!published) {
		await transaction
			.delete(itemIdentity)
			.where(eq(itemIdentity.key, itemKey));
	}
	return {
		removedIdentity: !published,
		stagedPrivatePaths:
			(!published || removeFileDraft) && staged
				? [staged.objectPath, staged.coverObjectPath].filter(
						(path): path is string => Boolean(path),
					)
				: [],
	};
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
