import {
	collectionIdentity,
	collectionSourceLink,
	collectionSourceSnapshot,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { lockCollectionMutation } from "../src/db/canonical-mutation-lock";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { reserveCollectionIdentities } from "../src/db/record-identity";
import { collection } from "../src/db/schema/tables/collection";
import {
	sourceCollectionFingerprint,
	sourcePayloadHash,
} from "../src/lib/source-ingestion/fingerprint";
import { mapZoteroCollection } from "../src/lib/source-ingestion/zotero/mapper";
import { ZOTERO_MAPPING_PROFILE_VERSION } from "../src/lib/source-ingestion/zotero/profile";
import {
	SourceWritebackAdapterRegistry,
	type SourceWritebackRequest,
} from "../src/lib/source-writeback/adapter";
import {
	processNextSourceWritebackJob,
	type SourceWritebackConsumerOptions,
} from "../src/lib/source-writeback/consumer";
import {
	enqueueCollectionWritebackJob,
	markCollectionWritebackDirty,
} from "../src/lib/source-writeback/queue";

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
	const connectionKey = `collection-writeback-${marker}`.slice(0, 64);
	const sourceRecordKeys = ["PARN2345", "CHLD2345"];
	let version = 0;
	const calls: SourceWritebackRequest[] = [];
	const registry = new SourceWritebackAdapterRegistry([
		{
			provider: "zotero",
			readRecord: async () => null,
			readVersion: async () => null,
			write: async (request) => {
				calls.push(structuredClone(request));
				version += 1;
				if (request.entity !== "collection") {
					throw new Error("Collection verifier received an item job");
				}
				const payload =
					request.operation === "delete"
						? { deleted: true }
						: {
								data: {
									...request.payload,
									key: request.sourceRecordKey,
									version,
								},
								key: request.sourceRecordKey,
								meta: { numCollections: 0, numItems: 0 },
								version,
							};
				const fingerprint =
					request.operation === "delete"
						? sourcePayloadHash({ deleted: true })
						: sourceCollectionFingerprint(
								mapZoteroCollection(
									payload as never,
								) as Extract<
									ReturnType<typeof mapZoteroCollection>,
									{ operation: "upsert" }
								>,
							);
				return {
					remoteVersion:
						request.operation === "delete" ? null : String(version),
					snapshot: {
						fingerprint,
						mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
						payload,
					},
					sourceRecordKey: request.sourceRecordKey,
				};
			},
		},
	]);
	const options: SourceWritebackConsumerOptions = {
		database,
		heartbeatIntervalMs: 100,
		leaseDurationMs: 1_000,
		registry,
		retryBaseMs: 100,
		retryMaxMs: 100,
		sourceWritebackEnabled: () => true,
		workerId: `collection-writeback-verifier-${marker}`,
	};
	let collectionKeys: string[] = [];

	try {
		await database.insert(sourceConnection).values({
			externalScopeKey: marker,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});
		const identities = await reserveCollectionIdentities(database, {
			sourceConnectionKey: connectionKey,
			sourceRecordKeys,
		});
		const parentKey = identities.get("PARN2345")!;
		const childKey = identities.get("CHLD2345")!;
		collectionKeys = [parentKey, childKey];
		await database.insert(collection).values([
			{
				key: parentKey,
				name: "Parent",
				revision: 1,
				sourceConnectionKey: connectionKey,
				sourceRecordKey: "PARN2345",
			},
			{
				key: childKey,
				name: "Child",
				parentCollection: parentKey,
				revision: 1,
				sourceConnectionKey: connectionKey,
				sourceRecordKey: "CHLD2345",
			},
		]);
		await database.insert(collectionSourceLink).values([
			{
				collectionKey: parentKey,
				sourceConnectionKey: connectionKey,
				sourceRecordKey: "PARN2345",
				writebackEnabled: true,
			},
			{
				collectionKey: childKey,
				sourceConnectionKey: connectionKey,
				sourceRecordKey: "CHLD2345",
				writebackEnabled: true,
			},
		]);
		await database.transaction(async (transaction) => {
			await enqueueCollectionWritebackJob(transaction, {
				canonicalRevision: 1,
				collectionKey: parentKey,
				dirtyFields: ["name"],
				operation: "upsert",
				sourceConnectionKey: connectionKey,
			});
			await enqueueCollectionWritebackJob(transaction, {
				canonicalRevision: 1,
				collectionKey: childKey,
				dirtyFields: ["name", "parentCollection"],
				operation: "upsert",
				sourceConnectionKey: connectionKey,
			});
		});
		const [parentJob] = await database
			.select({ id: sourceWritebackJob.id })
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.collectionKey, parentKey));
		assert(parentJob, "Parent collection job was not queued");
		await database
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(Date.now() + 60_000) })
			.where(eq(sourceWritebackJob.id, parentJob.id));

		const deferredChild = await processNextSourceWritebackJob(options);
		assert(
			deferredChild.status === "deferred" &&
				deferredChild.collectionKey === childKey,
			"A child collection was not deferred until its parent writeback completed",
		);
		await database
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, parentJob.id));
		const writtenParent = await processNextSourceWritebackJob(options);
		assert(
			writtenParent.status === "processed" &&
				writtenParent.collectionKey === parentKey,
			"Parent collection writeback was not processed",
		);
		await database
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.collectionKey, childKey));
		const writtenChild = await processNextSourceWritebackJob(options);
		const childCreate = calls.find(
			(request) =>
				request.entity === "collection" &&
				request.collectionKey === childKey,
		);
		assert(
			writtenChild.status === "processed" &&
				childCreate?.entity === "collection" &&
				childCreate.payload.parentCollection === "PARN2345",
			"Child collection writeback did not use the acknowledged parent source key",
		);

		await database.transaction(async (transaction) => {
			await lockCollectionMutation(transaction, childKey);
			const [renamed] = await transaction
				.update(collection)
				.set({
					name: "Renamed child",
					parentCollection: null,
					revision: 2,
					updatedAt: new Date(),
				})
				.where(eq(collection.key, childKey))
				.returning({ revision: collection.revision });
			assert(renamed, "Child collection disappeared during rename");
			await markCollectionWritebackDirty(transaction, {
				canonicalRevision: renamed.revision,
				collectionKey: childKey,
				dirtyFields: ["name", "parentCollection"],
				updatedAt: new Date(),
			});
		});
		const renamed = await processNextSourceWritebackJob(options);
		const renameCall = calls.at(-1);
		assert(
			renamed.status === "processed" &&
				renameCall?.entity === "collection" &&
				renameCall.payload.name === "Renamed child" &&
				renameCall.payload.parentCollection === false,
			"Collection rename/reparent was not dispatched",
		);

		await database.transaction(async (transaction) => {
			await lockCollectionMutation(transaction, childKey);
			await transaction
				.update(collection)
				.set({ deleted: 1, deletedAt: new Date(), revision: 3 })
				.where(eq(collection.key, childKey));
			await enqueueCollectionWritebackJob(transaction, {
				canonicalRevision: 3,
				collectionKey: childKey,
				dirtyFields: ["deleted"],
				operation: "delete",
				sourceConnectionKey: connectionKey,
			});
		});
		const deleted = await processNextSourceWritebackJob(options);
		const [deletedSnapshot] = await database
			.select()
			.from(collectionSourceSnapshot)
			.where(
				and(
					eq(collectionSourceSnapshot.collectionKey, childKey),
					eq(
						collectionSourceSnapshot.sourceConnectionKey,
						connectionKey,
					),
				),
			);
		assert(
			deleted.status === "processed" &&
				deletedSnapshot?.payloadHash ===
					sourcePayloadHash({ deleted: true }) &&
				deletedSnapshot.remoteVersion === null,
			"Collection delete did not persist an ingestion-compatible tombstone",
		);

		await database.transaction(async (transaction) => {
			await lockCollectionMutation(transaction, childKey);
			await transaction
				.update(collection)
				.set({ deleted: 0, deletedAt: null, revision: 4 })
				.where(eq(collection.key, childKey));
			await enqueueCollectionWritebackJob(transaction, {
				canonicalRevision: 4,
				collectionKey: childKey,
				dirtyFields: ["deleted"],
				operation: "upsert",
				sourceConnectionKey: connectionKey,
			});
		});
		const restored = await processNextSourceWritebackJob(options);
		const [restoredLink] = await database
			.select()
			.from(collectionSourceLink)
			.where(
				and(
					eq(collectionSourceLink.collectionKey, childKey),
					eq(collectionSourceLink.sourceConnectionKey, connectionKey),
				),
			);
		assert(
			restored.status === "processed" &&
				restoredLink?.remoteDeleted === false &&
				restoredLink.remoteVersion === "5" &&
				restoredLink.dirtyFields.length === 0,
			"Collection restore was not acknowledged with the same source key",
		);

		console.log(
			JSON.stringify({
				calls: calls.length,
				childKey,
				deleteTombstone: deletedSnapshot.payloadHash,
				parentKey,
				restoredRemoteVersion: restoredLink.remoteVersion,
			}),
		);
	} finally {
		if (collectionKeys.length > 0) {
			await database
				.delete(collection)
				.where(inArray(collection.key, collectionKeys));
			await database
				.delete(collectionIdentity)
				.where(inArray(collectionIdentity.key, collectionKeys));
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
