import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
	itemIdentity,
	outbox,
	searchIndexWorker,
} from "@opendeved/evidence-library-core";
import { eq, inArray, sql } from "drizzle-orm";
import { Meilisearch, MeilisearchApiError } from "meilisearch";

import {
	DatabaseOperationAbortedError,
	withCancellableDatabaseTransaction,
} from "../src/db/cancellable-transaction";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { item } from "../src/db/schema/tables/item";
import {
	getSearchIndexWorker,
	registerSearchIndexWorker,
	searchIndexWorkerIsActive,
	SearchIndexWorkerOwnershipLostError,
	stopSearchIndexWorker,
	updateSearchIndexWorker,
} from "../src/lib/search-index/worker-state";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
if (!process.env.LIBRARY_CONFIG_PATH) {
	throw new Error("LIBRARY_CONFIG_PATH is required");
}

const workerId = `search-worker-e2e-${process.pid}`;
const itemKey = "WRKR2345";
const timeoutMs = 20_000;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function waitFor(
	predicate: () => Promise<boolean>,
	message: string,
	intervalMs = 100,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(message);
}

async function withTimeout<T>(
	promise: Promise<T>,
	waitTimeoutMs: number,
	message: string,
) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(message)),
					waitTimeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function runTool(tool: string, args: string[], env: NodeJS.ProcessEnv) {
	return spawn("node_modules/.bin/tsx", [tool, ...args], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
	return spawn(command, args, {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

async function waitForExit(
	child: ReturnType<typeof spawn>,
	waitTimeoutMs = timeoutMs,
) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return child.exitCode;
	}
	return new Promise<number | null>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					`Child process did not exit within ${waitTimeoutMs}ms`,
				),
			);
		}, waitTimeoutMs);
		const cleanup = () => {
			clearTimeout(timeout);
			child.off("error", onError);
			child.off("exit", onExit);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			cleanup();
			resolve(code);
		};
		child.once("error", onError);
		child.once("exit", onExit);
	});
}

async function closeServer(server: Server) {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
		server.closeAllConnections();
	});
}

async function terminateChild(child: ReturnType<typeof spawn> | null) {
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await waitForExit(child);
	}
}

async function deleteIndexIfPresent(client: Meilisearch, indexName: string) {
	try {
		await client.deleteIndex(indexName).waitTask();
	} catch (error) {
		if (
			error instanceof MeilisearchApiError &&
			error.cause?.code === "index_not_found"
		) {
			return;
		}
		throw error;
	}
}

