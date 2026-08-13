import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium, webkit, type Browser, type Page } from "@playwright/test";
import {
	generateCanonicalRecordKey,
	itemIdentity,
	outbox,
	searchIndexWorker,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Meilisearch, MeilisearchApiError } from "meilisearch";

import {
	DatabaseOperationAbortedError,
	withCancellableDatabaseTransaction,
} from "../src/db/cancellable-transaction";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { item } from "../src/db/schema/tables/item";
import { status as libraryStatus } from "../src/db/schema/tables/status";
import {
	getSearchIndexWorker,
	registerSearchIndexWorker,
	searchIndexWorkerIsActive,
	SearchIndexWorkerOwnershipLostError,
	stopSearchIndexWorker,
	updateSearchIndexWorker,
} from "../src/lib/search-index/worker-state";
import { chunkValues } from "../src/lib/chunk-values";
import {
	adminSearchIndexStatus,
	measureAdminSearchIndexTrigger,
	openAndMeasureAdminSearchIndexPopover,
	waitForAdminSearchIndexStatus,
} from "../tests/e2e/admin-search-index-page";
import {
	createAdminTestSession,
	type AdminTestSession,
	withAdminTestSession,
} from "./adminSession";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
if (!process.env.LIBRARY_CONFIG_PATH) {
	throw new Error("LIBRARY_CONFIG_PATH is required");
}

const workerId = `search-worker-e2e-${process.pid}`;
const itemKey = "WRKR2345";
const timeoutMs = 20_000;
let adminSession: AdminTestSession;

type IndexReceipt = {
	entityKey: string;
	entityType: "collection" | "item";
	revision: number;
};

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

async function availablePort() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert(
		address && typeof address !== "string",
		"Could not reserve a local HTTP port",
	);
	await closeServer(server);
	return address.port;
}

