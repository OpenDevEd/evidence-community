import { isCanonicalRecordKey, outbox } from "@opendeved/evidence-library-core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import { reserveCollectionIdentity } from "@/db/record-identity";
import { collection } from "@/db/schema/tables/collection";

import { collectionDescendantKeys } from "./collection-hierarchy";
import { NATIVE_SOURCE_CONNECTION_KEY as NATIVE_CONNECTION_KEY } from "./constants";
import { AdminValidationError, type AdminFieldErrors } from "./errors";
export const NATIVE_COLLECTION_SORT_ORDER_STEP = 1024;

const collectionNameSchema = z.string().trim().min(1).max(255);
const collectionParentSchema = z
	.string()
	.refine(isCanonicalRecordKey, {
		message: "Choose an available collection.",
	})
	.nullable();
const expectedRevisionSchema = z.number().int().positive();

type NativeCollectionOrderRow = {
	deleted: number | null;
	key: string;
	name: string | null;
	parentCollection: string | null;
	sortOrder: number | null;
	sourceConnectionKey: string;
};

export class NativeCollectionNotFoundError extends Error {
	constructor(collectionKey: string) {
		super(`Native collection was not found: ${collectionKey}`);
		this.name = "NativeCollectionNotFoundError";
	}
}

export class NativeCollectionValidationError extends AdminValidationError {
	constructor(message: string, fields: AdminFieldErrors = {}) {
		super(message, fields);
		this.name = "NativeCollectionValidationError";
	}
}

export class NativeCollectionConflictError extends Error {
	readonly currentRevision: number;

	constructor(collectionKey: string, currentRevision: number) {
		super(`Native collection is stale: ${collectionKey}`);
		this.name = "NativeCollectionConflictError";
		this.currentRevision = currentRevision;
	}
}

export function normalizeNativeCollectionInput(input: unknown) {
	const parsed = z
		.object({
			name: collectionNameSchema,
			parentCollection: collectionParentSchema.optional().default(null),
		})
		.strict()
		.parse(input);
	return {
		name: parsed.name,
		parentCollection: parsed.parentCollection,
	};
}

export function normalizeNativeCollectionRenameInput(input: unknown) {
	return z
		.object({
			expectedRevision: expectedRevisionSchema,
			name: collectionNameSchema,
		})
		.strict()
		.parse(input);
}

export function normalizeNativeCollectionMoveInput(input: unknown) {
	return z
		.discriminatedUnion("position", [
			z
				.object({
					expectedRevision: expectedRevisionSchema,
					position: z.literal("root"),
				})
				.strict(),
			z
				.object({
					expectedRevision: expectedRevisionSchema,
					position: z.enum(["after", "before", "inside"]),
					targetCollection: collectionParentSchema.unwrap(),
				})
				.strict(),
		])
		.parse(input);
}

export type NativeCollectionMoveIntent =
	| { position: "root" }
	| {
			position: "after" | "before" | "inside";
			targetCollection: string;
	  };

export function normalizeNativeCollectionRevisionInput(input: unknown) {
	return z
		.object({
			expectedRevision: expectedRevisionSchema,
		})
		.strict()
		.parse(input);
}

export function assertExpectedNativeCollectionRevision(
	collectionRow: { key: string; revision: number },
	expectedRevision: number,
) {
	if (collectionRow.revision !== expectedRevision) {
		throw new NativeCollectionConflictError(
			collectionRow.key,
			collectionRow.revision,
		);
	}
}

export function assertValidNativeCollectionParent(
	rows: Array<{
		deleted: number | null;
		key: string;
		parentCollection: string | null;
		sourceConnectionKey: string;
	}>,
	collectionKey: string | null,
	parentCollection: string | null,
) {
	if (!parentCollection) return;
	const parentByKey = new Map(rows.map((row) => [row.key, row]));
	const parent = parentByKey.get(parentCollection);
	if (
		!parent ||
		parent.deleted === 1 ||
		parent.sourceConnectionKey !== NATIVE_CONNECTION_KEY
	) {
		throw new NativeCollectionValidationError(
			"Choose another parent collection.",
			{
				parentCollection:
					"Choose an active collection created in this library.",
			},
		);
	}

	const visited = new Set<string>();
	let cursor: string | null = parentCollection;
	while (cursor) {
		if (cursor === collectionKey) {
			throw new NativeCollectionValidationError(
				"Choose another parent collection.",
				{
					parentCollection:
						"A collection cannot be placed inside itself or one of its subcollections.",
				},
			);
		}
		if (visited.has(cursor)) {
			throw new NativeCollectionValidationError(
				"This collection hierarchy needs to be repaired before it can be changed.",
				{
					parentCollection:
						"The selected collection is already part of an invalid hierarchy.",
				},
			);
		}
		visited.add(cursor);
		cursor = parentByKey.get(cursor)?.parentCollection ?? null;
	}
}

