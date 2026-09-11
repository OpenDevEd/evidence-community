import { LIBRARY_OWNED_PAYLOAD_FIELDS } from "@/lib/admin/item-fields";
import {
	collectionSourceLink,
	itemSourceLink,
	sourceConnection,
	sourceWritebackJob,
	type SourceWritebackOperation,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { editableItemDatabaseFields } from "@/lib/admin/item-draft-patch";
import { databaseItemFieldToPayloadField } from "@/lib/item-field-codec";

import {
	configuredWritebackSourceKeys,
	WRITEBACK_SUPPORTED_PROVIDERS,
	type SourceWritebackConfiguration,
} from "./policy";

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
		dirtyFieldsBySource = {},
		itemKey,
		updatedAt,
	}: {
		canonicalRevision: number;
		dirtyFields: readonly string[];
		dirtyFieldsBySource?: Readonly<
			Record<string, readonly string[] | undefined>
		>;
		itemKey: string;
		updatedAt: Date;
	},
) {
	const commonChangedFields = [...new Set(dirtyFields)].filter((field) => !LIBRARY_OWNED_PAYLOAD_FIELDS.has(field)).sort();
	if (
		commonChangedFields.length === 0 &&
		Object.keys(dirtyFieldsBySource).length === 0
	) {
		return;
	}

	const links = await transaction
		.select()
		.from(itemSourceLink)
		.where(eq(itemSourceLink.itemKey, itemKey))
		.orderBy(itemSourceLink.sourceConnectionKey)
		.for("update");
	for (const link of links) {
		const changedFields = [
			...new Set([
				...commonChangedFields,
				...(dirtyFieldsBySource[link.sourceConnectionKey] ?? []),
			]),
		].sort();
		if (changedFields.length === 0) continue;
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

export class SourceWritebackUnknownSourceError extends Error {
	constructor(readonly sourceKeys: readonly string[]) {
		super(
			`These sources cannot receive writeback for this record: ${sourceKeys.join(", ")}`,
		);
		this.name = "SourceWritebackUnknownSourceError";
	}
}

/**
 * Works out how a record's source links must change so that exactly the
 * given sources are enabled. Links are never deleted; unselected sources are
 * only disabled so their history and remote copy stay.
 */
export function planItemWritebackLinkChanges({
	allowedSourceKeys,
	existingLinks,
	sourceKeys,
}: {
	allowedSourceKeys: ReadonlySet<string>;
	existingLinks: readonly {
		sourceConnectionKey: string;
		writebackEnabled: boolean;
	}[];
	sourceKeys: readonly string[];
}) {
	const wanted = [...new Set(sourceKeys)];
	const invalid = wanted.filter((key) => !allowedSourceKeys.has(key));
	const enabled = wanted.filter((key) => allowedSourceKeys.has(key));
	const enabledSet = new Set(enabled);
	const existingByKey = new Map(
		existingLinks.map((link) => [link.sourceConnectionKey, link] as const),
	);
	const insert = enabled.filter((key) => !existingByKey.has(key));
	const enable = enabled.filter((key) => {
		const link = existingByKey.get(key);
		return link !== undefined && !link.writebackEnabled;
	});
	const disable = existingLinks
		.filter(
			(link) =>
				link.writebackEnabled && !enabledSet.has(link.sourceConnectionKey),
		)
		.map((link) => link.sourceConnectionKey);
	return {
		disable,
		enable,
		enabled,
		insert,
		invalid,
		newlyEnabled: enabled.filter(
			(key) => insert.includes(key) || enable.includes(key),
		),
	};
}

async function allowedWritebackSourceKeys(
	transaction: Transaction,
	configuration: SourceWritebackConfiguration,
) {
	const configured = configuredWritebackSourceKeys(configuration);
	const rows = await transaction
		.select({ key: sourceConnection.key, provider: sourceConnection.provider })
		.from(sourceConnection)
		.where(ne(sourceConnection.status, "removed"))
		.for("key share");
	return new Set(
		rows
			.filter(
				(row) =>
					configured.has(row.key) &&
					WRITEBACK_SUPPORTED_PROVIDERS.some(
						(provider) => provider === row.provider,
					),
			)
			.map((row) => row.key),
	);
}

async function applyItemWritebackLinkPlan(
	transaction: Transaction,
	itemKey: string,
	plan: ReturnType<typeof planItemWritebackLinkChanges>,
) {
	if (plan.invalid.length > 0) {
		throw new SourceWritebackUnknownSourceError(plan.invalid);
	}
	for (const sourceConnectionKey of plan.insert) {
		const [inserted] = await transaction
			.insert(itemSourceLink)
			.values({
				itemKey,
				sourceConnectionKey,
				sourceRecordKey: itemKey,
				writebackEnabled: true,
			})
			.onConflictDoNothing()
			.returning({ itemKey: itemSourceLink.itemKey });
		if (!inserted) {
			throw new SourceWritebackTargetKeyCollisionError(
				itemKey,
				sourceConnectionKey,
			);
		}
	}
	if (plan.enable.length > 0) {
		// A source that already holds a copy must be checked for changes made
		// while this link was paused, before anything is sent to it. The check
		// is bound to this exact moment so an older check cannot answer for it.
		const enabledAt = new Date();
		await transaction
			.update(itemSourceLink)
			.set({
				remoteCheckRequestedAt: sql`CASE WHEN ${itemSourceLink.remoteVersion} IS NOT NULL THEN ${enabledAt.toISOString()}::timestamptz ELSE NULL END`,
				updatedAt: enabledAt,
				writebackEnabled: true,
			})
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					inArray(itemSourceLink.sourceConnectionKey, plan.enable),
				),
			);
	}
	if (plan.disable.length > 0) {
		await transaction
			.update(itemSourceLink)
			.set({
				conflictRemoteVersion: null,
				remoteCheckRequestedAt: null,
				updatedAt: new Date(),
				writebackEnabled: false,
			})
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					inArray(itemSourceLink.sourceConnectionKey, plan.disable),
				),
			);
	}
	return { enabled: plan.enabled, newlyEnabled: plan.newlyEnabled };
}

