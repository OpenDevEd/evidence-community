import {
	itemDraft,
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
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";

import { validateNativeItemDraft } from "./native-item-validation";

const NATIVE_CONNECTION_KEY = "native";

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

export class NativeItemHasPublishedFileError extends Error {
	constructor(itemKey: string) {
		super(
			`Unpublish the file before unpublishing attachment metadata: ${itemKey}`,
		);
		this.name = "NativeItemHasPublishedFileError";
	}
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

export async function createNativeItemDraft(
	db: Database,
	payload: unknown,
) {
	const validated = validateNativeItemDraft(payload);

	return db.transaction(async (transaction) => {
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

export async function getNativeItemDraft(
	db: Database,
	itemKey: string,
) {
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

export async function openNativeItemDraft(
	db: Database,
	itemKey: string,
) {
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
			.limit(1);
		if (!published) {
			throw new NativeItemNotFoundError(itemKey);
		}

		const [tagRows, collectionRows, filePublication] =
			await Promise.all([
			transaction
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, itemKey)),
			transaction
				.select({ key: itemToCollection.collectionKey })
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, itemKey)),
			transaction
				.select({ itemKey: itemFilePublication.itemKey })
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1)
				.then((rows) => rows[0]),
		]);

		const payload: Record<string, unknown> = {};
		for (const field of editableItemFields) {
			if (field === "url" && filePublication) continue;
			const value = published[field as keyof typeof published];
			if (value !== null && value !== undefined) {
				payload[field === "languageName" ? "language" : field] =
					value;
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
	const validated = validateNativeItemDraft(payload);
	const [draft] = await db
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
}

export async function publishNativeItemDraft(
	db: Database,
	itemKey: string,
) {
	return db.transaction(async (transaction) => {
		const [draft] = await transaction
			.select()
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
			.for("update")
			.limit(1);
		if (!draft) {
			throw new NativeItemNotFoundError(itemKey);
		}

		const validated = validateNativeItemDraft(draft.payload);
		const parentItemKey =
			validated.item.itemType === "Attachment"
				? validated.item.parentItem
				: null;
		const keysToLock =
			typeof parentItemKey === "string"
				? [itemKey, parentItemKey]
				: [itemKey];
		const lockedItems = await transaction
			.select()
			.from(item)
			.where(inArray(item.key, keysToLock))
			.orderBy(item.key)
			.for("update");
		const current = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
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
			(!parent || parent.deleted === 1)
		) {
			throw new NativeItemNotFoundError(parentItemKey);
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
			await transaction
				.insert(itemToTag)
				.values(
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
		if (parent) {
			const parentRevision = parent.revision + 1;
			await transaction
				.update(item)
				.set({
					revision: parentRevision,
					updatedAt: now,
				})
				.where(eq(item.key, parent.key));
			await transaction.insert(outbox).values({
				entityType: "item",
				entityKey: parent.key,
				operation: "upsert",
				revision: parentRevision,
			});
		}
		await transaction
			.delete(itemDraft)
			.where(eq(itemDraft.itemKey, itemKey));

		return published!;
	});
}

export async function unpublishNativeItem(
	db: Database,
	itemKey: string,
) {
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
		const keysToLock =
			candidate.itemType === "Attachment" &&
			typeof candidate.parentItem === "string"
				? [itemKey, candidate.parentItem]
				: [itemKey];
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
		await transaction.insert(outbox).values({
			entityType: "item",
			entityKey: itemKey,
			operation: "delete",
			revision: nextRevision,
		});
		const parent =
			typeof current.parentItem === "string"
				? lockedItems.find(
						(candidate) =>
							candidate.key === current.parentItem,
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

export async function discardNativeItemDraft(
	db: Database,
	itemKey: string,
) {
	return db.transaction(async (transaction) => {
		const [discarded] = await transaction
			.delete(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, itemKey),
					eq(
						itemDraft.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.returning({ itemKey: itemDraft.itemKey });
		if (!discarded) {
			throw new NativeItemNotFoundError(itemKey);
		}

		const [published] = await transaction
			.select({ key: item.key })
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1);
		if (!published) {
			await transaction
				.delete(itemIdentity)
				.where(eq(itemIdentity.key, itemKey));
		}
	});
}