export function nextNativeCollectionSortOrder(
	rows: Array<{
		deleted?: number | null;
		parentCollection: string | null;
		sortOrder: number | null;
		sourceConnectionKey: string;
	}>,
	parentCollection: string | null,
) {
	const maximum = rows.reduce(
		(current, row) =>
			row.sourceConnectionKey === NATIVE_CONNECTION_KEY &&
			row.deleted !== 1 &&
			row.parentCollection === parentCollection
				? Math.max(current, row.sortOrder ?? 0)
				: current,
		0,
	);
	return maximum + NATIVE_COLLECTION_SORT_ORDER_STEP;
}

function compareNativeCollectionOrder(
	left: NativeCollectionOrderRow,
	right: NativeCollectionOrderRow,
) {
	return (
		(left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
			(right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
		(left.name ?? "").localeCompare(right.name ?? "", undefined, {
			sensitivity: "base",
		}) ||
		left.key.localeCompare(right.key)
	);
}

export function resolveNativeCollectionMoveIntent(
	rows: NativeCollectionOrderRow[],
	collectionKey: string,
	intent: NativeCollectionMoveIntent,
) {
	if (intent.position === "root") {
		return { beforeCollection: null, parentCollection: null };
	}
	const target = rows.find(
		(row) =>
			row.key === intent.targetCollection &&
			row.deleted !== 1 &&
			row.sourceConnectionKey === NATIVE_CONNECTION_KEY,
	);
	if (!target) {
		throw new NativeCollectionValidationError(
			"Choose another collection position.",
			{
				targetCollection:
					"Choose an active collection created in this library.",
			},
		);
	}
	if (target.key === collectionKey) {
		throw new NativeCollectionValidationError(
			"Choose another collection position.",
			{
				targetCollection:
					"A collection cannot be positioned relative to itself.",
			},
		);
	}
	if (intent.position === "inside") {
		return {
			beforeCollection: null,
			parentCollection: target.key,
		};
	}
	if (intent.position === "before") {
		return {
			beforeCollection: target.key,
			parentCollection: target.parentCollection,
		};
	}
	const siblings = rows
		.filter(
			(row) =>
				row.key !== collectionKey &&
				row.deleted !== 1 &&
				row.sourceConnectionKey === NATIVE_CONNECTION_KEY &&
				row.parentCollection === target.parentCollection,
		)
		.sort(compareNativeCollectionOrder);
	const targetIndex = siblings.findIndex(({ key }) => key === target.key);
	return {
		beforeCollection: siblings[targetIndex + 1]?.key ?? null,
		parentCollection: target.parentCollection,
	};
}

export function planNativeCollectionPosition(
	rows: NativeCollectionOrderRow[],
	collectionKey: string,
	parentCollection: string | null,
	beforeCollection: string | null,
) {
	const destinationSiblings = rows
		.filter(
			(row) =>
				row.key !== collectionKey &&
				row.deleted !== 1 &&
				row.sourceConnectionKey === NATIVE_CONNECTION_KEY &&
				row.parentCollection === parentCollection,
		)
		.sort(compareNativeCollectionOrder);
	const insertionIndex = beforeCollection
		? destinationSiblings.findIndex((row) => row.key === beforeCollection)
		: destinationSiblings.length;
	if (insertionIndex < 0) {
		throw new NativeCollectionValidationError(
			"Choose another collection position.",
			{
				beforeCollection:
					"Choose a position within the selected parent collection.",
			},
		);
	}

	const current = rows.find((row) => row.key === collectionKey);
	if (
		current?.parentCollection === parentCollection &&
		current.deleted !== 1
	) {
		const currentOrder = rows
			.filter(
				(row) =>
					row.deleted !== 1 &&
					row.sourceConnectionKey === NATIVE_CONNECTION_KEY &&
					row.parentCollection === parentCollection,
			)
			.sort(compareNativeCollectionOrder)
			.map(({ key }) => key);
		const desiredOrder = destinationSiblings.map(({ key }) => key);
		desiredOrder.splice(insertionIndex, 0, collectionKey);
		if (
			currentOrder.length === desiredOrder.length &&
			currentOrder.every((key, index) => key === desiredOrder[index])
		) {
			return [];
		}
	}

	const previousSortOrder =
		insertionIndex > 0
			? (destinationSiblings[insertionIndex - 1]!.sortOrder ?? 0)
			: 0;
	const nextSortOrder =
		insertionIndex < destinationSiblings.length
			? (destinationSiblings[insertionIndex]!.sortOrder ?? 0)
			: null;
	if (nextSortOrder === null) {
		return [
			{
				key: collectionKey,
				sortOrder:
					previousSortOrder + NATIVE_COLLECTION_SORT_ORDER_STEP,
			},
		];
	}
	if (nextSortOrder - previousSortOrder > 1) {
		return [
			{
				key: collectionKey,
				sortOrder: Math.floor((previousSortOrder + nextSortOrder) / 2),
			},
		];
	}

	const desiredRows = [...destinationSiblings];
	desiredRows.splice(insertionIndex, 0, {
		deleted: 0,
		key: collectionKey,
		name: current?.name ?? null,
		parentCollection,
		sortOrder: current?.sortOrder ?? null,
		sourceConnectionKey: NATIVE_CONNECTION_KEY,
	});
	return desiredRows.map(({ key }, index) => ({
		key,
		sortOrder: (index + 1) * NATIVE_COLLECTION_SORT_ORDER_STEP,
	}));
}

export function nativeCollectionRestoreCohortKeys(
	rows: Array<{
		deleted: number | null;
		deletedAt: Date | null;
		key: string;
		parentCollection: string | null;
	}>,
	rootKey: string,
	deletedAt: Date,
) {
	const descendantKeys = new Set([
		rootKey,
		...collectionDescendantKeys(rows, rootKey),
	]);
	const cohortTime = deletedAt.getTime();
	return rows
		.filter(
			(row) =>
				descendantKeys.has(row.key) &&
				row.deleted === 1 &&
				row.deletedAt?.getTime() === cohortTime,
		)
		.map(({ key }) => key);
}

async function lockNativeCollectionMutations(
	transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtext('new-el:native-collections'))`,
	);
}

export async function createNativeCollection(db: Database, input: unknown) {
	const values = normalizeNativeCollectionInput(input);
	return db.transaction(async (transaction) => {
		await lockNativeCollectionMutations(transaction);
		const rows = await transaction
			.select()
			.from(collection)
			.where(eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY))
			.orderBy(asc(collection.key))
			.for("update");
		assertValidNativeCollectionParent(rows, null, values.parentCollection);

		const key = await reserveCollectionIdentity(transaction, {
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
		});
		const now = new Date();
		const sortOrder = nextNativeCollectionSortOrder(
			rows,
			values.parentCollection,
		);
		const [created] = await transaction
			.insert(collection)
			.values({
				...values,
				key,
				sortOrder,
				sourceConnectionKey: NATIVE_CONNECTION_KEY,
				sourceRecordKey: key,
				updatedAt: now,
			})
			.returning();
		await transaction.insert(outbox).values({
			entityType: "collection",
			entityKey: key,
			operation: "upsert",
			revision: 1,
		});
		return created!;
	});
}

export async function renameNativeCollection(
	db: Database,
	collectionKey: string,
	input: unknown,
) {
	const values = normalizeNativeCollectionRenameInput(input);
	return db.transaction(async (transaction) => {
		await lockNativeCollectionMutations(transaction);
		const [current] = await transaction
			.select()
			.from(collection)
			.where(
				and(
					eq(collection.key, collectionKey),
					eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.for("update")
			.limit(1);
		if (!current) {
			throw new NativeCollectionNotFoundError(collectionKey);
		}
		if (current.deleted === 1) {
			throw new NativeCollectionValidationError(
				"Restore this collection before renaming it.",
				{
					name: "Deleted collections cannot be renamed.",
				},
			);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);

		const now = new Date();
		const [updated] = await transaction
			.update(collection)
			.set({
				name: values.name,
				revision: sql`${collection.revision} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(collection.key, collectionKey),
					eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.returning();
		await transaction.insert(outbox).values({
			entityType: "collection",
			entityKey: collectionKey,
			operation: "upsert",
			revision: updated!.revision,
		});
		return updated!;
	});
}

