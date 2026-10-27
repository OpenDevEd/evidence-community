/**
 * Checks Meilisearch's embedder on a local Meilisearch with a stand-in embedder: no paid service is called. Run it
 * with `SEARCH_ENGINE=meilisearch npm run test:search-embedder`; without it, the command checks Elasticsearch.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Meilisearch, MeilisearchApiError, type Task } from "meilisearch";

import { PLATFORM_SEARCH_EMBEDDER } from "../src/config/library-config/catalogs";
import type { MeilisearchService } from "../src/lib/meilisearch-factory";
import type { SearchEmbedderConfiguration } from "../src/lib/search-index/embedder-settings";
import { applySearchIndexEmbedder, meilisearchWriter } from "../src/lib/search-index/meilisearch-writer";

const meilisearchHost =
	process.env.MEILISEARCH_HOST ?? "http://127.0.0.1:57710";
const meilisearchKey = process.env.MEILISEARCH_KEY ?? "embedder-test-key";
// Host name the Meilisearch container uses to reach this process.
const stubHost = process.env.EMBEDDER_STUB_HOST ?? "host.docker.internal";
const DIMENSIONS = 8;
// Unique per run, so two verifier processes on one Meilisearch never delete
// each other's indexes, and a pre-existing index is never touched.
const RUN_ID = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const INDEX_NAMES = [`embedder-a-${RUN_ID}`, `embedder-b-${RUN_ID}`] as const;

type StubState = { requests: number; texts: string[] };

function vectorFor(text: string) {
	// Deterministic, non-zero, different per text.
	return Array.from({ length: DIMENSIONS }, (_, index) => {
		let hash = index + 1;
		for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 997;
		return (hash + 1) / 1000;
	});
}

function startStub(
	state: StubState,
): Promise<{ server: Server; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => (body += chunk));
			request.on("end", () => {
				const payload = JSON.parse(body || "{}") as { input?: unknown };
				const inputs = Array.isArray(payload.input)
					? (payload.input as string[])
					: [String(payload.input ?? "")];
				state.requests += 1;
				state.texts.push(...inputs);
				response.setHeader("content-type", "application/json");
				response.end(
					JSON.stringify({
						data: inputs.map((text) => ({
							embedding: vectorFor(text),
						})),
					}),
				);
			});
		});
		server.listen(0, "0.0.0.0", () => {
			resolve({ server, port: (server.address() as AddressInfo).port });
		});
	});
}

function service(client: Meilisearch, indexName: string): MeilisearchService {
	return {
		client,
		index: client.index(indexName),
		indexName,
	};
}

const SETUP_TASK_TIMEOUT_MS = 5 * 60 * 1_000;

async function successfulTask(taskPromise: {
	waitTask: (options?: { timeout?: number }) => Promise<Task>;
}) {
	// A freshly started container can take tens of seconds for its first writes.
	const task = await taskPromise.waitTask({ timeout: SETUP_TASK_TIMEOUT_MS });
	assert(
		task.status === "succeeded",
		`Meilisearch task ${task.uid} failed: ${task.error?.message}`,
	);
	return task;
}

async function deleteIndexIfPresent(client: Meilisearch, indexName: string) {
	try {
		await client.getRawIndex(indexName);
		await successfulTask(client.deleteIndex(indexName));
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

function documents(indexName: string) {
	return [
		{
			key: `${indexName}-1`,
			title: "Mobile phones and literacy in rural schools",
			abstractNote: "A study of reading gains when pupils use phones.",
			fullNames: ["Amina Okafor", "Luis Perez"],
			tags: ["literacy", "mobile learning"],
			year: 2021,
			itemType: "journalArticle",
			deleted: 0,
		},
		{
			key: `${indexName}-2`,
			title: "Teacher coaching at scale",
			abstractNote: "Coaching visits improved lesson quality.",
			fullNames: ["Grace Mwangi"],
			tags: ["teachers", "coaching"],
			year: 2020,
			itemType: "report",
			deleted: 0,
		},
		{
			key: `${indexName}-3`,
			title: "Radio lessons during school closures",
			fullNames: ["Sam Osei"],
			tags: ["radio", "emergencies"],
			year: 2022,
			itemType: "report",
			deleted: 0,
		},
		{
			key: `${indexName}-4`,
			title: "Cost of tablets per pupil",
			abstractNote: "Unit costs across four countries.",
			fullNames: ["Ana Silva"],
			tags: ["cost", "tablets"],
			year: 2019,
			itemType: "journalArticle",
			deleted: 0,
		},
		{
			key: `${indexName}-5`,
			title: "Girls' education and distance learning",
			abstractNote: "Access gaps widened for girls.",
			fullNames: ["Fatima Noor"],
			tags: ["gender", "distance learning"],
			year: 2021,
			itemType: "journalArticle",
			deleted: 0,
		},
		{
			// The live compose-e2e library held an untitled ComputerProgram.
			// Meilisearch fails the whole embedding task when the template
			// reads a field the document does not have.
			key: `${indexName}-6`,
			fullNames: [],
			tags: [],
			itemType: "computerProgram",
			deleted: 0,
		},
	];
}

async function stats(client: Meilisearch, indexName: string) {
	const raw = (await client.index(indexName).getStats()) as {
		numberOfDocuments: number;
		numberOfEmbeddedDocuments?: number | null;
		numberOfEmbeddings?: number | null;
	};
	return raw;
}

function restEmbedder(
	port: number,
	variant: "v1" | "v2",
): SearchEmbedderConfiguration {
	return {
		source: "rest",
		url: `http://${stubHost}:${port}/embed`,
		dimensions: DIMENSIONS,
		request:
			variant === "v1"
				? { input: "{{text}}" }
				: { input: "{{text}}", version: "2" },
		response: { data: [{ embedding: "{{embedding}}" }] },
		headers: { "X-Embedder-Variant": variant },
	};
}

function step(
	name: string,
	indexName: string,
	extra: Record<string, unknown> = {},
) {
	console.log(JSON.stringify({ step: name, index: indexName, ...extra }));
}

async function expectEmbedded(client: Meilisearch, indexName: string) {
	const current = await stats(client, indexName);
	assert.equal(
		current.numberOfEmbeddedDocuments,
		current.numberOfDocuments,
		`${indexName}: ${current.numberOfEmbeddedDocuments} embedded of ${current.numberOfDocuments}`,
	);
	return current;
}

async function hybridSearch(client: Meilisearch, indexName: string) {
	return client.index(indexName).search("phones in schools", {
		hybrid: { embedder: PLATFORM_SEARCH_EMBEDDER, semanticRatio: 0.7 },
		limit: 6,
	});
}

async function runIndex(
	client: Meilisearch,
	indexName: string,
	port: number,
	stub: StubState,
) {
	const target = service(client, indexName);
	await deleteIndexIfPresent(client, indexName);
	await meilisearchWriter(target, { taskTimeoutMs: 60_000 }).ensure({});
	await successfulTask(target.index.addDocuments(documents(indexName)));

	// 1. Enable
	const before = stub.requests;
	await applySearchIndexEmbedder(target, restEmbedder(port, "v1"));
	const embedders = await target.index.getEmbedders();
	assert.deepEqual(Object.keys(embedders ?? {}), [PLATFORM_SEARCH_EMBEDDER]);
	const enabled = await expectEmbedded(client, indexName);
	assert(stub.requests > before, "stub was not called on enable");
	step("enable", indexName, {
		embedded: enabled.numberOfEmbeddedDocuments,
		documents: enabled.numberOfDocuments,
	});

	// 2. Search
	const hits = await hybridSearch(client, indexName);
	assert(hits.hits.length > 0, "hybrid search returned no hits");
	step("search", indexName, { hits: hits.hits.length });

	// 3. Change
	const beforeChange = stub.requests;
	await applySearchIndexEmbedder(target, restEmbedder(port, "v2"));
	await expectEmbedded(client, indexName);
	assert(stub.requests > beforeChange, "stub was not called after change");
	step("change", indexName, { requests: stub.requests - beforeChange });

	// 4. Disable
	await applySearchIndexEmbedder(target, null);
	assert.deepEqual(await target.index.getEmbedders(), {});
	let disabledCode: string | undefined;
	try {
		await hybridSearch(client, indexName);
	} catch (error) {
		if (error instanceof MeilisearchApiError)
			disabledCode = error.cause?.code;
		else throw error;
	}
	assert.equal(disabledCode, "invalid_search_embedder");
	step("disable", indexName, { searchError: disabledCode });

	// 5. Rebuild
	await applySearchIndexEmbedder(target, restEmbedder(port, "v1"));
	await successfulTask(target.index.deleteAllDocuments());
	await successfulTask(target.index.addDocuments(documents(indexName)));
	const rebuilt = await expectEmbedded(client, indexName);
	const afterRebuild = await hybridSearch(client, indexName);
	assert(
		afterRebuild.hits.length > 0,
		"hybrid search after rebuild returned no hits",
	);
	step("rebuild", indexName, {
		embedded: rebuilt.numberOfEmbeddedDocuments,
		documents: rebuilt.numberOfDocuments,
		hits: afterRebuild.hits.length,
	});
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The script creates and deletes its own indexes on whatever Meilisearch it is
 * pointed at. Only allow that on a local instance unless the caller opts in
 * with EMBEDDER_TEST_ALLOW_REMOTE=1.
 */