async function main() {
	const adminResource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const replacementWorkerId = `${workerId}-replacement`;
	const failureWorkerId = `${workerId}-startup-failure`;
	const stalledWorkerId = `${workerId}-stalled-request`;
	const isolatedDatabaseName = `search_worker_e2e_${process.pid}`;
	const isolatedIndexName = `search_worker_e2e_${process.pid}`;
	const quotedDatabaseName = `"${isolatedDatabaseName}"`;
	let resource: ReturnType<typeof createPostgresDatabaseResource> | null =
		null;
	let migration: ReturnType<typeof runCommand> | null = null;
	let temporaryDirectory: string | null = null;
	let meilisearch: Meilisearch | null = null;
	let worker: ReturnType<typeof runTool> | null = null;
	let stalledWorker: ReturnType<typeof runTool> | null = null;
	let failedWorker: ReturnType<typeof runTool> | null = null;
	let stalledSearchServer: Server | null = null;
	let stderr = "";
	let verificationError: unknown;
	const cleanupErrors: unknown[] = [];
	const attemptCleanup = async (
		operation: () => Promise<unknown> | unknown,
	) => {
		try {
			await operation();
		} catch (error) {
			cleanupErrors.push(error);
		}
	};

	try {
		temporaryDirectory = await mkdtemp(`${tmpdir()}/search-worker-e2e-`);
		const sourceConfigPath = resolve(process.env.LIBRARY_CONFIG_PATH!);
		const isolatedConfig = JSON.parse(
			await readFile(sourceConfigPath, "utf8"),
		) as {
			services: {
				database: { url: string };
				search: { host: string; index: string; key: string };
			};
		};
		const isolatedDatabaseUrl = new URL(verifiedDatabaseUrl);
		isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`;
		isolatedConfig.services.database.url = isolatedDatabaseUrl.toString();
		isolatedConfig.services.search.index = isolatedIndexName;
		const isolatedConfigPath = `${temporaryDirectory}/library.json`;
		await writeFile(isolatedConfigPath, JSON.stringify(isolatedConfig));
		await adminResource.pool.query(
			`DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`,
		);
		await adminResource.pool.query(`CREATE DATABASE ${quotedDatabaseName}`);
		migration = runCommand("node_modules/.bin/drizzle-kit", ["migrate"], {
			...process.env,
			LIBRARY_CONFIG_PATH: isolatedConfigPath,
		});
		let migrationError = "";
		migration.stderr?.on("data", (chunk) => {
			migrationError += String(chunk);
		});
		assert(
			(await waitForExit(migration)) === 0,
			`The isolated database migration failed: ${migrationError}`,
		);
		resource = createPostgresDatabaseResource(
			isolatedDatabaseUrl.toString(),
		);
		const database = resource.database;
		meilisearch = new Meilisearch({
			apiKey: isolatedConfig.services.search.key,
			host: isolatedConfig.services.search.host,
		});
		await deleteIndexIfPresent(meilisearch, isolatedIndexName);

		await database.delete(outbox).where(eq(outbox.entityKey, itemKey));
		await database.delete(item).where(eq(item.key, itemKey));
		await database
			.delete(itemIdentity)
			.where(eq(itemIdentity.key, itemKey));
		await database
			.delete(searchIndexWorker)
			.where(
				inArray(searchIndexWorker.workerId, [
					workerId,
					replacementWorkerId,
					failureWorkerId,
					stalledWorkerId,
				]),
			);
		const databaseAbort = new AbortController();
		const abortStartedAt = Date.now();
		const abortTimer = setTimeout(() => databaseAbort.abort(), 100);
		try {
			await withCancellableDatabaseTransaction(
				database,
				databaseAbort.signal,
				async (transaction) => {
					await transaction.execute(sql`select pg_sleep(10)`);
				},
			);
			throw new Error("The active PostgreSQL query ignored cancellation");
		} catch (error) {
			const elapsedMs = Date.now() - abortStartedAt;
			assert(
				error instanceof DatabaseOperationAbortedError &&
					elapsedMs < 2_000,
				`The active PostgreSQL query did not cancel promptly (${elapsedMs}ms, ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`,
			);
		} finally {
			clearTimeout(abortTimer);
		}

		const env = {
			...process.env,
			LIBRARY_CONFIG_PATH: isolatedConfigPath,
			SEARCH_INDEX_WORKER_ID: workerId,
			SEARCH_INDEX_WORKER_INSTANCE_PATH: `${temporaryDirectory}/worker-instance`,
		};
		await registerSearchIndexWorker(
			database,
			workerId,
			"previous-instance",
		);
		await updateSearchIndexWorker(database, workerId, "previous-instance", {
			currentEventCount: 0,
			lastError: "SearchIndexTaskError: previous delivery failed",
			stage: "retrying",
		});
		await stopSearchIndexWorker(database, workerId, "previous-instance");

		await registerSearchIndexWorker(
			database,
			replacementWorkerId,
			"first-instance",
		);
		const replacementInstancePath = `${temporaryDirectory}/replacement-instance`;
		await writeFile(replacementInstancePath, "first-instance\n");
		const replacementHealthEnv = {
			...env,
			SEARCH_INDEX_WORKER_ID: replacementWorkerId,
			SEARCH_INDEX_WORKER_INSTANCE_PATH: replacementInstancePath,
		};
		assert(
			(await waitForExit(
				runTool(
					"tools/checkSearchIndexerHealth.ts",
					[],
					replacementHealthEnv,
				),
			)) === 0,
			"The owning worker generation did not pass health",
		);
		await registerSearchIndexWorker(
			database,
			replacementWorkerId,
			"replacement-instance",
		);
		assert(
			(await waitForExit(
				runTool(
					"tools/checkSearchIndexerHealth.ts",
					[],
					replacementHealthEnv,
				),
			)) !== 0,
			"A replaced worker generation passed health using its replacement",
		);
		for (const operation of [
			() =>
				updateSearchIndexWorker(
					database,
					replacementWorkerId,
					"first-instance",
					{ currentEventCount: 0, stage: "idle" },
				),
			() =>
				stopSearchIndexWorker(
					database,
					replacementWorkerId,
					"first-instance",
				),
		]) {
			try {
				await operation();
				throw new Error("A replaced worker retained state ownership");
			} catch (error) {
				assert(
					error instanceof SearchIndexWorkerOwnershipLostError,
					"Stale worker fencing failed for an unexpected reason",
				);
			}
		}
		const replacement = await getSearchIndexWorker(
			database,
			replacementWorkerId,
		);
		assert(
			replacement?.instanceId === "replacement-instance" &&
				replacement.stage === "starting",
			"The replacement worker state was overwritten",
		);

		worker = runTool(
			"tools/runSearchIndexer.ts",
			["--watch", "--poll-ms", "100"],
			env,
		);
		worker.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		await waitFor(async () => {
			const state = await getSearchIndexWorker(database, workerId);
			return Boolean(
				state &&
				state.stage === "idle" &&
				state.lastError?.includes("previous delivery failed") &&
				searchIndexWorkerIsActive(state),
			);
		}, "The watch worker did not preserve its previous error while becoming idle");

		const health = runTool("tools/checkSearchIndexerHealth.ts", [], env);
		let healthOutput = "";
		health.stdout?.on("data", (chunk) => {
			healthOutput += String(chunk);
		});
		const healthExit = await waitForExit(health);
		assert(healthExit === 0, "The running worker health check failed");
		assert(
			healthOutput.includes(`\"workerId\":\"${workerId}\"`),
			"The health check did not report the expected worker",
		);

		await database.insert(itemIdentity).values({
			key: itemKey,
			sourceConnectionKey: "native",
			sourceRecordKey: itemKey,
		});
		await database.insert(item).values({
			abstractNote: "x".repeat(2_000_000),
			itemType: "Report",
			key: itemKey,
			sourceConnectionKey: "native",
			sourceRecordKey: itemKey,
			title: "Worker progress verification",
		});
		await database.insert(outbox).values({
			entityKey: itemKey,
			entityType: "item",
			operation: "upsert",
			revision: 1,
		});
		const observedStages = new Set<string>();
		let observedTask = false;
		await waitFor(
			async () => {
				const state = await getSearchIndexWorker(database, workerId);
				if (!state) return false;
				observedStages.add(state.stage);
				observedTask ||=
					(state.stage === "waiting" || state.stage === "indexing") &&
					state.currentTaskUid !== null &&
					state.currentEventCount > 0;
				return Boolean(
					state.stage === "idle" &&
					state.lastCompletedAt &&
					state.lastError === null,
				);
			},
			"The worker did not complete and durably report the queued event",
			10,
		);
		assert(
			observedStages.has("projecting") && observedTask,
			`Durable worker progress was incomplete: ${[...observedStages].join(",")}`,
		);
		const indexedDocument = await meilisearch
			.index(isolatedIndexName)
			.getDocument<{ title: string }>(itemKey);
		assert(
			indexedDocument.title === "Worker progress verification",
			"The worker reported completion before the document was searchable",
		);

		worker.kill("SIGTERM");
		const workerExit = await waitForExit(worker);
		assert(
			workerExit === 0,
			`The watch worker did not stop cleanly: ${stderr}`,
		);
		const stopped = await getSearchIndexWorker(database, workerId);
		assert(
			stopped?.stage === "stopped" && stopped.stoppedAt !== null,
			"The worker did not persist its stopped state",
		);
		assert(
			!searchIndexWorkerIsActive(stopped),
			"A stopped worker was still reported as active",
		);

		const stoppedHealth = runTool(
			"tools/checkSearchIndexerHealth.ts",
			[],
			env,
		);
		const stoppedHealthExit = await waitForExit(stoppedHealth);
		assert(
			stoppedHealthExit !== 0,
			"The stopped worker unexpectedly passed its health check",
		);

		let markStalledRequestStarted!: () => void;
		let markStalledRequestClosed!: () => void;
		const stalledRequestStarted = new Promise<void>((resolve) => {
			markStalledRequestStarted = resolve;
		});
		const stalledRequestClosed = new Promise<void>((resolve) => {
			markStalledRequestClosed = resolve;
		});
		stalledSearchServer = createServer((request) => {
			markStalledRequestStarted();
			request.once("close", markStalledRequestClosed);
		});
		await new Promise<void>((resolve, reject) => {
			stalledSearchServer!.once("error", reject);
			stalledSearchServer!.listen(0, "127.0.0.1", resolve);
		});
		const stalledAddress = stalledSearchServer.address();
		assert(
			stalledAddress && typeof stalledAddress !== "string",
			"The stalled search server did not expose its port",
		);
		const stalledConfigPath = `${temporaryDirectory}/stalled-library.json`;
		const stalledConfig = structuredClone(isolatedConfig);
		stalledConfig.services.search.host = `http://127.0.0.1:${stalledAddress.port}`;
		await writeFile(stalledConfigPath, JSON.stringify(stalledConfig));
		stalledWorker = runTool("tools/runSearchIndexer.ts", [], {
			...env,
			LIBRARY_CONFIG_PATH: stalledConfigPath,
			SEARCH_INDEX_WORKER_ID: stalledWorkerId,
			SEARCH_INDEX_WORKER_INSTANCE_PATH: `${temporaryDirectory}/stalled-worker-instance`,
		});
		await withTimeout(
			stalledRequestStarted,
			2_000,
			"The worker never started the stalled request",
		);
		const stalledShutdownStartedAt = Date.now();
		stalledWorker.kill("SIGTERM");
		assert(
			(await waitForExit(stalledWorker, 2_000)) === 0,
			"The worker did not exit cleanly during a stalled search request",
		);
		await withTimeout(
			stalledRequestClosed,
			2_000,
			"The stalled search socket remained open",
		);
		assert(
			Date.now() - stalledShutdownStartedAt < 2_000,
			"The worker exceeded the stalled-request shutdown deadline",
		);
		const stalledState = await getSearchIndexWorker(
			database,
			stalledWorkerId,
		);
		assert(
			stalledState?.stage === "stopped" &&
				stalledState.stoppedAt !== null,
			"The stalled worker did not persist its stopped state",
		);

		const failedConfigPath = `${temporaryDirectory}/failure-library.json`;
		const failedConfig = structuredClone(isolatedConfig);
		failedConfig.services.search.host = "http://127.0.0.1:1";
		await writeFile(failedConfigPath, JSON.stringify(failedConfig));
		failedWorker = runTool("tools/runSearchIndexer.ts", [], {
			...env,
			LIBRARY_CONFIG_PATH: failedConfigPath,
			SEARCH_INDEX_WORKER_ID: failureWorkerId,
			SEARCH_INDEX_WORKER_INSTANCE_PATH: `${temporaryDirectory}/failure-worker-instance`,
		});
		const failedExit = await waitForExit(failedWorker);
		assert(
			failedExit !== 0,
			"The worker with an unavailable search service unexpectedly started",
		);
		const failedState = await getSearchIndexWorker(
			database,
			failureWorkerId,
		);
		assert(
			failedState?.stage === "stopped" && Boolean(failedState.lastError),
			"The startup failure was not retained in durable worker state",
		);
	} catch (error) {
		verificationError = error;
	} finally {
		await attemptCleanup(() => terminateChild(migration));
		await attemptCleanup(() => terminateChild(worker));
		await attemptCleanup(() => terminateChild(stalledWorker));
		await attemptCleanup(() => terminateChild(failedWorker));
		if (stalledSearchServer) {
			await attemptCleanup(() => closeServer(stalledSearchServer!));
		}
		if (meilisearch) {
			await attemptCleanup(() =>
				deleteIndexIfPresent(meilisearch!, isolatedIndexName),
			);
		}
		if (resource) {
			await attemptCleanup(() => resource!.dispose());
		}
		await attemptCleanup(() =>
			adminResource.pool.query(
				`DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`,
			),
		);
		if (temporaryDirectory) {
			await attemptCleanup(() =>
				rm(temporaryDirectory!, { force: true, recursive: true }),
			);
		}
		await attemptCleanup(() => adminResource.dispose());
	}

	if (verificationError) {
		for (const cleanupError of cleanupErrors) {
			console.error("Verifier cleanup failed", cleanupError);
		}
		throw verificationError;
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(
			cleanupErrors,
			"Search worker verifier cleanup failed",
		);
	}
	console.log(
		JSON.stringify({
			gracefulShutdown: true,
			healthCheck: true,
			postgresCancellation: true,
			heartbeat: true,
			durableProgress: true,
			historicalErrorPreserved: true,
			healthGenerationFencing: true,
			replacementFencing: true,
			startupFailureState: true,
			stalledRequestShutdown: true,
			isolatedDatabase: true,
			isolatedIndex: true,
			workerId,
		}),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