export async function moveNativeCollection(
	db: Database,
	collectionKey: string,
	input: unknown,
) {
	const values = normalizeNativeCollectionMoveInput(input);
	return db.transaction(async (transaction) => {
		await lockNativeCollectionMutations(transaction);
		const rows = await transaction
			.select()
			.from(collection)
			.where(eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY))
			.orderBy(asc(collection.key))
			.for("update");
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) {
			throw new NativeCollectionNotFoundError(collectionKey);
		}
		if (current.deleted === 1) {
			throw new NativeCollectionValidationError(
				"Restore this collection before moving it.",
				{
					parentCollection: "Deleted collections cannot be moved.",
				},
			);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		const move = resolveNativeCollectionMoveIntent(
			rows,
			collectionKey,
			values,
		);
		assertValidNativeCollectionParent(
			rows,
			collectionKey,
			move.parentCollection,
		);

		const positionUpdates = planNativeCollectionPosition(
			rows,
			collectionKey,
			move.parentCollection,
			move.beforeCollection,
		);
		if (positionUpdates.length === 0) {
			return {
				collection: current,
				collections: [],
				indexingCollections: [],
			};
		}

		const now = new Date();
		const changedCollections: Array<typeof collection.$inferSelect> = [];
		for (const position of positionUpdates) {
			const row = rows.find(({ key }) => key === position.key);
			const isMovedCollection = position.key === collectionKey;
			const nextParent = isMovedCollection
				? move.parentCollection
				: row!.parentCollection;
			if (
				row &&
				row.sortOrder === position.sortOrder &&
				row.parentCollection === nextParent
			) {
				continue;
			}
			const [updated] = await transaction
				.update(collection)
				.set({
					...(isMovedCollection
						? { parentCollection: move.parentCollection }
						: {}),
					revision: sql`${collection.revision} + 1`,
					sortOrder: position.sortOrder,
					updatedAt: now,
				})
				.where(
					and(
						eq(collection.key, position.key),
						eq(
							collection.sourceConnectionKey,
							NATIVE_CONNECTION_KEY,
						),
					),
				)
				.returning();
			if (updated) changedCollections.push(updated);
		}

		const moved =
			changedCollections.find(({ key }) => key === collectionKey) ??
			current;
		const projectionChanged =
			current.parentCollection !== move.parentCollection;
		if (projectionChanged) {
			await transaction.insert(outbox).values({
				entityType: "collection",
				entityKey: collectionKey,
				operation: "upsert",
				revision: moved.revision,
			});
		}
		return {
			collection: moved,
			collections: changedCollections,
			indexingCollections: projectionChanged ? [moved] : [],
		};
	});
}