function assertSafeMeilisearchHost(host: string) {
	if (process.env.EMBEDDER_TEST_ALLOW_REMOTE === "1") return;
	const hostname = new URL(host).hostname;
	assert(
		LOOPBACK_HOSTS.has(hostname),
		`Refusing to run against ${host}: MEILISEARCH_HOST must be a local Meilisearch. Set EMBEDDER_TEST_ALLOW_REMOTE=1 to override.`,
	);
}

async function main() {
	assertSafeMeilisearchHost(meilisearchHost);
	const stub: StubState = { requests: 0, texts: [] };
	const { server, port } = await startStub(stub);
	console.log(
		JSON.stringify({
			stub: `http://${stubHost}:${port}/embed`,
			meilisearchHost,
		}),
	);
	const client = new Meilisearch({
		apiKey: meilisearchKey,
		host: meilisearchHost,
	});
	try {
		for (const indexName of INDEX_NAMES) {
			await runIndex(client, indexName, port, stub);
		}
		assert(
			stub.texts.some((text) =>
				text.includes("Mobile phones and literacy"),
			),
			"the platform template did not send the record title",
		);
		console.log(
			JSON.stringify({
				ok: true,
				stubRequests: stub.requests,
				indexes: INDEX_NAMES,
			}),
		);
	} finally {
		try {
			for (const indexName of INDEX_NAMES) {
				await deleteIndexIfPresent(client, indexName);
			}
		} catch (cleanupError) {
			// Report cleanup trouble without hiding the real failure.
			console.error(
				`Index cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
			);
		} finally {
			server.close();
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
