import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import {
	and,
	eq,
	getTableColumns,
	inArray,
	sql,
	type InferInsertModel,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { reserveItemIdentity } from "@/db/record-identity";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";
import { adminDatabaseFieldToPayloadField } from "@/lib/admin/item-fields";

import {
	NativeItemValidationError,
	validateNativeItemDraft,
} from "./native-item-validation";
import { NATIVE_SOURCE_CONNECTION_KEY as NATIVE_CONNECTION_KEY } from "./constants";

const systemManagedItemFields = new Set([
	"PDFCoverPageHeight",
	"PDFCoverPageImage",
	"PDFCoverPageWidth",
	"charset",
	"citation",
	"contentType",
	"createdAt",
	"dateAdded",
	"dateModified",
	"deleted",
	"deletedAt",
	"filename",
	"fullTextPDF",
	"key",
	"linkMode",
	"md5",
	"mtime",
	"revision",
	"sourceConnectionKey",
	"sourceRecordKey",
	"updatedAt",
]);

const editableItemFields = Object.keys(getTableColumns(item)).filter(
	(field) => !systemManagedItemFields.has(field),
);

type ItemInsert = InferInsertModel<typeof item>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export async function advanceOpenNativeDraftBaseRevision(
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
				eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				eq(itemDraft.baseRevision, previousRevision),
			),
		);
}

export class NativeItemNotFoundError extends Error {
	constructor(itemKey: string) {
		super(`Native item was not found: ${itemKey}`);
		this.name = "NativeItemNotFoundError";
	}
}

export class NativeDraftConflictError extends Error {
	constructor(itemKey: string) {
		super(`Native item draft is stale: ${itemKey}`);
		this.name = "NativeDraftConflictError";
	}
}

export class NativeItemMutationConflictError extends Error {
	constructor(itemKey: string) {
		super(`Native item changed concurrently; retry: ${itemKey}`);
		this.name = "NativeItemMutationConflictError";
	}
}

export class NativeItemHasPublishedFileError extends Error {
	constructor(itemKey: string) {
		super(
			`Unpublish the file before unpublishing attachment metadata: ${itemKey}`,
		);
		this.name = "NativeItemHasPublishedFileError";
	}
}

export class NativeItemHasChildrenError extends Error {
	constructor(itemKey: string) {
		super(`Remove or unpublish child items first: ${itemKey}`);
		this.name = "NativeItemHasChildrenError";
	}
}

export class NativeItemParentUnavailableError extends Error {
	constructor(itemKey: string) {
		super(`Parent must be an active native item: ${itemKey}`);
		this.name = "NativeItemParentUnavailableError";
	}
}

export function assertValidNativeItemCollectionMemberships({
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
				collections:
					"Imported collection memberships are read only.",
			},
		);
	}
}

export function nativeItemCollectionBaselineKeys(
	publishedCollectionKeys: string[],
	draftPayload: unknown,
) {
	const payload =
		draftPayload && typeof draftPayload === "object"
			? (draftPayload as Record<string, unknown>)
			: null;
	const draftCollectionKeys = Array.isArray(payload?.collections)
		? payload.collections.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	return [...new Set([...publishedCollectionKeys, ...draftCollectionKeys])];
}

async function assertValidNativeItemCollectionMembershipsInDatabase(
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
					.select({ payload: itemDraft.payload })
					.from(itemDraft)
					.where(
						and(
							eq(itemDraft.itemKey, itemKey),
							eq(
								itemDraft.sourceConnectionKey,
								NATIVE_CONNECTION_KEY,
							),
						),
					)
					.limit(1)
					.then((rows) => rows[0] ?? null),
			])
		: [[], null];
	const baselineCollectionKeys = nativeItemCollectionBaselineKeys(
		baselineRows.map(({ key }) => key),
		existingDraft?.payload,
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
	assertValidNativeItemCollectionMemberships({
		baselineCollectionKeys,
		collectionRows,
		desiredCollectionKeys,
	});
}

function publishedItemValues(
	validated: ReturnType<typeof validateNativeItemDraft>,
) {
	const snapshot = Object.fromEntries(
		editableItemFields.map((field) => [field, null]),
	) as Partial<ItemInsert>;
	return {
		...snapshot,
		...validated.item,
	};
}

export async function createNativeItemDraft(db: Database, payload: unknown) {
	const validated = validateNativeItemDraft(payload, {
		allowIncompleteCreators: true,
	});

	return db.transaction(async (transaction) => {
		await assertValidNativeItemCollectionMembershipsInDatabase(
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
				throw new NativeItemParentUnavailableError(parentItemKey);
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
				payload: validated.payload,
			})
			.returning();

		return draft!;
	});
}

export async function getNativeItemDraft(db: Database, itemKey: string) {
	const [draft] = await db
		.select()
		.from(itemDraft)
		.where(
			and(
				eq(itemDraft.itemKey, itemKey),
				eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
			),
		)
		.limit(1);
	if (!draft) {
		throw new NativeItemNotFoundError(itemKey);
	}
	return draft;
}