async function lockedItemWritebackLinks(
	transaction: Transaction,
	itemKey: string,
) {
	return transaction
		.select({
			sourceConnectionKey: itemSourceLink.sourceConnectionKey,
			writebackEnabled: itemSourceLink.writebackEnabled,
		})
		.from(itemSourceLink)
		.where(eq(itemSourceLink.itemKey, itemKey))
		.for("update");
}

/**
 * Makes exactly `sourceKeys` the enabled writeback sources for one record.
 *
 * A new link uses the record's own key as the remote key. Unselected links
 * are disabled, never deleted. The caller must hold the record's mutation
 * lock and, when the record is published, enqueue a writeback for every
 * `newlyEnabled` source.
 */
export async function ensureItemWritebackLinks(
	transaction: Transaction,
	{
		configuration,
		itemKey,
		sourceKeys,
	}: {
		configuration: SourceWritebackConfiguration;
		itemKey: string;
		sourceKeys: readonly string[];
	},
) {
	const [allowed, existingLinks] = await Promise.all([
		allowedWritebackSourceKeys(transaction, configuration),
		lockedItemWritebackLinks(transaction, itemKey),
	]);
	return applyItemWritebackLinkPlan(
		transaction,
		itemKey,
		planItemWritebackLinkChanges({
			allowedSourceKeys: allowed,
			existingLinks,
			sourceKeys,
		}),
	);
}

/**
 * Copies the parent's enabled sources onto one child record (an attachment
 * or note). The parent's selection was validated when it was set, so no
 * config check is needed here.
 */
export async function applyParentWritebackLinks(
	transaction: Transaction,
	{ itemKey, parentItemKey }: { itemKey: string; parentItemKey: string },
) {
	const [sourceKeys, existingLinks] = await Promise.all([
		resolveChildWritebackSourceKeys(transaction, parentItemKey),
		lockedItemWritebackLinks(transaction, itemKey),
	]);
	return applyItemWritebackLinkPlan(
		transaction,
		itemKey,
		planItemWritebackLinkChanges({
			allowedSourceKeys: new Set(sourceKeys),
			existingLinks,
			sourceKeys,
		}),
	);
}

/**
 * The fields a source receives when the whole record is sent to it: every
 * editable field plus tags, so empty local fields clear stale remote values.
 * The item type is not named because that would mean a type change. The
 * provider mapper skips fields the item type does not have when they are
 * empty locally.
 */
