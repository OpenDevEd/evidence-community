import {
	collectionSourceLink,
	itemSourceLink,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	lockCollectionMutation,
	lockCollectionMutations,
	lockItemMutations,
} from "@/db/canonical-mutation-lock";
import type { Database } from "@/db/database-schema";
import { reserveCollectionIdentity } from "@/db/record-identity";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import {
	evaluateSourceWritebackPolicy,
	resolveCollectionWritebackPolicy,
	type SourceWritebackReason,
} from "@/lib/source-writeback/policy";
import {
	markCollectionWritebackDeleted,
	markCollectionWritebackDirty,
	markItemWritebackDirty,
} from "@/lib/source-writeback/queue";

import { collectionDescendantKeys } from "./collection-hierarchy";
import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import { advanceOpenItemDraftBaseRevision } from "./native-item-service";
import {
	assertExpectedNativeCollectionRevision,
	assertValidCollectionParent,
	CollectionNotFoundError,
	CollectionValidationError,
	createNativeCollection,
	deleteNativeCollection,
	moveNativeCollection,
	nativeCollectionRestoreCohortKeys,
	normalizeNativeCollectionMoveInput,
	normalizeNativeCollectionRenameInput,
	normalizeNativeCollectionRevisionInput,
	renameNativeCollection,
	restoreNativeCollection,
} from "./native-collection-service";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CollectionMutationOptions = {
	writebackConfig: Pick<LibraryServerConfig, "sources">;
};

const createCollectionInputSchema = z
	.object({
		name: z.string().trim().min(1).max(255),
		parentCollection: z.string().length(8).nullable().default(null),
		sourceConnectionKey: z
			.string()
			.trim()
			.min(1)
			.max(64)
			.default(NATIVE_SOURCE_CONNECTION_KEY),
	})
	.strict();

export class CollectionWritebackUnavailableError extends Error {
	readonly reason: SourceWritebackReason;

	constructor(collectionKey: string, reason: SourceWritebackReason) {
		super(
			`Collection writeback is unavailable (${reason}): ${collectionKey}`,
		);
		this.name = "CollectionWritebackUnavailableError";
		this.reason = reason;
	}
}

