import {
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
	itemKey,
	operation,
	sourceConnectionKey,
}: {
	canonicalRevision: number;
	itemKey: string;
	operation: SourceWritebackOperation;
	sourceConnectionKey: string;
}) {
	return [
		"source-writeback",
		sourceConnectionKey,
		itemKey,
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
				itemKey,
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
