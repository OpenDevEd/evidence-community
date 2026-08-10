import {
	collectionIdentity,
	collectionSourceLink,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import {
	CollectionWritebackUnavailableError,
	createAdminCollection,
	deleteAdminCollection,
	moveAdminCollection,
	renameAdminCollection,
	restoreAdminCollection,
} from "../src/lib/admin/collection-mutation-service";
import {
	createNativeItemDraft,
	publishItemDraft,
} from "../src/lib/admin/native-item-service";
import { writeSourceIngestionBatch } from "../src/lib/source-ingestion/transactional-writer";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const database = resource.database;
	const marker = `${process.pid}-${Date.now()}`;
	const connectionKey = `source-collection-${marker}`.slice(0, 64);
	const enabledOptions = {
		writebackConfig: {
			sources: [{ key: connectionKey, writebackEnabled: true }],
		},
	};
	const disabledOptions = { writebackConfig: { sources: [] } };
	const createdKeys: string[] = [];
	let memberItemKey: string | null = null;
	let cursor: Record<string, unknown> = {};

	const ingest = async (
		collections: Array<
			| {
					operation: "delete";
					raw: { deleted: true };
					remoteVersion: string;
					sourceRecordKey: string;
			  }
			| {
					data: {
						name: string;
						numCollections: number;
						numItems: number;
						relations: Record<string, never>;
					};
					operation: "upsert";
					parentSourceRecordKey: string | null;
					raw: Record<string, unknown>;
					remoteVersion: string;
					sourceRecordKey: string;
			  }
		>,
	) => {
		const nextCursor = { revision: Date.now() + Math.random() };
		const result = await writeSourceIngestionBatch(database, {
			collections,
			expectedCursor: cursor,
			fetchedAt: new Date(),
			items: [],
			mappingProfileVersion: "source-collection-lifecycle-v1",
			nextCursor,
			sourceConnectionKey: connectionKey,
		});
		cursor = nextCursor;
		return result;
	};

	try {
		await database.insert(sourceConnection).values({
			externalScopeKey: marker,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});
		const parent = await createAdminCollection(
			database,
			{
				name: "Source parent",
				parentCollection: null,
				sourceConnectionKey: connectionKey,
			},
			enabledOptions,
		);
		createdKeys.push(parent.key);
		const child = await createAdminCollection(
			database,
			{
				name: "Source child",
				parentCollection: parent.key,
				sourceConnectionKey: connectionKey,
			},
			enabledOptions,
		);
		createdKeys.push(child.key);

		const [parentLink, childLink] = await database
			.select()
			.from(collectionSourceLink)
			.where(inArray(collectionSourceLink.collectionKey, createdKeys));
		const createJobs = await database
			.select()
			.from(sourceWritebackJob)
			.where(inArray(sourceWritebackJob.collectionKey, createdKeys));
		assert(
			parentLink?.writebackEnabled &&
				childLink?.writebackEnabled &&
				createJobs.length === 2 &&
				createJobs.every(({ operation }) => operation === "upsert"),
			"Source collection creation did not create enabled links and durable jobs",
		);

		const renamed = await renameAdminCollection(
			database,
			child.key,
			{ expectedRevision: child.revision, name: "Renamed source child" },
			enabledOptions,
		);
		const moved = await moveAdminCollection(
			database,
			child.key,
			{ expectedRevision: renamed.revision, position: "root" },
			enabledOptions,
		);
		assert(
			moved.collection.parentCollection === null &&
				moved.collection.revision === renamed.revision + 1,
			"Source collection rename/move did not update canonical state",
		);

		await moveAdminCollection(
			database,
			child.key,
			{
				expectedRevision: moved.collection.revision,
				position: "inside",
				targetCollection: parent.key,
			},
			enabledOptions,
		);
		const memberDraft = await createNativeItemDraft(database, {
			itemType: "Report",
			title: "Collection restore multi-source member",
		});
		memberItemKey = memberDraft.itemKey;
		await publishItemDraft(database, memberItemKey);
		await database.insert(itemSourceLink).values({
			itemKey: memberItemKey,
			remoteVersion: "1",
			sourceConnectionKey: connectionKey,
			sourceRecordKey: "MEMB2345",
			writebackEnabled: true,
		});
		await database.insert(itemToCollection).values({
			collectionKey: child.key,
			itemKey: memberItemKey,
		});
		const [memberBeforeDelete] = await database
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, memberItemKey));
		const [currentParent] = await database
			.select()
			.from(collection)
			.where(eq(collection.key, parent.key));
		const deleted = await deleteAdminCollection(
			database,
			parent.key,
			{ expectedRevision: currentParent!.revision },
			enabledOptions,
		);
		assert(
			deleted.length === 2 &&
				deleted.every(({ deleted }) => deleted === 1),
			"Source collection delete did not preserve subtree semantics",
		);

		await ingest(
			deleted.map((row) => ({
				data: {
					name: `Remote stale ${row.key}`,
					numCollections: 0,
					numItems: 0,
					relations: {},
				},
				operation: "upsert" as const,
				parentSourceRecordKey:
					row.key === child.key ? parent.sourceRecordKey : null,
				raw: {
					data: { name: `Remote stale ${row.key}` },
					key: row.sourceRecordKey,
					version: 50,
				},
				remoteVersion: "50",
				sourceRecordKey: row.sourceRecordKey,
			})),
		);
		const afterStaleUpsert = await database
			.select()
			.from(collection)
			.where(inArray(collection.key, createdKeys));
		assert(
			afterStaleUpsert.every(({ deleted }) => deleted === 1),
			"Inbound upserts resurrected collections with pending local deletes",
		);

		const currentDeletedParent = afterStaleUpsert.find(
			({ key }) => key === parent.key,
		)!;
		const restored = await restoreAdminCollection(
			database,
			parent.key,
			{ expectedRevision: currentDeletedParent.revision },
			enabledOptions,
		);
		assert(
			restored.collections.length === 2 &&
				restored.collections.every(({ deleted }) => deleted === 0),
			"Source collection restore did not restore the delete cohort",
		);
		const [[memberAfterRestore], [memberLinkAfterRestore], memberJobs] =
			await Promise.all([
				database
					.select({ revision: item.revision })
					.from(item)
					.where(eq(item.key, memberItemKey)),
				database
					.select()
					.from(itemSourceLink)
					.where(
						and(
							eq(itemSourceLink.itemKey, memberItemKey),
							eq(
								itemSourceLink.sourceConnectionKey,
								connectionKey,
							),
						),
					),
				database
					.select()
					.from(sourceWritebackJob)
					.where(eq(sourceWritebackJob.itemKey, memberItemKey)),
			]);
		assert(
			memberAfterRestore?.revision === memberBeforeDelete!.revision + 1 &&
				memberLinkAfterRestore?.dirtyFields.includes("collections") &&
				memberJobs.some((job) =>
					job.dirtyFields.includes("collections"),
				),
			"Restoring a source collection did not queue membership recreation for its items",
		);

		await ingest(
			restored.collections.map((row) => ({
				operation: "delete" as const,
				raw: { deleted: true as const },
				remoteVersion: "51",
				sourceRecordKey: row.sourceRecordKey,
			})),
		);
		const afterStaleDelete = await database
			.select()
			.from(collection)
			.where(inArray(collection.key, createdKeys));
		assert(
			afterStaleDelete.every(({ deleted }) => deleted === 0),
			"Inbound deletes overrode collections with pending local restores",
		);

		let disabledRejected = false;
		try {
			await renameAdminCollection(
				database,
				child.key,
				{
					expectedRevision: afterStaleDelete.find(
						({ key }) => key === child.key,
					)!.revision,
					name: "Must not save",
				},
				disabledOptions,
			);
		} catch (error) {
			disabledRejected =
				error instanceof CollectionWritebackUnavailableError &&
				error.reason === "source-disabled";
		}
		assert(
			disabledRejected,
			"A source-disabled collection mutation was accepted",
		);

		await database
			.update(collectionSourceLink)
			.set({ writebackEnabled: false })
			.where(eq(collectionSourceLink.collectionKey, child.key));
		let lockedCascadeRejected = false;
		try {
			await deleteAdminCollection(
				database,
				parent.key,
				{
					expectedRevision: afterStaleDelete.find(
						({ key }) => key === parent.key,
					)!.revision,
				},
				enabledOptions,
			);
		} catch (error) {
			lockedCascadeRejected =
				error instanceof CollectionWritebackUnavailableError &&
				error.reason === "item-locked";
		}
		assert(
			lockedCascadeRejected,
			"A parent delete bypassed a writeback-locked descendant",
		);
		const afterRejectedCascade = await database
			.select()
			.from(collection)
			.where(inArray(collection.key, createdKeys));
		assert(
			afterRejectedCascade.every(({ deleted }) => deleted === 0),
			"A rejected parent delete partially changed its subtree",
		);
		let lockedRejected = false;
		try {
			await renameAdminCollection(
				database,
				child.key,
				{
					expectedRevision: afterStaleDelete.find(
						({ key }) => key === child.key,
					)!.revision,
					name: "Must stay locked",
				},
				enabledOptions,
			);
		} catch (error) {
			lockedRejected =
				error instanceof CollectionWritebackUnavailableError &&
				error.reason === "item-locked";
		}
		assert(
			lockedRejected,
			"A collection with item-level writeback disabled was mutated",
		);

		const jobs = await database
			.select()
			.from(sourceWritebackJob)
			.where(inArray(sourceWritebackJob.collectionKey, createdKeys));
		const deleteJobs = jobs.filter(
			({ operation }) => operation === "delete",
		);
		const restoreJobs = jobs.filter(
			({ dirtyFields, operation }) =>
				operation === "upsert" && dirtyFields.includes("deleted"),
		);
		assert(
			deleteJobs.length === 2 && restoreJobs.length === 2,
			"Delete/restore did not enqueue one durable job per affected collection",
		);

		console.log(
			JSON.stringify({
				childKey: child.key,
				deleteJobs: deleteJobs.length,
				parentKey: parent.key,
				restoreJobs: restoreJobs.length,
				totalJobs: jobs.length,
			}),
		);
	} finally {
		if (memberItemKey) {
			await database
				.delete(outbox)
				.where(eq(outbox.entityKey, memberItemKey));
			await database
				.delete(itemToCollection)
				.where(eq(itemToCollection.itemKey, memberItemKey));
			await database.delete(item).where(eq(item.key, memberItemKey));
			await database
				.delete(itemIdentity)
				.where(eq(itemIdentity.key, memberItemKey));
		}
		if (createdKeys.length > 0) {
			await database
				.delete(outbox)
				.where(inArray(outbox.entityKey, createdKeys));
			await database
				.delete(collection)
				.where(inArray(collection.key, createdKeys));
			await database
				.delete(collectionIdentity)
				.where(inArray(collectionIdentity.key, createdKeys));
		}
		await database
			.delete(sourceConnection)
			.where(eq(sourceConnection.key, connectionKey));
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