async function lockSourceCollectionMutations(
	transaction: Transaction,
	sourceConnectionKey: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtextextended('admin-collections:' || ${sourceConnectionKey}, 0))`,
	);
	await transaction
		.select({ key: sourceConnection.key })
		.from(sourceConnection)
		.where(eq(sourceConnection.key, sourceConnectionKey))
		.for("update");
}

async function requireSourceWriteback(
	transaction: Transaction,
	collectionKey: string,
	options: CollectionMutationOptions,
) {
	const policy = await resolveCollectionWritebackPolicy(
		transaction,
		collectionKey,
		options.writebackConfig,
	);
	if (!policy.effective) {
		throw new CollectionWritebackUnavailableError(
			collectionKey,
			policy.reason,
		);
	}
	return policy;
}

async function requireSourceTarget(
	transaction: Transaction,
	sourceConnectionKey: string,
	options: CollectionMutationOptions,
) {
	const [connection] = await transaction
		.select()
		.from(sourceConnection)
		.where(eq(sourceConnection.key, sourceConnectionKey))
		.limit(1);
	const policy = evaluateSourceWritebackPolicy(
		connection
			? {
					externalScopeKey: connection.externalScopeKey,
					itemEnabled: true,
					provider: connection.provider,
					sourceKey: connection.key,
					sourceStatus: connection.status,
				}
			: null,
		options.writebackConfig,
	);
	if (!policy.effective) {
		throw new CollectionWritebackUnavailableError(
			sourceConnectionKey,
			policy.reason,
		);
	}
	return connection!;
}

async function sourceCollectionRows(
	transaction: Transaction,
	sourceConnectionKey: string,
) {
	return transaction
		.select()
		.from(collection)
		.where(eq(collection.sourceConnectionKey, sourceConnectionKey))
		.orderBy(asc(collection.key));
}

async function emitCollectionEvents(
	transaction: Transaction,
	rows: Array<{ key: string; revision: number }>,
	operation: "delete" | "upsert",
) {
	if (rows.length === 0) return;
	await transaction.insert(outbox).values(
		rows.map((row) => ({
			entityKey: row.key,
			entityType: "collection" as const,
			operation,
			revision: row.revision,
		})),
	);
}

export async function createAdminCollection(
	database: Database,
	input: unknown,
	options: CollectionMutationOptions,
) {
	const values = createCollectionInputSchema.parse(input);
	if (values.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
		return createNativeCollection(database, {
			name: values.name,
			parentCollection: values.parentCollection,
		});
	}

	return database.transaction(async (transaction) => {
		await lockSourceCollectionMutations(
			transaction,
			values.sourceConnectionKey,
		);
		await requireSourceTarget(
			transaction,
			values.sourceConnectionKey,
			options,
		);
		const rows = await sourceCollectionRows(
			transaction,
			values.sourceConnectionKey,
		);
		assertValidCollectionParent(
			rows,
			values.sourceConnectionKey,
			null,
			values.parentCollection,
			"Choose an active collection from the same source.",
		);
		const key = await reserveCollectionIdentity(transaction, {
			sourceConnectionKey: values.sourceConnectionKey,
		});
		await lockCollectionMutation(transaction, key);
		const now = new Date();
		const [created] = await transaction
			.insert(collection)
			.values({
				key,
				name: values.name,
				parentCollection: values.parentCollection,
				sourceConnectionKey: values.sourceConnectionKey,
				sourceRecordKey: key,
				updatedAt: now,
			})
			.returning();
		await transaction.insert(collectionSourceLink).values({
			collectionKey: key,
			sourceConnectionKey: values.sourceConnectionKey,
			sourceRecordKey: key,
			writebackEnabled: true,
		});
		await markCollectionWritebackDirty(transaction, {
			canonicalRevision: created!.revision,
			collectionKey: key,
			dirtyFields: ["name", "parentCollection"],
			updatedAt: now,
		});
		await emitCollectionEvents(transaction, [created!], "upsert");
		return created!;
	});
}

export async function renameAdminCollection(
	database: Database,
	collectionKey: string,
	input: unknown,
	options: CollectionMutationOptions,
) {
	const values = normalizeNativeCollectionRenameInput(input);
	const [identity] = await database
		.select({ sourceConnectionKey: collection.sourceConnectionKey })
		.from(collection)
		.where(eq(collection.key, collectionKey))
		.limit(1);
	if (!identity) throw new CollectionNotFoundError(collectionKey);
	if (identity.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
		return renameNativeCollection(database, collectionKey, values);
	}

	return database.transaction(async (transaction) => {
		await lockSourceCollectionMutations(
			transaction,
			identity.sourceConnectionKey,
		);
		await lockCollectionMutation(transaction, collectionKey);
		await requireSourceWriteback(transaction, collectionKey, options);
		const [current] = await transaction
			.select()
			.from(collection)
			.where(eq(collection.key, collectionKey))
			.for("update")
			.limit(1);
		if (!current) throw new CollectionNotFoundError(collectionKey);
		if (current.deleted === 1) {
			throw new CollectionValidationError(
				"Restore this collection before renaming it.",
				{ name: "Deleted collections cannot be renamed." },
			);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		if (current.name === values.name) return current;

		const now = new Date();
		const [updated] = await transaction
			.update(collection)
			.set({
				name: values.name,
				revision: sql`${collection.revision} + 1`,
				updatedAt: now,
			})
			.where(eq(collection.key, collectionKey))
			.returning();
		await markCollectionWritebackDirty(transaction, {
			canonicalRevision: updated!.revision,
			collectionKey,
			dirtyFields: ["name"],
			updatedAt: now,
		});
		await emitCollectionEvents(transaction, [updated!], "upsert");
		return updated!;
	});
}

export async function moveAdminCollection(
	database: Database,
	collectionKey: string,
	input: unknown,
	options: CollectionMutationOptions,
) {
	const values = normalizeNativeCollectionMoveInput(input);
	const [identity] = await database
		.select({ sourceConnectionKey: collection.sourceConnectionKey })
		.from(collection)
		.where(eq(collection.key, collectionKey))
		.limit(1);
	if (!identity) throw new CollectionNotFoundError(collectionKey);
	if (identity.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
		return moveNativeCollection(database, collectionKey, values);
	}

	return database.transaction(async (transaction) => {
		await lockSourceCollectionMutations(
			transaction,
			identity.sourceConnectionKey,
		);
		const initialRows = await sourceCollectionRows(
			transaction,
			identity.sourceConnectionKey,
		);
		const targetKey =
			values.position === "root" ? null : values.targetCollection;
		await lockCollectionMutations(transaction, [
			collectionKey,
			...(targetKey ? [targetKey] : []),
		]);
		await requireSourceWriteback(transaction, collectionKey, options);
		const rows = targetKey
			? await sourceCollectionRows(
					transaction,
					identity.sourceConnectionKey,
				)
			: initialRows;
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) throw new CollectionNotFoundError(collectionKey);
		if (current.deleted === 1) {
			throw new CollectionValidationError(
				"Restore this collection before moving it.",
				{ parentCollection: "Deleted collections cannot be moved." },
			);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		let parentCollection: string | null = null;
		if (values.position !== "root") {
			const target = rows.find(
				(row) =>
					row.key === values.targetCollection && row.deleted !== 1,
			);
			if (!target) {
				throw new CollectionValidationError(
					"Choose another collection position.",
					{
						targetCollection:
							"Choose an active collection from the same source.",
					},
				);
			}
			parentCollection =
				values.position === "inside"
					? target.key
					: target.parentCollection;
		}
		assertValidCollectionParent(
			rows,
			identity.sourceConnectionKey,
			collectionKey,
			parentCollection,
			"Choose an active collection from the same source.",
		);
		if (current.parentCollection === parentCollection) {
			return {
				collection: current,
				collections: [],
				indexingCollections: [],
			};
		}

		const now = new Date();
		const [updated] = await transaction
			.update(collection)
			.set({
				parentCollection,
				revision: sql`${collection.revision} + 1`,
				updatedAt: now,
			})
			.where(eq(collection.key, collectionKey))
			.returning();
		await markCollectionWritebackDirty(transaction, {
			canonicalRevision: updated!.revision,
			collectionKey,
			dirtyFields: ["parentCollection"],
			updatedAt: now,
		});
		await emitCollectionEvents(transaction, [updated!], "upsert");
		return {
			collection: updated!,
			collections: [updated!],
			indexingCollections: [updated!],
		};
	});
}

export async function deleteAdminCollection(
	database: Database,
	collectionKey: string,
	input: unknown,
	options: CollectionMutationOptions,
) {
	const values = normalizeNativeCollectionRevisionInput(input);
	const [identity] = await database
		.select({ sourceConnectionKey: collection.sourceConnectionKey })
		.from(collection)
		.where(eq(collection.key, collectionKey))
		.limit(1);
	if (!identity) throw new CollectionNotFoundError(collectionKey);
	if (identity.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
		return deleteNativeCollection(database, collectionKey, values);
	}

	return database.transaction(async (transaction) => {
		await lockSourceCollectionMutations(
			transaction,
			identity.sourceConnectionKey,
		);
		const initialRows = await sourceCollectionRows(
			transaction,
			identity.sourceConnectionKey,
		);
		const initialCurrent = initialRows.find(
			({ key }) => key === collectionKey,
		);
		if (!initialCurrent) throw new CollectionNotFoundError(collectionKey);
		const initialKeys = [
			collectionKey,
			...collectionDescendantKeys(initialRows, collectionKey),
		];
		await lockCollectionMutations(transaction, initialKeys);
		await requireSourceWriteback(transaction, collectionKey, options);
		const rows = await sourceCollectionRows(
			transaction,
			identity.sourceConnectionKey,
		);
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) throw new CollectionNotFoundError(collectionKey);
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		const keys = [
			collectionKey,
			...collectionDescendantKeys(rows, collectionKey),
		];
		if (
			keys.length !== initialKeys.length ||
			keys.some((key, index) => key !== initialKeys[index])
		) {
			throw new CollectionValidationError(
				"The collection hierarchy changed. Reload and try again.",
			);
		}
		for (const key of keys) {
			await requireSourceWriteback(transaction, key, options);
		}
		const now = new Date();
		const updated = await transaction
			.update(collection)
			.set({
				deleted: 1,
				deletedAt: now,
				revision: sql`${collection.revision} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					inArray(collection.key, keys),
					eq(
						collection.sourceConnectionKey,
						identity.sourceConnectionKey,
					),
					eq(collection.deleted, 0),
				),
			)
			.returning();
		for (const row of updated) {
			await markCollectionWritebackDeleted(transaction, {
				canonicalRevision: row.revision,
				collectionKey: row.key,
				updatedAt: now,
			});
		}
		await emitCollectionEvents(transaction, updated, "delete");
		return updated;
	});
}

