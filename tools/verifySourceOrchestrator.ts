import { setTimeout as delay } from "node:timers/promises";

import {
	itemIdentity,
	outbox,
	sourceConnection,
	sourceSyncRun,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { asc, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	SourceAdapterRegistry,
	SourceAdapterNotFoundError,
	type SourceAdapter,
	type SyncableSourceProvider,
} from "../src/lib/source-ingestion/adapter";
import {
	runActiveSourceConnections,
	runSourceConnection,
	SourceLeaseUnavailableError,
} from "../src/lib/source-ingestion/orchestrator";
import {
	readSourceStatuses,
	type SourceStatus,
} from "../src/lib/source-ingestion/source-status";
import { writeSourceIngestionBatch } from "../src/lib/source-ingestion/transactional-writer";
import { ZoteroApiError } from "../src/lib/source-ingestion/zotero/client";
import { item } from "../src/db/schema/tables/item";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const sweepKeys = [
	"orchestrator-mendeley",
	"orchestrator-openalex",
	"orchestrator-zotero",
] as const;
const pausedKey = "orchestrator-paused";
const leaseKey = "orchestrator-lease";
const failureKey = "orchestrator-failure";
const expiredKey = "orchestrator-expired";
const progressKey = "orchestrator-progress";
const allKeys = [
	...sweepKeys,
	pausedKey,
	leaseKey,
	failureKey,
	expiredKey,
	progressKey,
];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function fakeAdapter(
	provider: SyncableSourceProvider,
	sync: SourceAdapter["sync"],
): SourceAdapter {
	return { provider, sync };
}

async function expectRejects(
	operation: Promise<unknown>,
	errorName: string,
	matches: (error: unknown) => boolean,
) {
	try {
		await operation;
		throw new Error(`Expected ${errorName}`);
	} catch (error) {
		if (!matches(error)) throw error;
	}
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const database = resource.database;
	let blockedRunRelease: (() => void) | undefined;
	let pausedExistingKeys: string[] = [];
	// Imported items keep an identity row that blocks deleting their connection.
	const clearProgressItems = async () => {
		const keys = database
			.select({ key: itemIdentity.key })
			.from(itemIdentity)
			.where(eq(itemIdentity.sourceConnectionKey, progressKey));
		await database.delete(item).where(inArray(item.key, keys));
		await database
			.delete(itemIdentity)
			.where(eq(itemIdentity.sourceConnectionKey, progressKey));
	};

	try {
		await clearProgressItems();
		await database
			.delete(sourceConnection)
			.where(inArray(sourceConnection.key, allKeys));

		const activeConnections = await database
			.select({ key: sourceConnection.key })
			.from(sourceConnection)
			.where(eq(sourceConnection.status, "active"));
		pausedExistingKeys = activeConnections
			.map(({ key }) => key)
			.filter((key) => key !== "native");
		if (pausedExistingKeys.length > 0) {
			await database
				.update(sourceConnection)
				.set({ status: "paused" })
				.where(inArray(sourceConnection.key, pausedExistingKeys));
		}

		await database.insert(sourceConnection).values([
			{
				key: sweepKeys[0],
				provider: "mendeley",
				scopeKind: "group",
				externalScopeKey: "orchestrator-mendeley-scope",
			},
			{
				config: { filter: "concepts.id:C2778407487" },
				key: sweepKeys[1],
				provider: "openalex",
				scopeKind: "query",
			},
			{
				key: sweepKeys[2],
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "orchestrator-zotero-scope",
			},
			{
				key: pausedKey,
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "orchestrator-paused-scope",
				status: "paused",
			},
		]);

		let concurrent = 0;
		let maximumConcurrent = 0;
		const completedProviders: string[] = [];
		const timedAdapter = (provider: SyncableSourceProvider) =>
			fakeAdapter(provider, async ({ sourceConnection }) => {
				concurrent += 1;
				maximumConcurrent = Math.max(maximumConcurrent, concurrent);
				await delay(40);
				completedProviders.push(sourceConnection.provider);
				concurrent -= 1;
				return { provider, synchronized: 1 };
			});
		const sweep = await runActiveSourceConnections({
			concurrency: 2,
			database,
			heartbeatIntervalMs: 100,
			leaseDurationMs: 1_000,
			registry: new SourceAdapterRegistry([
				timedAdapter("mendeley"),
				timedAdapter("openalex"),
				timedAdapter("zotero"),
			]),
			workerId: "local-sweep",
		});
		assert(sweep.length === 3, "The sweep did not select exactly the active test connections");
		assert(
			sweep.every((outcome) => outcome.status === "succeeded"),
			`The heterogeneous source sweep did not succeed: ${JSON.stringify(sweep)}`,
		);
		assert(
			maximumConcurrent === 2,
			"The source sweep did not honor and exercise its concurrency bound",
		);
		assert(
			completedProviders.sort().join(",") ===
				"mendeley,openalex,zotero",
			"The registry did not dispatch every provider",
		);
		assert(
			!sweep.some((outcome) => outcome.connectionKey === pausedKey),
			"A paused source connection was synchronized",
		);

		await database
			.update(sourceConnection)
			.set({ status: "paused" })
			.where(inArray(sourceConnection.key, [...sweepKeys]));

		await database.insert(sourceConnection).values({
			key: leaseKey,
			provider: "openalex",
			scopeKind: "query",
			config: { filter: "institutions.country_code:MA" },
		});
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			blockedRunRelease = resolve;
		});
		const blockingRegistry = new SourceAdapterRegistry([
			fakeAdapter("openalex", async (context) => {
				await context.heartbeat();
				markStarted?.();
				await blocked;
				return { synchronized: 1 };
			}),
		]);
		const firstRun = runSourceConnection({
			database,
			heartbeatIntervalMs: 100,
			leaseDurationMs: 1_000,
			registry: blockingRegistry,
			sourceConnectionKey: leaseKey,
			workerId: "lease-owner",
		});
		await started;

		const [leasedState] = await database
			.select()
			.from(sourceSyncState)
			.where(eq(sourceSyncState.sourceConnectionKey, leaseKey));
		assert(
			leasedState?.activeRunId &&
				leasedState.leaseOwner === "lease-owner" &&
				leasedState.leaseExpiresAt &&
				leasedState.leaseExpiresAt > new Date(),
			"Heartbeat did not maintain the active lease",
		);
		await expectRejects(
			runSourceConnection({
				database,
				heartbeatIntervalMs: 100,
				leaseDurationMs: 1_000,
				registry: blockingRegistry,
				sourceConnectionKey: leaseKey,
				workerId: "competing-worker",
			}),
			"SourceLeaseUnavailableError",
			(error) => error instanceof SourceLeaseUnavailableError,
		);
		blockedRunRelease?.();
		blockedRunRelease = undefined;
		await firstRun;

		await database.insert(sourceConnection).values({
			externalScopeKey: "orchestrator-failure-scope",
			key: failureKey,
			provider: "dspace",
			scopeKind: "repository",
		});
		await expectRejects(
			runSourceConnection({
				database,
				heartbeatIntervalMs: 100,
				leaseDurationMs: 1_000,
				registry: new SourceAdapterRegistry(),
				sourceConnectionKey: failureKey,
				workerId: "missing-adapter",
			}),
			"SourceAdapterNotFoundError",
			(error) => error instanceof SourceAdapterNotFoundError,
		);
		const [failedState] = await database
			.select()
			.from(sourceSyncState)
			.where(eq(sourceSyncState.sourceConnectionKey, failureKey));
		assert(
			failedState?.activeRunId === null &&
				failedState.leaseOwner === null &&
				failedState.consecutiveFailures === 1 &&
				failedState.lastError?.includes("SourceAdapterNotFoundError"),
			"A failed dispatch did not release its lease and record health",
		);
		await runSourceConnection({
			database,
			heartbeatIntervalMs: 100,
			leaseDurationMs: 1_000,
			registry: new SourceAdapterRegistry([
				fakeAdapter("dspace", async () => ({ synchronized: 2 })),
			]),
			sourceConnectionKey: failureKey,
			workerId: "retry-worker",
		});
		const [recoveredState] = await database
			.select()
			.from(sourceSyncState)
			.where(eq(sourceSyncState.sourceConnectionKey, failureKey));
		assert(
			recoveredState?.consecutiveFailures === 0 &&
				recoveredState.lastError === null &&
				recoveredState.lastResult?.synchronized === 2,
			"A successful retry did not restore healthy state",
		);

		await database.insert(sourceConnection).values({
			externalScopeKey: "orchestrator-expired-scope",
			key: expiredKey,
			provider: "eprints",
			scopeKind: "repository",
		});
		const expiredAt = new Date(Date.now() - 10_000);
		const [expiredRun] = await database
			.insert(sourceSyncRun)
			.values({
				heartbeatAt: expiredAt,
				sourceConnectionKey: expiredKey,
				startedAt: expiredAt,
				workerId: "dead-worker",
			})
			.returning({ id: sourceSyncRun.id });
		assert(expiredRun, "The expired test run was not created");
		await database.insert(sourceSyncState).values({
			activeRunId: expiredRun.id,
			lastAttemptAt: expiredAt,
			leaseExpiresAt: expiredAt,
			leaseOwner: "dead-worker",
			sourceConnectionKey: expiredKey,
			updatedAt: expiredAt,
		});
		const recoveredRun = await runSourceConnection({
			database,
			heartbeatIntervalMs: 100,
			leaseDurationMs: 1_000,
			registry: new SourceAdapterRegistry([
				fakeAdapter("eprints", async () => ({ synchronized: 3 })),
			]),
			sourceConnectionKey: expiredKey,
			workerId: "replacement-worker",
		});
		assert(
			recoveredRun.runId !== expiredRun.id,
			"Expired lease recovery reused the dead run",
		);
		const runs = await database
			.select()
			.from(sourceSyncRun)
			.where(eq(sourceSyncRun.sourceConnectionKey, expiredKey))
			.orderBy(asc(sourceSyncRun.id));
		assert(
			runs.length === 2 &&
				runs[0]?.status === "failed" &&
				runs[0].error?.includes("lease expired") &&
				runs[1]?.status === "succeeded",
			"Expired lease recovery did not close the old run before retrying",
		);

		// Progress, per-run search work and the failure code, as the status reads them.
		await database.insert(sourceConnection).values({
			externalScopeKey: "orchestrator-progress-scope",
			key: progressKey,
			provider: "zotero",
			scopeKind: "group",
		});
		const statusOf = async () =>
			(await readSourceStatuses(database, { hiddenTags: [] })).find(
				(status) => status.key === progressKey,
			);
		let midRun: SourceStatus | undefined;
		const progressRun = await runSourceConnection({
			database,
			heartbeatIntervalMs: 100,
			leaseDurationMs: 1_000,
			registry: new SourceAdapterRegistry([
				fakeAdapter("zotero", async (context) => {
					await context.run?.report(0, 3);
					const written = await writeSourceIngestionBatch(database, {
						expectedCursor: context.sourceConnection.syncCursor,
						fetchedAt: new Date(),
						items: ["PROG0001", "PROG0002"].map((sourceRecordKey) => ({
							metadata: { itemType: "journalArticle", title: sourceRecordKey },
							operation: "upsert",
							raw: {},
							remoteVersion: "1",
							sourceRecordKey,
						})),
						mappingProfileVersion: "orchestrator-progress-v1",
						nextCursor: { step: 1 },
						sourceConnectionKey: progressKey,
						sourceSyncRunId: context.run?.id,
					});
					assert(
						Object.keys(written.itemKeys).length === 2,
						"The progress batch did not import both records",
					);
					await context.run?.report(2, 3);
					midRun = await statusOf();
					return { records: 2 };
				}),
			]),
			sourceConnectionKey: progressKey,
			workerId: "progress-worker",
		});
		assert(
			midRun?.state === "running" &&
				midRun.phase === "import" &&
				midRun.done === 2 &&
				midRun.total === 3,
			`A running import did not report its progress: ${JSON.stringify(midRun)}`,
		);
		const tagged = await database
			.select({ id: outbox.id })
			.from(outbox)
			.where(eq(outbox.sourceSyncRunId, progressRun.runId));
		assert(
			tagged.length === 2,
			`The import's search work was not tagged with its run: ${tagged.length}`,
		);
		const searching = await statusOf();
		assert(
			searching?.state === "running" &&
				searching.phase === "search" &&
				searching.done === 0 &&
				searching.total === 2,
			`Waiting search work did not show as the search phase: ${JSON.stringify(searching)}`,
		);
		// Stand in for the search worker: one event indexed, one given up on.
		const [indexed, givenUp] = tagged;
		assert(indexed && givenUp, "The run's two search events were not found");
		await database
			.update(outbox)
			.set({ processedAt: new Date() })
			.where(eq(outbox.id, indexed.id));
		await database
			.update(outbox)
			.set({ attempts: 5, deadLetteredAt: new Date(), lastError: "Meilisearch task failed" })
			.where(eq(outbox.id, givenUp.id));
		const upToDate = await statusOf();
		assert(
			upToDate?.state === "succeeded" &&
				upToDate.changed === 2 &&
				upToDate.searchable === 2 &&
				upToDate.searchFailed === 1,
			`A finished import did not read as up to date with its failed search update: ${JSON.stringify(upToDate)}`,
		);
		await expectRejects(
			runSourceConnection({
				database,
				heartbeatIntervalMs: 100,
				leaseDurationMs: 1_000,
				registry: new SourceAdapterRegistry([
					fakeAdapter("zotero", async () => {
						throw new ZoteroApiError("Zotero request failed with 403 Forbidden", 403);
					}),
				]),
				sourceConnectionKey: progressKey,
				workerId: "refused-worker",
			}),
			"ZoteroApiError",
			(error) => error instanceof ZoteroApiError,
		);
		const refused = await statusOf();
		assert(
			refused?.state === "failed" &&
				refused.failure.code === "access_denied" &&
				refused.changed === 2,
			`A refused key did not read as access denied: ${JSON.stringify(refused)}`,
		);
		// A run that writes a batch and then fails still counts what it changed.
		await expectRejects(
			runSourceConnection({
				database,
				heartbeatIntervalMs: 100,
				leaseDurationMs: 1_000,
				registry: new SourceAdapterRegistry([
					fakeAdapter("zotero", async (context) => {
						await writeSourceIngestionBatch(database, {
							expectedCursor: context.sourceConnection.syncCursor,
							fetchedAt: new Date(),
							items: [
								{
									metadata: { itemType: "journalArticle", title: "PROG0003" },
									operation: "upsert",
									raw: {},
									remoteVersion: "1",
									sourceRecordKey: "PROG0003",
								},
							],
							mappingProfileVersion: "orchestrator-progress-v1",
							nextCursor: { step: 2 },
							sourceConnectionKey: progressKey,
							sourceSyncRunId: context.run?.id,
						});
						throw new ZoteroApiError("Zotero request failed with 503", 503);
					}),
				]),
				sourceConnectionKey: progressKey,
				workerId: "partial-worker",
			}),
			"ZoteroApiError",
			(error) => error instanceof ZoteroApiError,
		);
		const partial = await statusOf();
		assert(
			partial?.state === "failed" &&
				partial.failure.code === "unavailable" &&
				partial.changed === 1,
			`A failed run's written changes were not counted: ${JSON.stringify(partial)}`,
		);
		// A source dropped from the configuration stops reporting.
		await database
			.update(sourceConnection)
			.set({ status: "removed" })
			.where(eq(sourceConnection.key, progressKey));
		assert((await statusOf()) === undefined, "A removed source still reported its status");
		await database
			.update(sourceConnection)
			.set({ status: "active" })
			.where(eq(sourceConnection.key, progressKey));

		console.log(
			JSON.stringify({
				expiredLeaseRecovered: true,
				failureRetryRecovered: true,
				importProgressReported: true,
				leaseContentionRejected: true,
				maximumConcurrent,
				providers: completedProviders.sort(),
			}),
		);
	} finally {
		blockedRunRelease?.();
		await clearProgressItems();
		await database
			.delete(sourceConnection)
			.where(inArray(sourceConnection.key, allKeys));
		if (pausedExistingKeys.length > 0) {
			await database
				.update(sourceConnection)
				.set({ status: "active" })
				.where(inArray(sourceConnection.key, pausedExistingKeys));
		}
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
