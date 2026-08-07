import { collectionIdentity, outbox } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { collection } from "../src/db/schema/tables/collection";
import {
	CollectionConflictError,
	createNativeCollection,
	deleteNativeCollection,
	moveNativeCollection,
	renameNativeCollection,
	restoreNativeCollection,
} from "../src/lib/admin/native-collection-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is required");
}
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function settledValue<T>(result: PromiseSettledResult<T>) {
	if (result.status === "rejected") throw result.reason;
	return result.value;
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const createdKeys: string[] = [];
	const createTracked = async (
		input: Parameters<typeof createNativeCollection>[1],
	) => {
		const created = await createNativeCollection(db, input);
		createdKeys.push(created.key);
		return created;
	};

	try {
		const [firstRoot, secondRoot] = (
			await Promise.allSettled([
				createTracked({ name: "Lifecycle first root" }),
				createTracked({ name: "Lifecycle second root" }),
			])
		).map(settledValue);
		assert(
			firstRoot.sortOrder !== secondRoot.sortOrder,
			"Concurrent creates reused a native sibling sortOrder",
		);

		const child = await createTracked({
			name: "Lifecycle child",
			parentCollection: firstRoot.key,
		});

		const renamed = await renameNativeCollection(db, firstRoot.key, {
			expectedRevision: firstRoot.revision,
			name: "Lifecycle renamed root",
		});
		assert(
			renamed.name === "Lifecycle renamed root" &&
				renamed.parentCollection === null &&
				renamed.revision === firstRoot.revision + 1,
			"Rename changed hierarchy or failed to advance revision",
		);

		let staleRenameRejected = false;
		try {
			await renameNativeCollection(db, firstRoot.key, {
				expectedRevision: firstRoot.revision,
				name: "Stale rename",
			});
		} catch (error) {
			staleRenameRejected =
				error instanceof CollectionConflictError &&
				error.currentRevision === renamed.revision;
		}
		assert(staleRenameRejected, "A stale collection rename was accepted");

		const beforeMoveEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, child.key));
		const moved = await moveNativeCollection(db, child.key, {
			expectedRevision: child.revision,
			position: "before",
			targetCollection: secondRoot.key,
		});
		assert(
			moved.collection.parentCollection === null &&
				moved.collection.sortOrder! < secondRoot.sortOrder! &&
				moved.collection.revision === child.revision + 1,
			"Move did not persist the requested destination position",
		);

		const moveEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, child.key));
		assert(
			moveEvents.length === beforeMoveEvents.length + 1,
			"Cross-parent move did not emit exactly one new outbox event",
		);

		let staleMoveRejected = false;
		try {
			await moveNativeCollection(db, child.key, {
				expectedRevision: child.revision,
				position: "inside",
				targetCollection: firstRoot.key,
			});
		} catch (error) {
			staleMoveRejected =
				error instanceof CollectionConflictError &&
				error.currentRevision === moved.collection.revision;
		}
		assert(staleMoveRejected, "A stale collection move was accepted");

		const beforeReorderEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, secondRoot.key));
		const reordered = await moveNativeCollection(db, secondRoot.key, {
			expectedRevision: secondRoot.revision,
			position: "before",
			targetCollection: child.key,
		});
		const afterReorderEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, secondRoot.key));
		assert(
			reordered.collection.revision === secondRoot.revision + 1 &&
				afterReorderEvents.length === beforeReorderEvents.length,
			"Sort-only reorder emitted an outbox event or missed its revision",
		);

		let staleDeleteRejected = false;
		try {
			await deleteNativeCollection(db, secondRoot.key, {
				expectedRevision: secondRoot.revision,
			});
		} catch (error) {
			staleDeleteRejected =
				error instanceof CollectionConflictError &&
				error.currentRevision === reordered.collection.revision;
		}
		assert(staleDeleteRejected, "A stale collection delete was accepted");

		const cohortRoot = await createTracked({
			name: "Lifecycle cohort root",
		});
		const cohortChild = await createTracked({
			name: "Lifecycle cohort child",
			parentCollection: cohortRoot.key,
		});
		const olderGrandchild = await createTracked({
			name: "Lifecycle older grandchild",
			parentCollection: cohortChild.key,
		});

		const independentlyDeleted = await deleteNativeCollection(
			db,
			olderGrandchild.key,
			{ expectedRevision: olderGrandchild.revision },
		);
		assert(
			independentlyDeleted.length === 1,
			"Independent descendant delete failed",
		);
		const cascadeDeleted = await deleteNativeCollection(
			db,
			cohortRoot.key,
			{ expectedRevision: cohortRoot.revision },
		);
		assert(
			cascadeDeleted.length === 2,
			"Cascade delete included a previously deleted descendant",
		);
		const restored = await restoreNativeCollection(db, cohortRoot.key, {
			expectedRevision: cascadeDeleted.find(
				({ key }) => key === cohortRoot.key,
			)!.revision,
		});
		assert(
			new Set(restored.collections.map(({ key }) => key)).size === 2 &&
				restored.collections.some(
					({ key }) => key === cohortChild.key,
				) &&
				!restored.collections.some(
					({ key }) => key === olderGrandchild.key,
				),
			"Restore did not preserve the exact cascade cohort",
		);

		const [stillDeletedGrandchild] = await db
			.select({ deleted: collection.deleted })
			.from(collection)
			.where(eq(collection.key, olderGrandchild.key));
		assert(
			stillDeletedGrandchild?.deleted === 1,
			"Restore revived an independently deleted descendant",
		);

		let staleRestoreRejected = false;
		try {
			await restoreNativeCollection(db, cohortRoot.key, {
				expectedRevision: cascadeDeleted.find(
					({ key }) => key === cohortRoot.key,
				)!.revision,
			});
		} catch (error) {
			staleRestoreRejected = error instanceof CollectionConflictError;
		}
		assert(staleRestoreRejected, "A stale collection restore was accepted");

		const secondCascadeDeleted = await deleteNativeCollection(
			db,
			cohortRoot.key,
			{ expectedRevision: restored.collection.revision },
		);
		const deletedChild = secondCascadeDeleted.find(
			({ key }) => key === cohortChild.key,
		);
		assert(deletedChild, "Second cascade did not delete the cohort child");
		const orphanRestored = await restoreNativeCollection(
			db,
			cohortChild.key,
			{ expectedRevision: deletedChild.revision },
		);
		assert(
			orphanRestored.collection.parentCollection === null &&
				orphanRestored.collection.sortOrder !== null,
			"Restoring below a deleted parent did not promote the collection to root",
		);
		const [stillDeletedRoot] = await db
			.select({ deleted: collection.deleted })
			.from(collection)
			.where(eq(collection.key, cohortRoot.key));
		assert(
			stillDeletedRoot?.deleted === 1,
			"Restoring an orphan unexpectedly restored its deleted parent",
		);

		console.log(
			JSON.stringify({
				cascadeCohortSize: restored.collections.length,
				collectionCount: createdKeys.length,
				concurrentSortOrders: [
					firstRoot.sortOrder,
					secondRoot.sortOrder,
				],
				orphanRestorePromotedToRoot: true,
				staleMutationsRejected: 4,
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "collection"),
						inArray(outbox.entityKey, createdKeys),
					),
				);
			await db
				.delete(collection)
				.where(inArray(collection.key, createdKeys));
			await db
				.delete(collectionIdentity)
				.where(
					and(
						eq(collectionIdentity.sourceConnectionKey, "native"),
						inArray(collectionIdentity.key, createdKeys),
					),
				);
		}
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