export async function restoreAdminCollection(
	database: Database,
	collectionKey: string,
	input: unknown,
	options: CollectionMutationOptions,
) {
	const values = normalizeNativeCollectionRevisionInput(input);
	const [identity] = await database
		.select({ sourceConnectionKey: collection.sourceConnectionKey })
		.from(collection)
		.where(eq(collection.key, collectionKey))
		.limit(1);
	if (!identity) throw new CollectionNotFoundError(collectionKey);
	if (identity.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
		const result = await restoreNativeCollection(
			database,
			collectionKey,
			values,
		);
		return { ...result, indexingItems: [] };
	}

	return database.transaction(async (transaction) => {
		await lockSourceCollectionMutations(
			transaction,
			identity.sourceConnectionKey,
		);
		const initialRows = await sourceCollectionRows(
			transaction,
			identity.sourceConnectionKey,
		);
		const initialCurrent = initialRows.find(
			({ key }) => key === collectionKey,
		);
		if (!initialCurrent) throw new CollectionNotFoundError(collectionKey);
		const initialCohortKeys = initialCurrent.deletedAt
			? nativeCollectionRestoreCohortKeys(
					initialRows,
					collectionKey,
					initialCurrent.deletedAt,
				)
			: [collectionKey];
		await lockCollectionMutations(transaction, initialCohortKeys);
		await requireSourceWriteback(transaction, collectionKey, options);
		const rows = await sourceCollectionRows(
			transaction,
			identity.sourceConnectionKey,
		);
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) throw new CollectionNotFoundError(collectionKey);
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		if (current.deleted !== 1) {
			return { collection: current, collections: [], indexingItems: [] };
		}
		if (!current.deletedAt) {
			throw new CollectionValidationError(
				"This collection could not be restored.",
				{
					_form: "Reload the page and try again. If the problem continues, contact support.",
				},
			);
		}
		const parent = current.parentCollection
			? rows.find(({ key }) => key === current.parentCollection)
			: null;
		const parentCollection =
			parent && parent.deleted !== 1 ? parent.key : null;
		const cohortKeys = nativeCollectionRestoreCohortKeys(
			rows,
			collectionKey,
			current.deletedAt,
		);
		if (
			cohortKeys.length !== initialCohortKeys.length ||
			cohortKeys.some((key, index) => key !== initialCohortKeys[index])
		) {
			throw new CollectionValidationError(
				"The collection hierarchy changed. Reload and try again.",
			);
		}
		for (const key of cohortKeys) {
			await requireSourceWriteback(transaction, key, options);
		}
		const now = new Date();
		const restored = await transaction
			.update(collection)
			.set({
				deleted: 0,
				deletedAt: null,
				revision: sql`${collection.revision} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					inArray(collection.key, cohortKeys),
					eq(
						collection.sourceConnectionKey,
						identity.sourceConnectionKey,
					),
				),
			)
			.returning();
		let restoredRoot = restored.find(({ key }) => key === collectionKey)!;
		if (restoredRoot.parentCollection !== parentCollection) {
			[restoredRoot] = await transaction
				.update(collection)
				.set({ parentCollection, updatedAt: now })
				.where(eq(collection.key, collectionKey))
				.returning();
			const rootIndex = restored.findIndex(
				({ key }) => key === collectionKey,
			);
			restored[rootIndex] = restoredRoot!;
		}
		for (const row of restored) {
			await markCollectionWritebackDirty(transaction, {
				canonicalRevision: row.revision,
				collectionKey: row.key,
				dirtyFields: [
					"deleted",
					...(row.key === collectionKey &&
					row.parentCollection !== current.parentCollection
						? ["parentCollection"]
						: []),
				],
				updatedAt: now,
			});
		}
		const memberCandidates = await transaction
			.selectDistinct({ key: item.key })
			.from(itemToCollection)
			.innerJoin(item, eq(item.key, itemToCollection.itemKey))
			.innerJoin(
				itemSourceLink,
				and(
					eq(itemSourceLink.itemKey, item.key),
					eq(
						itemSourceLink.sourceConnectionKey,
						identity.sourceConnectionKey,
					),
				),
			)
			.where(
				and(
					inArray(itemToCollection.collectionKey, cohortKeys),
					eq(item.deleted, 0),
				),
			)
			.orderBy(item.key);
		const memberKeys = memberCandidates.map(({ key }) => key);
		await lockItemMutations(transaction, memberKeys);
		const lockedMembers =
			memberKeys.length === 0
				? []
				: await transaction
						.select()
						.from(item)
						.where(
							and(
								inArray(item.key, memberKeys),
								eq(item.deleted, 0),
							),
						)
						.orderBy(item.key)
						.for("update");
		const lockedMemberKeys = lockedMembers.map(({ key }) => key);
		const indexingItems =
			lockedMemberKeys.length === 0
				? []
				: await transaction
						.update(item)
						.set({
							revision: sql`${item.revision} + 1`,
							updatedAt: now,
						})
						.where(inArray(item.key, lockedMemberKeys))
						.returning();
		for (const member of indexingItems) {
			const previous = lockedMembers.find(
				({ key }) => key === member.key,
			)!;
			await advanceOpenItemDraftBaseRevision(
				transaction,
				member.key,
				previous.revision,
				member.revision,
			);
			await markItemWritebackDirty(transaction, {
				canonicalRevision: member.revision,
				dirtyFields: [],
				dirtyFieldsBySource: {
					[identity.sourceConnectionKey]: ["collections"],
				},
				itemKey: member.key,
				updatedAt: now,
			});
		}
		if (indexingItems.length > 0) {
			await transaction.insert(outbox).values(
				indexingItems.map((member) => ({
					entityKey: member.key,
					entityType: "item" as const,
					operation: "upsert" as const,
					revision: member.revision,
				})),
			);
		}
		await emitCollectionEvents(transaction, restored, "upsert");
		return {
			collection: restoredRoot!,
			collections: restored,
			indexingItems,
		};
	});
}
