import {
	itemDraft,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import {
	and,
	eq,
	getTableColumns,
	sql,
	type InferInsertModel,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { reserveItemIdentity } from "@/db/record-identity";
import { item } from "@/db/schema/tables/item";
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

		const [tagRows, collectionRows] = await Promise.all([
			transaction
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, itemKey)),
			transaction
				.select({ key: itemToCollection.collectionKey })
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, itemKey)),
		]);

		const payload: Record<string, unknown> = {};
		for (const field of editableItemFields) {
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

		const [current] = await transaction
			.select()
			.from(item)
			.where(eq(item.key, itemKey))
			.for("update")
			.limit(1);
		const currentRevision = current?.revision ?? 0;
		if (currentRevision !== draft.baseRevision) {
			throw new NativeDraftConflictError(itemKey);
		}

		const validated = validateNativeItemDraft(draft.payload);
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
		const [current] = await transaction
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
		if (!current) {
			throw new NativeItemNotFoundError(itemKey);
		}
		if (current.deleted === 1) {
			return current;
		}

		const nextRevision = current.revision + 1;
		const [unpublished] = await transaction
			.update(item)
			.set({
				deleted: 1,
				deletedAt: new Date(),
				revision: nextRevision,
				updatedAt: new Date(),
			})
			.where(eq(item.key, itemKey))
			.returning();
		await transaction.insert(outbox).values({
			entityType: "item",
			entityKey: itemKey,
			operation: "delete",
			revision: nextRevision,
		});
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