export async function openNativeItemDraft(db: Database, itemKey: string) {
	return db.transaction(async (transaction) => {
		const [existingDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1);
		if (existingDraft) return existingDraft;

		const [published] = await transaction
			.select()
			.from(item)
			.where(
				and(
					eq(item.key, itemKey),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.for("update")
			.limit(1);
		if (!published) {
			throw new NativeItemNotFoundError(itemKey);
		}

		const tagRows = await transaction
			.select({ name: itemToTag.tagName })
			.from(itemToTag)
			.where(eq(itemToTag.itemKey, itemKey));
		const collectionRows = await transaction
			.select({ key: itemToCollection.collectionKey })
			.from(itemToCollection)
			.where(eq(itemToCollection.itemKey, itemKey));
		const [filePublication] = await transaction
			.select({ itemKey: itemFilePublication.itemKey })
			.from(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, itemKey))
			.limit(1);

		const payload: Record<string, unknown> = {};
		for (const field of editableItemFields) {
			if (field === "url" && filePublication) continue;
			const value = published[field as keyof typeof published];
			if (value !== null && value !== undefined) {
				payload[adminDatabaseFieldToPayloadField(field)] = value;
			}
		}
		payload.tags = tagRows.map(({ name }) => name);
		payload.collections = collectionRows.map(({ key }) => key);

		const validated = validateNativeItemDraft(payload);
		const [draft] = await transaction
			.insert(itemDraft)
			.values({
				itemKey,
				sourceConnectionKey: NATIVE_CONNECTION_KEY,
				payload: validated.payload,
				baseRevision: published.revision,
			})
			.onConflictDoNothing()
			.returning();
		if (draft) return draft;

		const [concurrentDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey))
			.limit(1);
		if (!concurrentDraft) {
			throw new NativeDraftConflictError(itemKey);
		}
		return concurrentDraft;
	});
}

