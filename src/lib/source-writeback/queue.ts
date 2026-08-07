import {
	collectionSourceLink,
	itemSourceLink,
	sourceConnection,
	sourceWritebackJob,
	type SourceWritebackOperation,
} from "@opendeved/evidence-library-core";
import { and, eq, ne } from "drizzle-orm";

import type { Database } from "@/db/database-schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class SourceWritebackTargetKeyCollisionError extends Error {
	constructor(itemKey: string, sourceConnectionKey: string) {
		super(
			`Canonical item key ${itemKey} is already used by another record in writeback target ${sourceConnectionKey}`,
		);
		this.name = "SourceWritebackTargetKeyCollisionError";
	}
}

export function sourceWritebackIdempotencyKey({
	canonicalRevision,
	entityKey,
	entity,
	operation,
	sourceConnectionKey,
}: {
	canonicalRevision: number;
	entity: "collection" | "item";
	entityKey: string;
	operation: SourceWritebackOperation;
	sourceConnectionKey: string;
}) {
	return [
		"source-writeback",
		sourceConnectionKey,
		entity,
		entityKey,
		canonicalRevision,
		operation,
	].join(":");
}

export async function enqueueSourceWritebackJob(
	transaction: Transaction,
	{
		canonicalRevision,
		dirtyFields,
		itemKey,
		operation,
		sourceConnectionKey,
	}: {
		canonicalRevision: number;
		dirtyFields: readonly string[];
		itemKey: string;
		operation: SourceWritebackOperation;
		sourceConnectionKey: string;
	},
) {
	const normalizedDirtyFields = [...new Set(dirtyFields)].sort();
	const [job] = await transaction
		.insert(sourceWritebackJob)
		.values({
			canonicalRevision,
			dirtyFields: normalizedDirtyFields,
			idempotencyKey: sourceWritebackIdempotencyKey({
				canonicalRevision,
				entity: "item",
				entityKey: itemKey,
				operation,
				sourceConnectionKey,
			}),
			itemKey,
			operation,
			sourceConnectionKey,
		})
		.onConflictDoNothing()
		.returning();
	return job ?? null;
}

export async function enqueueCollectionWritebackJob(
	transaction: Transaction,
	{
		canonicalRevision,
		collectionKey,
		dirtyFields,
		operation,
		sourceConnectionKey,
	}: {
		canonicalRevision: number;
		collectionKey: string;
		dirtyFields: readonly string[];
		operation: SourceWritebackOperation;
		sourceConnectionKey: string;
	},
) {
	const normalizedDirtyFields = [...new Set(dirtyFields)].sort();
	const [job] = await transaction
		.insert(sourceWritebackJob)
		.values({
			canonicalRevision,
			collectionKey,
			dirtyFields: normalizedDirtyFields,
			idempotencyKey: sourceWritebackIdempotencyKey({
				canonicalRevision,
				entity: "collection",
				entityKey: collectionKey,
				operation,
				sourceConnectionKey,
			}),
			operation,
			sourceConnectionKey,
		})
		.onConflictDoNothing()
		.returning();
	return job ?? null;
}

async function markCollectionWriteback(
	transaction: Transaction,
	{
		canonicalRevision,
		collectionKey,
		dirtyFields,
		operation,
		updatedAt,
	}: {
		canonicalRevision: number;
		collectionKey: string;
		dirtyFields: readonly string[];
		operation: SourceWritebackOperation;
		updatedAt: Date;
	},
) {
	const changedFields = [...new Set(dirtyFields)].sort();
	if (changedFields.length === 0) return;

	const links = await transaction
		.select()
		.from(collectionSourceLink)
		.where(eq(collectionSourceLink.collectionKey, collectionKey))
		.orderBy(collectionSourceLink.sourceConnectionKey)
		.for("update");
	for (const link of links) {
		const combinedDirtyFields = [
			...new Set([...link.dirtyFields, ...changedFields]),
		].sort();
		await transaction
			.update(collectionSourceLink)
			.set({ dirtyFields: combinedDirtyFields, updatedAt })
			.where(
				and(
					eq(collectionSourceLink.collectionKey, collectionKey),
					eq(
						collectionSourceLink.sourceConnectionKey,
						link.sourceConnectionKey,
					),
				),
			);
		if (link.writebackEnabled) {
			await enqueueCollectionWritebackJob(transaction, {
				canonicalRevision,
				collectionKey,
				dirtyFields: combinedDirtyFields,
				operation,
				sourceConnectionKey: link.sourceConnectionKey,
			});
		}
	}
}