export function fullItemWritebackFields() {
	return [
		...editableItemDatabaseFields
			.filter((field) => field !== "itemType" && !LIBRARY_OWNED_PAYLOAD_FIELDS.has(field))
			.map(databaseItemFieldToPayloadField),
		"tags",
	];
}

/**
 * Sends the whole current record to sources that were just enabled for it.
 * Used when a published record gains a source outside a normal publish, or
 * when a publish changes nothing else. Unpublished records are skipped.
 */
export async function enqueueFullWritebackForSources(
	transaction: Transaction,
	{
		itemKey,
		sourceKeys,
		updatedAt = new Date(),
	}: {
		itemKey: string;
		sourceKeys: readonly string[];
		updatedAt?: Date;
	},
) {
	if (sourceKeys.length === 0) return;
	const [row] = await transaction
		.select({ deleted: item.deleted, revision: item.revision })
		.from(item)
		.where(eq(item.key, itemKey))
		.limit(1);
	if (!row || row.deleted === 1) return;
	const fields = fullItemWritebackFields();
	await markItemWritebackDirty(transaction, {
		canonicalRevision: row.revision,
		dirtyFields: [],
		dirtyFieldsBySource: Object.fromEntries(
			sourceKeys.map((sourceKey) => [sourceKey, fields]),
		),
		itemKey,
		updatedAt,
	});
	// A job for this revision may already exist: run, superseded, dead, or
	// still pending with only a few fields. Its idempotency key blocks a second
	// insert, so make that job carry the whole record and be runnable again.
	// A job a worker is running right now is left alone: the fields stay dirty
	// on the link and the worker re-arms the job for them when it finishes.
	for (const sourceConnectionKey of sourceKeys) {
		await transaction
			.update(sourceWritebackJob)
			.set({
				attempts: 0,
				deadLetteredAt: null,
				dirtyFields: fields,
				lastError: null,
				nextAttemptAt: updatedAt,
				processedAt: null,
				superseded: false,
			})
			.where(
				and(
					eq(sourceWritebackJob.itemKey, itemKey),
					eq(sourceWritebackJob.sourceConnectionKey, sourceConnectionKey),
					eq(sourceWritebackJob.canonicalRevision, row.revision),
					eq(sourceWritebackJob.operation, "upsert"),
					or(
						isNull(sourceWritebackJob.leaseOwner),
						sql`${sourceWritebackJob.leaseExpiresAt} <= ${updatedAt}`,
					),
				),
			);
	}
}

/** The sources a parent record currently sends to; children copy this. */
export async function resolveChildWritebackSourceKeys(
	transaction: Transaction,
	parentItemKey: string,
) {
	const links = await transaction
		.select({ sourceConnectionKey: itemSourceLink.sourceConnectionKey })
		.from(itemSourceLink)
		.where(
			and(
				eq(itemSourceLink.itemKey, parentItemKey),
				eq(itemSourceLink.writebackEnabled, true),
			),
		);
	return links.map((link) => link.sourceConnectionKey);
}

/** The keys of a record's attachments and notes. */
export async function childItemKeys(
	executor: Database | Transaction,
	parentItemKey: string,
) {
	const children = await executor
		.select({ key: item.key })
		.from(item)
		.where(eq(item.parentItem, parentItemKey));
	return children.map((child) => child.key);
}

/**
 * Applies the parent's selection to every child record (attachments and
 * notes) so they always follow the parent. Returns the child keys whose
 * enabled sources changed, with the sources that became newly enabled.
 *
 * The caller must already hold the mutation locks of the parent and its
 * children (`lockItemMutations([parent, ...childItemKeys])`), so a child
 * publish running at the same time cannot copy a selection that is about
 * to change.
 */
export async function cascadeChildWritebackLinks(
	transaction: Transaction,
	parentItemKey: string,
) {
	const children = await transaction
		.select({ key: item.key })
		.from(item)
		.where(eq(item.parentItem, parentItemKey));
	const changed: { itemKey: string; newlyEnabled: string[] }[] = [];
	for (const child of children) {
		const result = await applyParentWritebackLinks(transaction, {
			itemKey: child.key,
			parentItemKey,
		});
		if (result.newlyEnabled.length > 0) {
			changed.push({ itemKey: child.key, newlyEnabled: result.newlyEnabled });
		}
	}
	return changed;
}