export async function saveNativeItemDraft(
	db: Database,
	{
		expectedDraftRevision,
		itemKey,
		payload,
	}: {
		expectedDraftRevision: number;
		itemKey: string;
		payload: unknown;
	},
) {
	const validated = validateNativeItemDraft(payload, {
		allowIncompleteCreators: true,
	});
	return db.transaction(async (transaction) => {
		const [currentDraft] = await transaction
			.select({
				draftRevision: itemDraft.draftRevision,
			})
			.from(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.for("update")
			.limit(1);
		if (currentDraft?.draftRevision !== expectedDraftRevision) {
			throw new NativeDraftConflictError(itemKey);
		}
		await assertValidNativeItemCollectionMembershipsInDatabase(
			transaction,
			itemKey,
			validated.collectionKeys,
		);
		const [draft] = await transaction
			.update(itemDraft)
			.set({
				payload: validated.payload,
				draftRevision: sql`${itemDraft.draftRevision} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
					eq(itemDraft.draftRevision, expectedDraftRevision),
				),
			)
			.returning();
		if (!draft) {
			throw new NativeDraftConflictError(itemKey);
		}
		return draft;
	});
}

export async function publishNativeItemDraftWithContext(
	db: Database,
	itemKey: string,
) {
	return db.transaction(async (transaction) => {
		const [initialDraft] = await transaction
			.select()
			.from(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.limit(1);
		if (!initialDraft) {
			throw new NativeItemNotFoundError(itemKey);
		}

		const initialValidated = validateNativeItemDraft(initialDraft.payload);
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
			throw new NativeDraftConflictError(itemKey);
		}
		const validated = validateNativeItemDraft(draft.payload);
		if (validated.item.parentItem !== parentItemKey) {
			throw new NativeDraftConflictError(itemKey);
		}
		await assertValidNativeItemCollectionMembershipsInDatabase(
			transaction,
			itemKey,
			validated.collectionKeys,
		);
		const current = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		if ((current?.parentItem ?? null) !== (candidate?.parentItem ?? null)) {
			throw new NativeDraftConflictError(itemKey);
		}
		const parent =
			typeof parentItemKey === "string"
				? lockedItems.find(
						(candidate) => candidate.key === parentItemKey,
					)
				: undefined;
		const currentRevision = current?.revision ?? 0;
		if (currentRevision !== draft.baseRevision) {
			throw new NativeDraftConflictError(itemKey);
		}
		if (
			typeof parentItemKey === "string" &&
			(parentItemKey === itemKey ||
				!parent ||
				parent.deleted === 1 ||
				parent.sourceConnectionKey !== NATIVE_CONNECTION_KEY ||
				parent.parentItem !== null)
		) {
			throw new NativeItemParentUnavailableError(parentItemKey);
		}
		if (typeof parentItemKey === "string") {
			const [liveChild] = await transaction
				.select({ key: item.key })
				.from(item)
				.where(
					and(
						eq(item.parentItem, itemKey),
						eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
						eq(item.deleted, 0),
					),
				)
				.limit(1);
			if (liveChild) {
				throw new NativeItemHasChildrenError(itemKey);
			}
		}

		const nextRevision = currentRevision + 1;
		const now = new Date();
		const values = {
			...publishedItemValues(validated),
			key: itemKey,
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
			sourceRecordKey: itemKey,
			revision: nextRevision,
			dateAdded: current?.dateAdded ?? now,
			dateModified: now,
			deleted: 0,
			deletedAt: null,
			updatedAt: now,
		} as ItemInsert;
		if (current && validated.item.itemType === "Attachment") {
			const [filePublication] = await transaction
				.select({
					publicUrl: itemFilePublication.publicUrl,
				})
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1);
			if (filePublication) {
				values.url = filePublication.publicUrl;
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
		if (validated.tags.length > 0) {
			await transaction
				.insert(tag)
				.values(validated.tags.map((name) => ({ name })))
				.onConflictDoNothing();
			await transaction.insert(itemToTag).values(
				validated.tags.map((tagName) => ({
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
		for (const relatedParentKey of relatedParentKeys) {
			const relatedParent = lockedItems.find(
				(candidate) => candidate.key === relatedParentKey,
			);
			if (!relatedParent) {
				throw new NativeItemParentUnavailableError(relatedParentKey);
			}
			const parentRevision = relatedParent.revision + 1;
			await transaction
				.update(item)
				.set({
					revision: parentRevision,
					updatedAt: now,
				})
				.where(eq(item.key, relatedParent.key));
			await advanceOpenNativeDraftBaseRevision(
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
		}
		await transaction
			.delete(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey));

		return {
			item: published!,
			previousParentItem: candidate?.parentItem ?? null,
		};
	});
}

export async function publishNativeItemDraft(db: Database, itemKey: string) {
	return (await publishNativeItemDraftWithContext(db, itemKey)).item;
}

class NativeItemLockSetChangedError extends Error {}

async function unpublishNativeItemAttempt(db: Database, itemKey: string) {
	return db.transaction(async (transaction) => {
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
			throw new NativeItemNotFoundError(itemKey);
		}
		const childrenToLock = await transaction
			.select({ key: item.key })
			.from(item)
			.where(
				and(
					eq(item.parentItem, itemKey),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
					eq(item.deleted, 0),
				),
			)
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
		if (!current) throw new NativeItemNotFoundError(itemKey);
		if (current.deleted === 1) {
			return current;
		}
		const liveChildren = await transaction
			.select({ key: item.key })
			.from(item)
			.where(
				and(
					eq(item.parentItem, itemKey),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
					eq(item.deleted, 0),
				),
			)
			.orderBy(item.key);
		if ((current.parentItem ?? null) !== (candidate.parentItem ?? null)) {
			throw new NativeItemLockSetChangedError();
		}
		if (liveChildren.length > 0) {
			throw new NativeItemHasChildrenError(itemKey);
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
				throw new NativeItemHasPublishedFileError(itemKey);
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
		await advanceOpenNativeDraftBaseRevision(
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
			await advanceOpenNativeDraftBaseRevision(
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
		}
		return unpublished!;
	});
}

export async function unpublishNativeItem(db: Database, itemKey: string) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await unpublishNativeItemAttempt(db, itemKey);
		} catch (error) {
			if (!(error instanceof NativeItemLockSetChangedError)) throw error;
		}
	}
	throw new NativeItemMutationConflictError(itemKey);
}

export async function discardNativeItemDraft(db: Database, itemKey: string) {
	return db.transaction(async (transaction) => {
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
			.select({ itemKey: itemDraft.itemKey })
			.from(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.for("update")
			.limit(1);
		if (!draft) {
			throw new NativeItemNotFoundError(itemKey);
		}
		const [identity] = await transaction
			.select({ key: itemIdentity.key })
			.from(itemIdentity)
			.where(
				and(
					eq(itemIdentity.key, itemKey),
					eq(itemIdentity.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.for("update")
			.limit(1);
		if (!identity) {
			throw new NativeItemNotFoundError(itemKey);
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
				.where(
					sql`${itemDraft.payload} ->> 'parentItem' = ${itemKey}`,
				)
				.limit(1);
			const [publishedChild] = await transaction
				.select({ key: item.key })
				.from(item)
				.where(eq(item.parentItem, itemKey))
				.limit(1);
			if (childDraft || publishedChild) {
				throw new NativeItemHasChildrenError(itemKey);
			}
		}
		const [discarded] = await transaction
			.delete(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.returning({ itemKey: itemDraft.itemKey });
		if (!discarded) throw new NativeDraftConflictError(itemKey);
		if (!published) {
			await transaction
				.delete(itemIdentity)
				.where(eq(itemIdentity.key, itemKey));
		}
		return {
			removedIdentity: !published,
			stagedPrivatePaths:
				!published && staged
					? [staged.objectPath, staged.coverObjectPath].filter(
							(path): path is string => Boolean(path),
						)
					: [],
		};
	});
}