// The caller must hold the canonical collection's advisory mutation lock so
// this read/merge cannot race ingestion or worker acknowledgement.
export function markCollectionWritebackDirty(
	transaction: Transaction,
	args: {
		canonicalRevision: number;
		collectionKey: string;
		dirtyFields: readonly string[];
		updatedAt: Date;
	},
) {
	return markCollectionWriteback(transaction, {
		...args,
		operation: "upsert",
	});
}

export function markCollectionWritebackDeleted(
	transaction: Transaction,
	args: {
		canonicalRevision: number;
		collectionKey: string;
		updatedAt: Date;
	},
) {
	return markCollectionWriteback(transaction, {
		...args,
		dirtyFields: ["deleted"],
		operation: "delete",
	});
}

// The caller must hold the canonical item's advisory mutation lock so this
// read/merge cannot race ingestion or worker acknowledgement.
export async function markItemWritebackDirty(
	transaction: Transaction,
	{
		canonicalRevision,
		dirtyFields,
		itemKey,
		updatedAt,
	}: {
		canonicalRevision: number;
		dirtyFields: readonly string[];
		itemKey: string;
		updatedAt: Date;
	},
) {
	const changedFields = [...new Set(dirtyFields)].sort();
	if (changedFields.length === 0) return;

	const links = await transaction
		.select()
		.from(itemSourceLink)
		.where(eq(itemSourceLink.itemKey, itemKey))
		.orderBy(itemSourceLink.sourceConnectionKey)
		.for("update");
	for (const link of links) {
		const combinedDirtyFields = [
			...new Set([...link.dirtyFields, ...changedFields]),
		].sort();
		await transaction
			.update(itemSourceLink)
			.set({
				dirtyFields: combinedDirtyFields,
				updatedAt,
			})
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(
						itemSourceLink.sourceConnectionKey,
						link.sourceConnectionKey,
					),
				),
			);
		if (link.writebackEnabled) {
			await enqueueSourceWritebackJob(transaction, {
				canonicalRevision,
				dirtyFields: combinedDirtyFields,
				itemKey,
				operation: "upsert",
				sourceConnectionKey: link.sourceConnectionKey,
			});
		}
	}
}

// Any API that changes a link from writebackEnabled=false to true must enqueue
// an upsert for the link's retained dirtyFields. Disabled links deliberately
// keep those fields after their older jobs are superseded.

export async function ensureDefaultWritebackLink(
	transaction: Transaction,
	itemKey: string,
) {
	const [enabledLink] = await transaction
		.select()
		.from(itemSourceLink)
		.where(
			and(
				eq(itemSourceLink.itemKey, itemKey),
				eq(itemSourceLink.writebackEnabled, true),
			),
		)
		.limit(1);
	if (enabledLink) return enabledLink;

	const [target] = await transaction
		.select({ key: sourceConnection.key })
		.from(sourceConnection)
		.where(
			and(
				eq(sourceConnection.defaultWriteback, true),
				ne(sourceConnection.status, "removed"),
			),
		)
		.limit(1)
		.for("key share");
	if (!target) return null;

	const [insertedLink] = await transaction
		.insert(itemSourceLink)
		.values({
			itemKey,
			sourceConnectionKey: target.key,
			sourceRecordKey: itemKey,
			writebackEnabled: true,
		})
		.onConflictDoNothing()
		.returning();
	if (insertedLink) return insertedLink;

	const [existingLink] = await transaction
		.select()
		.from(itemSourceLink)
		.where(
			and(
				eq(itemSourceLink.itemKey, itemKey),
				eq(itemSourceLink.sourceConnectionKey, target.key),
			),
		)
		.limit(1)
		.for("update");
	if (existingLink) return existingLink;
	throw new SourceWritebackTargetKeyCollisionError(itemKey, target.key);
}