export async function deleteNativeCollection(
	db: Database,
	collectionKey: string,
	input: unknown,
) {
	const values = normalizeNativeCollectionRevisionInput(input);
	return db.transaction(async (transaction) => {
		await lockNativeCollectionMutations(transaction);
		const rows = await transaction
			.select({
				deleted: collection.deleted,
				deletedAt: collection.deletedAt,
				key: collection.key,
				parentCollection: collection.parentCollection,
				revision: collection.revision,
			})
			.from(collection)
			.where(eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY))
			.orderBy(asc(collection.key))
			.for("update");
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) {
			throw new NativeCollectionNotFoundError(collectionKey);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		const keys = [
			collectionKey,
			...collectionDescendantKeys(rows, collectionKey),
		];
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
					eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY),
					eq(collection.deleted, 0),
				),
			)
			.returning();
		if (updated.length > 0) {
			await transaction.insert(outbox).values(
				updated.map((row) => ({
					entityType: "collection" as const,
					entityKey: row.key,
					operation: "delete" as const,
					revision: row.revision,
				})),
			);
		}
		return updated;
	});
}

export async function restoreNativeCollection(
	db: Database,
	collectionKey: string,
	input: unknown,
) {
	const values = normalizeNativeCollectionRevisionInput(input);
	return db.transaction(async (transaction) => {
		await lockNativeCollectionMutations(transaction);
		const rows = await transaction
			.select()
			.from(collection)
			.where(eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY))
			.orderBy(asc(collection.key))
			.for("update");
		const current = rows.find(({ key }) => key === collectionKey);
		if (!current) {
			throw new NativeCollectionNotFoundError(collectionKey);
		}
		assertExpectedNativeCollectionRevision(
			current,
			values.expectedRevision,
		);
		if (current.deleted !== 1) {
			return { collection: current, collections: [] };
		}
		if (!current.deletedAt) {
			throw new NativeCollectionValidationError(
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
		const wasReparented = current.parentCollection !== parentCollection;
		const cohortKeys = nativeCollectionRestoreCohortKeys(
			rows,
			collectionKey,
			current.deletedAt,
		);
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
					eq(collection.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.returning();
		let restoredRoot = restored.find(({ key }) => key === collectionKey)!;
		if (wasReparented) {
			const sortOrder = nextNativeCollectionSortOrder(
				rows,
				parentCollection,
			);
			[restoredRoot] = await transaction
				.update(collection)
				.set({
					parentCollection,
					sortOrder,
					updatedAt: now,
				})
				.where(eq(collection.key, collectionKey))
				.returning();
			const restoredIndex = restored.findIndex(
				({ key }) => key === collectionKey,
			);
			restored[restoredIndex] = restoredRoot!;
		}
		await transaction.insert(outbox).values(
			restored.map((row) => ({
				entityType: "collection" as const,
				entityKey: row.key,
				operation: "upsert" as const,
				revision: row.revision,
			})),
		);
		return { collection: restoredRoot!, collections: restored };
	});
}