async function requestJson<T>(
	baseUrl: string,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: withAdminTestSession(adminSession, {
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		}),
	});
	const body = (await response.json().catch(() => null)) as T | null;
	if (!response.ok) {
		throw new Error(
			`${init?.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
		);
	}
	assert(body !== null, `${init?.method ?? "GET"} ${path} returned no JSON`);
	return body;
}

async function receiptStatuses(baseUrl: string, receipts: IndexReceipt[]) {
	return requestJson<{
		receipts: Array<IndexReceipt & { state: string }>;
	}>(baseUrl, "/api/admin/search-index/receipts", {
		body: JSON.stringify({ receipts }),
		method: "POST",
	});
}

async function waitForReceiptsIndexed(
	baseUrl: string,
	receipts: IndexReceipt[],
	message: string,
) {
	await waitFor(async () => {
		const result = await receiptStatuses(baseUrl, receipts);
		return result.receipts.every(({ state }) => state === "indexed");
	}, message);
}

async function publishDraftThroughAdmin(page: Page, title: string) {
	const checkbox = page.getByRole("checkbox", { name: `Select ${title}` });
	await checkbox.waitFor({ state: "visible", timeout: timeoutMs });
	await checkbox.check();
	const mutationResponse = page.waitForResponse((response) => {
		const request = response.request();
		return (
			new URL(response.url()).pathname === "/api/admin/items/batch" &&
			request.method() === "POST"
		);
	});
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Publish selected" })
		.click();
	const response = await mutationResponse;
	assert(
		response.ok(),
		`The admin publish request failed (${response.status()})`,
	);
	const body = (await response.json()) as {
		results?: Array<{ indexingReceipts?: IndexReceipt[] }>;
	};
	const receipts = body.results?.flatMap(
		({ indexingReceipts }) => indexingReceipts ?? [],
	);
	assert(
		receipts?.length,
		"The admin publish response did not include an indexing receipt",
	);
	return receipts;
}

function outboxReceiptPredicate(receipt: IndexReceipt) {
	return and(
		eq(outbox.entityKey, receipt.entityKey),
		eq(outbox.entityType, receipt.entityType),
		eq(outbox.revision, receipt.revision),
	);
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
	const browserFailureWorkerId = `${workerId}-browser-failure`;
	const stalledWorkerId = `${workerId}-stalled-request`;
	const isolatedDatabaseName = `search_worker_e2e_${process.pid}`;
	const isolatedIndexName = `search_worker_e2e_${process.pid}`;
	const failedIndexName = `search_worker_e2e_failure_${process.pid}`;
	const quotedDatabaseName = `"${isolatedDatabaseName}"`;
	let resource: ReturnType<typeof createPostgresDatabaseResource> | null =
		null;
	let migration: ReturnType<typeof runCommand> | null = null;
	let temporaryDirectory: string | null = null;
	let meilisearch: Meilisearch | null = null;
	let worker: ReturnType<typeof runTool> | null = null;
	let browserFailureWorker: ReturnType<typeof runTool> | null = null;
	let stalledWorker: ReturnType<typeof runTool> | null = null;
	let failedWorker: ReturnType<typeof runTool> | null = null;
	let webServer: ReturnType<typeof runCommand> | null = null;
	let chromiumBrowser: Browser | null = null;
	let webkitBrowser: Browser | null = null;
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
			authentication: { adminPassword: string };
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
		const [seededStatus] = await database
			.select()
			.from(libraryStatus)
			.where(eq(libraryStatus.id, 1));
		assert(
			seededStatus?.totalItems === 0 && seededStatus.totalRecords === 0,
			"Fresh database migrations did not create the empty status row",
		);
		await database
			.update(libraryStatus)
			.set({ databaseUpdatedAt: new Date() })
			.where(eq(libraryStatus.id, 1));
		meilisearch = new Meilisearch({
			apiKey: isolatedConfig.services.search.key,
			host: isolatedConfig.services.search.host,
		});
		await deleteIndexIfPresent(meilisearch, isolatedIndexName);
		await deleteIndexIfPresent(meilisearch, failedIndexName);

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
					browserFailureWorkerId,
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
		const webPort = await availablePort();
		const baseUrl = `http://127.0.0.1:${webPort}`;
		let webOutput = "";
		webServer = runCommand(
			"node_modules/.bin/next",
			["start", "--hostname", "127.0.0.1", "--port", String(webPort)],
			env,
		);
		webServer.stdout?.on("data", (chunk) => {
			webOutput += String(chunk);
		});
		webServer.stderr?.on("data", (chunk) => {
			webOutput += String(chunk);
		});
		await waitFor(async () => {
			try {
				const response = await fetch(
					`${baseUrl}/api/library-config/health`,
				);
				return response.ok;
			} catch {
				return false;
			}
		}, `The isolated admin server did not start: ${webOutput}`);
		adminSession = await createAdminTestSession(
			baseUrl,
			isolatedConfig.authentication.adminPassword,
		);

		const statusKeys = Array.from({ length: 6 }, () =>
			generateCanonicalRecordKey(),
		);
		const statusNow = new Date();
		await database.insert(outbox).values([
			{
				entityKey: statusKeys[0]!,
				entityType: "item",
				operation: "upsert",
				revision: 1,
			},
			{
				attempts: 2,
				entityKey: statusKeys[1]!,
				entityType: "item",
				lastError: "Temporary search failure",
				nextAttemptAt: new Date(statusNow.getTime() + 60_000),
				operation: "upsert",
				revision: 1,
			},
			{
				entityKey: statusKeys[2]!,
				entityType: "item",
				leaseExpiresAt: new Date(statusNow.getTime() + 60_000),
				leaseOwner: "receipt-verifier",
				operation: "upsert",
				revision: 1,
			},
			{
				entityKey: statusKeys[3]!,
				entityType: "item",
				operation: "upsert",
				processedAt: statusNow,
				revision: 1,
			},
			{
				attempts: 15,
				deadLetteredAt: statusNow,
				entityKey: statusKeys[4]!,
				entityType: "item",
				lastError: "Permanent search failure",
				operation: "upsert",
				revision: 1,
			},
		]);
		await registerSearchIndexWorker(
			database,
			workerId,
			"receipt-verifier",
			statusNow,
		);
		await updateSearchIndexWorker(
			database,
			workerId,
			"receipt-verifier",
			{
				currentBatchProgress: 37,
				currentBatchUid: 22,
				currentEventCount: 3,
				currentTaskUid: 11,
				stage: "indexing",
			},
			statusNow,
		);
		const receipts: IndexReceipt[] = statusKeys.map((entityKey) => ({
			entityKey,
			entityType: "item",
			revision: 1,
		}));
		const statuses = await receiptStatuses(baseUrl, receipts);
		assert(
			statuses.receipts.map(({ state }) => state).join(",") ===
				"queued,retrying,processing,indexed,failed,unknown",
			`Receipt states were wrong: ${JSON.stringify(statuses)}`,
		);
		const overview = await requestJson<{
			queue: { hasFailed: boolean; hasPending: boolean };
			worker: {
				active: boolean;
				batchProgress: number | null;
				stage: string;
			} | null;
		}>(baseUrl, "/api/admin/search-index");
		assert(
			overview.queue.hasFailed &&
				overview.queue.hasPending &&
				overview.worker?.active === true &&
				overview.worker.stage === "indexing" &&
				overview.worker.batchProgress === 37,
			`Search overview was wrong: ${JSON.stringify(overview)}`,
		);
		const targetedRetry = await requestJson<{
			receipts: IndexReceipt[];
			requeued: number;
		}>(baseUrl, "/api/admin/search-index/retry", {
			body: JSON.stringify({
				receipts: [receipts[3], receipts[4]],
				scope: "receipts",
			}),
			method: "POST",
		});
		assert(
			targetedRetry.requeued === 1 &&
				targetedRetry.receipts[0]?.entityKey === statusKeys[4],
			`Targeted retry changed the wrong receipts: ${JSON.stringify(targetedRetry)}`,
		);
		await database.insert(outbox).values({
			attempts: 15,
			deadLetteredAt: statusNow,
			entityKey: statusKeys[5]!,
			entityType: "collection",
			lastError: "Second permanent search failure",
			operation: "delete",
			revision: 1,
		});
		const allRetry = await requestJson<{
			receipts: IndexReceipt[];
			requeued: number;
		}>(baseUrl, "/api/admin/search-index/retry", {
			body: JSON.stringify({ scope: "allFailed" }),
			method: "POST",
		});
		assert(
			allRetry.requeued === 1 && allRetry.receipts.length === 0,
			`All-failure retry was not bounded: ${JSON.stringify(allRetry)}`,
		);
		const invalidRetry = await fetch(
			`${baseUrl}/api/admin/search-index/retry`,
			{
				body: JSON.stringify({ scope: "all" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);
		const invalidRetryBody = (await invalidRetry.json()) as {
			error?: { code?: string; fields?: Record<string, string> };
		};
		assert(
			invalidRetry.status === 400 &&
				invalidRetryBody.error?.code === "validation_failed" &&
				Boolean(invalidRetryBody.error.fields),
			`Invalid retry did not return a human validation error: ${JSON.stringify(invalidRetryBody)}`,
		);
		await database
			.delete(outbox)
			.where(inArray(outbox.entityKey, statusKeys));

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
			)) !== 0,
			"A worker passed health before startup finished",
		);
		await updateSearchIndexWorker(
			database,
			replacementWorkerId,
			"first-instance",
			{ currentEventCount: 0, stage: "idle" },
		);
		assert(
			(await waitForExit(
				runTool(
					"tools/checkSearchIndexerHealth.ts",
					[],
					replacementHealthEnv,
				),
			)) === 0,
			"The ready owning worker generation did not pass health",
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

		const created = await requestJson<{
			draft: { itemKey: string };
		}>(baseUrl, "/api/admin/items/drafts", {
			body: JSON.stringify({
				abstractNote: "x".repeat(2_000_000),
				collections: [],
				creators: [],
				itemType: "Report",
				tags: [],
				title: "Worker progress verification",
			}),
			method: "POST",
		});
		const published = await requestJson<{
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, `/api/admin/items/${created.draft.itemKey}/publish`, {
			method: "POST",
		});
		assert(
			published.indexingReceipts[0]?.entityKey ===
				created.draft.itemKey &&
				published.indexingReceipts[0]?.revision === 1,
			`Publish did not return its indexing receipt: ${JSON.stringify(published)}`,
		);
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
			.getDocument<{ title: string }>(created.draft.itemKey);
		assert(
			indexedDocument.title === "Worker progress verification",
			"The worker reported completion before the document was searchable",
		);
		const opened = await requestJson<{
			draft: { draftRevision: number; payload: Record<string, unknown> };
		}>(baseUrl, `/api/admin/items/${created.draft.itemKey}/draft`, {
			method: "POST",
		});
		await requestJson(
			baseUrl,
			`/api/admin/items/${created.draft.itemKey}/draft`,
			{
				body: JSON.stringify({
					expectedDraftRevision: opened.draft.draftRevision,
					expectedPayload: opened.draft.payload,
					payload: {
						...opened.draft.payload,
						abstractNote: "Updated and reindexed",
						title: "Worker progress verification updated",
					},
				}),
				method: "PUT",
			},
		);
		const republished = await requestJson<{
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, `/api/admin/items/${created.draft.itemKey}/publish`, {
			method: "POST",
		});
		assert(
			republished.indexingReceipts[0]?.revision === 2,
			"The edited publication did not return revision 2",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			republished.indexingReceipts,
			"The edited publication receipt never became indexed",
		);
		const updatedDocument = await meilisearch
			.index(isolatedIndexName)
			.getDocument<{ title: string }>(created.draft.itemKey);
		assert(
			updatedDocument.title === "Worker progress verification updated",
			"The indexed document did not reflect the edited metadata",
		);
		const unpublished = await requestJson<{
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, `/api/admin/items/${created.draft.itemKey}/unpublish`, {
			method: "POST",
		});
		await waitForReceiptsIndexed(
			baseUrl,
			unpublished.indexingReceipts,
			"The unpublish receipt never became indexed",
		);
		try {
			await meilisearch
				.index(isolatedIndexName)
				.getDocument(created.draft.itemKey);
			throw new Error("The unpublished document remained searchable");
		} catch (error) {
			assert(
				error instanceof MeilisearchApiError &&
					error.cause?.code === "document_not_found",
				"The unpublished document lookup failed unexpectedly",
			);
		}

		const createDraft = (payload: Record<string, unknown>) =>
			requestJson<{ draft: { itemKey: string } }>(
				baseUrl,
				"/api/admin/items/drafts",
				{
					body: JSON.stringify(payload),
					method: "POST",
				},
			);
		const oldParent = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Old receipt parent",
		});
		const newParent = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "New receipt parent",
		});
		for (const parent of [oldParent, newParent]) {
			const result = await requestJson<{
				indexingReceipts: IndexReceipt[];
			}>(baseUrl, `/api/admin/items/${parent.draft.itemKey}/publish`, {
				method: "POST",
			});
			await waitForReceiptsIndexed(
				baseUrl,
				result.indexingReceipts,
				"A reparenting fixture parent was not indexed",
			);
		}
		const child = await createDraft({
			itemType: "Attachment",
			parentItem: oldParent.draft.itemKey,
			tags: [],
			title: "Receipt reparent child",
		});
		const childPublished = await requestJson<{
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, `/api/admin/items/${child.draft.itemKey}/publish`, {
			method: "POST",
		});
		await waitForReceiptsIndexed(
			baseUrl,
			childPublished.indexingReceipts,
			"The initial child publication was not indexed",
		);
		const childDraft = await requestJson<{
			draft: { draftRevision: number; payload: Record<string, unknown> };
		}>(baseUrl, `/api/admin/items/${child.draft.itemKey}/draft`, {
			method: "POST",
		});
		await requestJson(
			baseUrl,
			`/api/admin/items/${child.draft.itemKey}/draft`,
			{
				body: JSON.stringify({
					expectedDraftRevision: childDraft.draft.draftRevision,
					expectedPayload: childDraft.draft.payload,
					payload: {
						...childDraft.draft.payload,
						parentItem: newParent.draft.itemKey,
					},
				}),
				method: "PUT",
			},
		);
		const reparented = await requestJson<{
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, `/api/admin/items/${child.draft.itemKey}/publish`, {
			method: "POST",
		});
		const reparentReceiptKeys = new Set(
			reparented.indexingReceipts.map(({ entityKey }) => entityKey),
		);
		assert(
			reparentReceiptKeys.size === 3 &&
				reparentReceiptKeys.has(child.draft.itemKey) &&
				reparentReceiptKeys.has(oldParent.draft.itemKey) &&
				reparentReceiptKeys.has(newParent.draft.itemKey),
			`Reparenting did not expose all transactional receipts: ${JSON.stringify(reparented)}`,
		);
		await waitForReceiptsIndexed(
			baseUrl,
			reparented.indexingReceipts,
			"The reparenting receipt set did not finish indexing",
		);
		const [oldParentDocument, newParentDocument] = await Promise.all([
			meilisearch.index(isolatedIndexName).getDocument<{
				attachmentsData: Array<{ key: string }>;
			}>(oldParent.draft.itemKey),
			meilisearch.index(isolatedIndexName).getDocument<{
				attachmentsData: Array<{ key: string }>;
			}>(newParent.draft.itemKey),
		]);
		assert(
			!oldParentDocument.attachmentsData.some(
				({ key }) => key === child.draft.itemKey,
			) &&
				newParentDocument.attachmentsData.some(
					({ key }) => key === child.draft.itemKey,
				),
			"The completed reparent receipt set left a stale parent projection",
		);

		let createdCollection = await requestJson<{
			collection: { key: string; revision: number };
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, "/api/admin/collections", {
			body: JSON.stringify({
				name: "Index receipt verification",
				parentCollection: null,
			}),
			method: "POST",
		});
		assert(
			createdCollection.indexingReceipts.length === 1 &&
				createdCollection.indexingReceipts[0]?.entityType ===
					"collection",
			"Collection creation did not return its indexing receipt",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			createdCollection.indexingReceipts,
			"The collection receipt never became indexed",
		);
		createdCollection = await requestJson<{
			collection: { key: string; revision: number };
			indexingReceipts: IndexReceipt[];
		}>(
			baseUrl,
			`/api/admin/collections/${createdCollection.collection.key}`,
			{
				body: JSON.stringify({
					expectedRevision: createdCollection.collection.revision,
					name: "Renamed index receipt verification",
				}),
				method: "PATCH",
			},
		);
		assert(
			createdCollection.indexingReceipts[0]?.revision ===
				createdCollection.collection.revision,
			"Collection rename returned the wrong receipt revision",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			createdCollection.indexingReceipts,
			"The collection rename receipt never became indexed",
		);
		const targetCollection = await requestJson<{
			collection: { key: string; revision: number };
			indexingReceipts: IndexReceipt[];
		}>(baseUrl, "/api/admin/collections", {
			body: JSON.stringify({
				name: "Receipt move target",
				parentCollection: null,
			}),
			method: "POST",
		});
		await waitForReceiptsIndexed(
			baseUrl,
			targetCollection.indexingReceipts,
			"The collection move target receipt never became indexed",
		);
		const movedCollection = await requestJson<{
			collection: { key: string; revision: number };
			indexingReceipts: IndexReceipt[];
		}>(
			baseUrl,
			`/api/admin/collections/${createdCollection.collection.key}/move`,
			{
				body: JSON.stringify({
					expectedRevision: createdCollection.collection.revision,
					position: "inside",
					targetCollection: targetCollection.collection.key,
				}),
				method: "POST",
			},
		);
		assert(
			movedCollection.indexingReceipts[0]?.revision ===
				movedCollection.collection.revision,
			"Collection move returned the wrong receipt revision",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			movedCollection.indexingReceipts,
			"The collection move receipt never became indexed",
		);
		const deletedCollection = await requestJson<{
			collections: Array<{ key: string; revision: number }>;
			indexingReceipts: IndexReceipt[];
		}>(
			baseUrl,
			`/api/admin/collections/${movedCollection.collection.key}`,
			{
				body: JSON.stringify({
					expectedRevision: movedCollection.collection.revision,
				}),
				method: "DELETE",
			},
		);
		assert(
			deletedCollection.indexingReceipts.length ===
				deletedCollection.collections.length &&
				deletedCollection.indexingReceipts[0]?.revision ===
					deletedCollection.collections[0]?.revision,
			"Collection deletion did not expose every changed receipt",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			deletedCollection.indexingReceipts,
			"The collection delete receipts never became indexed",
		);
		const deletedRoot = deletedCollection.collections.find(
			({ key }) => key === movedCollection.collection.key,
		);
		assert(deletedRoot, "The deleted collection response omitted its root");
		const restoredCollection = await requestJson<{
			collections: Array<{ key: string; revision: number }>;
			indexingReceipts: IndexReceipt[];
		}>(
			baseUrl,
			`/api/admin/collections/${movedCollection.collection.key}/restore`,
			{
				body: JSON.stringify({
					expectedRevision: deletedRoot.revision,
				}),
				method: "POST",
			},
		);
		assert(
			restoredCollection.indexingReceipts.length ===
				restoredCollection.collections.length,
			"Collection restoration did not expose every changed receipt",
		);
		await waitForReceiptsIndexed(
			baseUrl,
			restoredCollection.indexingReceipts,
			"The collection restore receipts never became indexed",
		);

		worker.kill("SIGTERM");
		const preBrowserWorkerExit = await waitForExit(worker);
		assert(
			preBrowserWorkerExit === 0,
			`The watch worker did not stop before the browser workload: ${stderr}`,
		);
		worker = null;
		const preBrowserStopped = await getSearchIndexWorker(
			database,
			workerId,
		);
		assert(
			preBrowserStopped?.stage === "stopped" &&
				preBrowserStopped.stoppedAt !== null &&
				!searchIndexWorkerIsActive(preBrowserStopped),
			"The worker did not persist its stopped state before the browser workload",
		);

		const browserPublishTitle = "Browser indexing verification";
		const browserPublishDraft = await createDraft({
			abstractNote:
				"Browser-published record in the real progress workload.",
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: browserPublishTitle,
		});
		chromiumBrowser = await chromium.launch();
		const chromiumPage = await chromiumBrowser.newPage({
			viewport: { height: 900, width: 1440 },
		});
		await chromiumPage
			.context()
			.addCookies([
				{
					name: adminSession.name,
					url: baseUrl,
					value: adminSession.value,
				},
			]);
		await chromiumPage.goto(`${baseUrl}/admin`);
		const initialChromiumStatus = adminSearchIndexStatus(chromiumPage);
		try {
			await initialChromiumStatus.waitFor({
				state: "visible",
				timeout: timeoutMs,
			});
		} catch (error) {
			await chromiumPage.screenshot({
				path: `${temporaryDirectory}/admin-indexing-failure.png`,
			});
			throw new Error(
				`The real admin indexing control did not render at ${chromiumPage.url()}: ${(await chromiumPage.locator("body").innerText()).slice(0, 500)}\n${webOutput.slice(-3_000)}`,
				{ cause: error },
			);
		}
		await waitForAdminSearchIndexStatus(
			chromiumPage,
			"Search offline",
			timeoutMs,
		);

		const progressFixtureIndexes = Array.from(
			{ length: 99 },
			(_value, index) => index,
		);
		const progressFixtureKeys: string[] = [];
		for (const fixtureChunk of chunkValues(progressFixtureIndexes, 10)) {
			const fixtures = await Promise.all(
				fixtureChunk.map((index) =>
					createDraft({
						abstractNote: `progress-${index}-${"x".repeat(500_000)}`,
						collections: [],
						creators: [],
						itemType: "Report",
						tags: [],
						title: `Indexing progress fixture ${index + 1}`,
					}),
				),
			);
			progressFixtureKeys.push(
				...fixtures.map(({ draft }) => draft.itemKey),
			);
		}
		for (const keyChunk of chunkValues(progressFixtureKeys, 50)) {
			const result = await requestJson<{
				results: Array<{
					indexingReceipts: IndexReceipt[];
					outcome: string;
				}>;
			}>(baseUrl, "/api/admin/items/batch", {
				body: JSON.stringify({ action: "publish", keys: keyChunk }),
				method: "POST",
			});
			assert(
				result.results.length === keyChunk.length &&
					result.results.every(
						({ indexingReceipts, outcome }) =>
							outcome === "changed" &&
							indexingReceipts.length === 1,
					),
				"The real progress workload did not queue every fixture",
			);
		}
		await waitForAdminSearchIndexStatus(
			chromiumPage,
			"Search paused",
			timeoutMs,
		);
		const browserPublishReceipts = await publishDraftThroughAdmin(
			chromiumPage,
			browserPublishTitle,
		);
		assert(
			browserPublishReceipts.length === 1 &&
				browserPublishReceipts[0]?.entityKey ===
					browserPublishDraft.draft.itemKey,
			"The browser publish returned the wrong indexing receipt",
		);
		await waitForAdminSearchIndexStatus(
			chromiumPage,
			"Search paused",
			timeoutMs,
		);
		worker = runTool(
			"tools/runSearchIndexer.ts",
			["--watch", "--poll-ms", "100"],
			env,
		);
		worker.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		await chromiumPage.waitForFunction(
			() => {
				const status = document.querySelector(
					"[data-admin-search-index-status]",
				);
				return (
					status?.getAttribute("data-admin-search-index-status") ===
						"indexing" &&
					/^Search indexing: Indexing (?:[1-9]|[1-9]\d)%$/u.test(
						status.getAttribute("aria-label") ?? "",
					)
				);
			},
			undefined,
			{ timeout: timeoutMs },
		);
		const activeStatus = chromiumPage.locator(
			'[data-admin-search-index-status="indexing"]',
		);
		const triggerGeometry =
			await measureAdminSearchIndexTrigger(activeStatus);
		assert(
			JSON.stringify(triggerGeometry) ===
				JSON.stringify({
					display: "flex",
					flexDirection: "row",
					height: 40,
					iconHeight: 14,
					paddingLeft: "8px",
					paddingRight: "8px",
					width: 40,
				}),
			`The real indexing trigger computed CSS was wrong: ${JSON.stringify(triggerGeometry)}`,
		);
		const { geometry: statusGeometry } =
			await openAndMeasureAdminSearchIndexPopover(
				chromiumPage,
				activeStatus,
				timeoutMs,
			);
		assert(
			statusGeometry.documentOverflow === 0 &&
				statusGeometry.innerPadding === "12px" &&
				statusGeometry.progressHeight === 4 &&
				statusGeometry.rightInsideViewport &&
				statusGeometry.surfaceBorderRadius === "12px" &&
				statusGeometry.surfaceBorderWidth === "1px" &&
				statusGeometry.width === 256,
			`The real indexing progress popover computed CSS was wrong: ${JSON.stringify(statusGeometry)}`,
		);
		await chromiumPage.screenshot({
			path: `${temporaryDirectory}/admin-indexing-e2e.png`,
		});
		await chromiumPage.keyboard.press("Escape");
		await waitForAdminSearchIndexStatus(
			chromiumPage,
			"Search updated",
			timeoutMs,
		);
		const browserIndexedDocument = await meilisearch
			.index(isolatedIndexName)
			.getDocument<{ title: string }>(browserPublishDraft.draft.itemKey);
		assert(
			browserIndexedDocument.title === browserPublishTitle,
			"The admin UI reported completion before its document was searchable",
		);
		await chromiumBrowser.close();
		chromiumBrowser = null;

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

		const failedIndexTask = await meilisearch
			.createIndex(failedIndexName, { primaryKey: "id" })
			.waitTask();
		assert(
			failedIndexTask.status === "succeeded",
			"The deliberately incompatible Meilisearch index was not created",
		);
		const browserFailureConfigPath = `${temporaryDirectory}/browser-failure-library.json`;
		const browserFailureConfig = structuredClone(isolatedConfig);
		browserFailureConfig.services.search.index = failedIndexName;
		await writeFile(
			browserFailureConfigPath,
			JSON.stringify(browserFailureConfig),
		);
		const browserRetryTitle = "Browser indexing retry verification";
		const browserRetryDraft = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: browserRetryTitle,
		});
		webkitBrowser = await webkit.launch();
		const webkitPage = await webkitBrowser.newPage({
			viewport: { height: 900, width: 1440 },
		});
		await webkitPage
			.context()
			.addCookies([
				{
					name: adminSession.name,
					url: baseUrl,
					value: adminSession.value,
				},
			]);
		await webkitPage.goto(`${baseUrl}/admin`);
		await waitForAdminSearchIndexStatus(
			webkitPage,
			"Search offline",
			timeoutMs,
		);
		const browserRetryReceipts = await publishDraftThroughAdmin(
			webkitPage,
			browserRetryTitle,
		);
		assert(
			browserRetryReceipts.length === 1 &&
				browserRetryReceipts[0]?.entityKey ===
					browserRetryDraft.draft.itemKey,
			"The browser retry publish returned the wrong indexing receipt",
		);
		const browserRetryReceipt = browserRetryReceipts[0]!;
		await waitForAdminSearchIndexStatus(
			webkitPage,
			"Search paused",
			timeoutMs,
		);
		browserFailureWorker = runTool(
			"tools/runSearchIndexer.ts",
			["--watch", "--poll-ms", "100"],
			{
				...env,
				LIBRARY_CONFIG_PATH: browserFailureConfigPath,
				SEARCH_INDEX_WORKER_ID: browserFailureWorkerId,
				SEARCH_INDEX_WORKER_INSTANCE_PATH: `${temporaryDirectory}/browser-failure-worker-instance`,
			},
		);
		browserFailureWorker.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		for (
			let expectedAttempts = 1;
			expectedAttempts <= 15;
			expectedAttempts += 1
		) {
			await waitFor(async () => {
				const [failed] = await database
					.select({
						attempts: outbox.attempts,
						deadLetteredAt: outbox.deadLetteredAt,
					})
					.from(outbox)
					.where(outboxReceiptPredicate(browserRetryReceipt));
				return Boolean(
					failed &&
					failed.attempts >= expectedAttempts &&
					(expectedAttempts < 15 || failed.deadLetteredAt),
				);
			}, `The real Meilisearch task failure did not reach attempt ${expectedAttempts}`);
			if (expectedAttempts < 15) {
				await database
					.update(outbox)
					.set({ nextAttemptAt: new Date() })
					.where(outboxReceiptPredicate(browserRetryReceipt));
			}
		}
		const unrelatedFailedKey = generateCanonicalRecordKey();
		const deadLetteredAt = new Date();
		await database.insert(outbox).values({
			attempts: 15,
			deadLetteredAt,
			entityKey: unrelatedFailedKey,
			entityType: "item",
			lastError: "Unrelated permanent search failure",
			nextAttemptAt: deadLetteredAt,
			operation: "delete",
			revision: 1,
		});
		const failedStatus = await waitForAdminSearchIndexStatus(
			webkitPage,
			"Indexing failed",
			timeoutMs,
		);
		browserFailureWorker.kill("SIGTERM");
		assert(
			(await waitForExit(browserFailureWorker)) === 0,
			`The real failing search worker did not stop cleanly: ${stderr}`,
		);
		const failedTriggerGeometry =
			await measureAdminSearchIndexTrigger(failedStatus);
		assert(
			failedTriggerGeometry.height === 40 &&
				failedTriggerGeometry.iconHeight === 14 &&
				failedTriggerGeometry.paddingLeft === "8px" &&
				failedTriggerGeometry.paddingRight === "8px",
			`The WebKit indexing trigger computed CSS was wrong: ${JSON.stringify(failedTriggerGeometry)}`,
		);
		const { geometry: failedPopoverGeometry, popover: failedPopover } =
			await openAndMeasureAdminSearchIndexPopover(
				webkitPage,
				failedStatus,
				timeoutMs,
			);
		assert(
			failedPopoverGeometry.documentOverflow === 0 &&
				failedPopoverGeometry.innerPadding === "12px" &&
				failedPopoverGeometry.progressHeight === null &&
				failedPopoverGeometry.rightInsideViewport &&
				failedPopoverGeometry.surfaceBorderRadius === "12px" &&
				failedPopoverGeometry.surfaceBorderWidth === "1px" &&
				failedPopoverGeometry.width === 256,
			`The WebKit failed popover computed CSS was wrong: ${JSON.stringify(failedPopoverGeometry)}`,
		);
		await failedPopover
			.getByRole("button", { name: "Retry indexing" })
			.click();
		await webkitPage.keyboard.press("Escape");
		await waitFor(async () => {
			const [requeued] = await database
				.select({
					attempts: outbox.attempts,
					deadLetteredAt: outbox.deadLetteredAt,
				})
				.from(outbox)
				.where(outboxReceiptPredicate(browserRetryReceipt));
			return requeued?.attempts === 0 && requeued.deadLetteredAt === null;
		}, "The admin retry control did not requeue the exact failed receipt");
		const [unrelatedFailure] = await database
			.select({
				attempts: outbox.attempts,
				deadLetteredAt: outbox.deadLetteredAt,
			})
			.from(outbox)
			.where(eq(outbox.entityKey, unrelatedFailedKey));
		assert(
			unrelatedFailure?.attempts === 15 &&
				unrelatedFailure.deadLetteredAt !== null,
			"The admin retry control changed an unrelated failed receipt",
		);
		await database
			.delete(outbox)
			.where(eq(outbox.entityKey, unrelatedFailedKey));
		await waitForAdminSearchIndexStatus(
			webkitPage,
			"Search paused",
			timeoutMs,
		);
		worker = runTool(
			"tools/runSearchIndexer.ts",
			["--watch", "--poll-ms", "100"],
			env,
		);
		worker.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		await waitForAdminSearchIndexStatus(
			webkitPage,
			"Search updated",
			timeoutMs,
		);
		const retriedDocument = await meilisearch
			.index(isolatedIndexName)
			.getDocument<{ title: string }>(browserRetryDraft.draft.itemKey);
		assert(
			retriedDocument.title === browserRetryTitle,
			"The browser retry reported completion before the document was searchable",
		);
		await webkitBrowser.close();
		webkitBrowser = null;
		worker.kill("SIGTERM");
		assert(
			(await waitForExit(worker)) === 0,
			`The restarted watch worker did not stop cleanly: ${stderr}`,
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
		if (chromiumBrowser) {
			await attemptCleanup(() => chromiumBrowser!.close());
		}
		if (webkitBrowser) {
			await attemptCleanup(() => webkitBrowser!.close());
		}
		await attemptCleanup(() => terminateChild(migration));
		await attemptCleanup(() => terminateChild(worker));
		await attemptCleanup(() => terminateChild(browserFailureWorker));
		await attemptCleanup(() => terminateChild(stalledWorker));
		await attemptCleanup(() => terminateChild(failedWorker));
		await attemptCleanup(() => terminateChild(webServer));
		if (stalledSearchServer) {
			await attemptCleanup(() => closeServer(stalledSearchServer!));
		}
		if (meilisearch) {
			await attemptCleanup(() =>
				deleteIndexIfPresent(meilisearch!, isolatedIndexName),
			);
			await attemptCleanup(() =>
				deleteIndexIfPresent(meilisearch!, failedIndexName),
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
			adminHttpReceipts: true,
			adminHttpRetry: true,
			completeReparentReceipts: true,
			collectionMutationReceipts: true,
			adminBrowserComputedCss: true,
			adminBrowserLiveProgress: true,
			adminBrowserPublishIndexed: true,
			adminBrowserRetryIndexed: true,
			adminBrowserRetryIsolation: true,
			chromium: true,
			currentProductionBuild: true,
			realMeilisearchTaskFailure: true,
			webkit: true,
			publishEditDeleteIndexed: true,
			workerId,
		}),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
