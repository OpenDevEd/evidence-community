/**
 * Loads one library's real records into Elasticsearch and compares an engine's results for a fixed set of reader
 * searches with the ones Meilisearch gave before EL-32 (OpenDevEd/new-el#717, #721, #722). `compare` searches through
 * the runtime's own engine adapter, Elasticsearch's by default or Meilisearch's with `--engine meilisearch`.
 *
 *   npm run search:compare -- export --out aied.ndjson
 *   npm run search:compare -- load-elasticsearch --in aied.ndjson --url http://127.0.0.1:9200 --index aied
 *   npm run search:compare -- compare --baseline tools/search-comparison/aied-meilisearch-baseline.json \
 *     --url http://127.0.0.1:9200 --index aied --out aied-comparison.json [--engine meilisearch --key <key>]
 *
 * `export` and `compare` read the library configuration from LIBRARY_CONFIG_PATH: its database and the search
 * settings a reader's search goes through. Each command prints one JSON summary.
 */
import { createReadStream, createWriteStream, readFileSync, writeFileSync, type WriteStream } from "node:fs";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { openLibraryConfigProcess, openLibraryDatabaseProcess } from "../src/config/library-config/process";
import { resolveSearchRequest } from "../src/lib/search";
import { searchIndexDefinition } from "../src/lib/search-index/elasticsearch-index";
import { generateFullSearchProjectionPlans } from "../src/lib/search-index/projection";
import { Client } from "@elastic/elasticsearch";
import { Meilisearch } from "meilisearch";

import type { SearchEngine } from "../src/lib/search-engine";
import { elasticsearchEngine } from "../src/lib/search-engines/elasticsearch";
import { meilisearchEngine } from "../src/lib/search-engines/meilisearch";

const BATCH_BYTES = 20 * 1024 * 1024;
const ELASTICSEARCH_BULKS_IN_FLIGHT = 4;
const RESULTS = 20;
const TIMED_RUNS = 5;

type EngineResult = { keys: string[]; total: number | undefined; p50: number; p95: number };
type BaselineQuery = EngineResult & { id: string; params: Record<string, unknown> };
type ComparisonResult = {
	id: string;
	params: Record<string, unknown>;
	/** What Meilisearch answered before EL-32. */
	baseline: EngineResult;
	/** What the engine under test answers now. */
	candidate: EngineResult | { error: string };
	overlapAt10: number | null;
	overlapAt20: number | null;
};

function seconds(since: number) {
	return Math.round((performance.now() - since) / 100) / 10;
}

function percentile(values: number[], fraction: number) {
	const sorted = [...values].sort((left, right) => left - right);
	return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]! * 10) / 10;
}

/**
 * An export's lines. Only `\n` ends one: readline also splits on U+2028 and U+2029, which JSON.stringify leaves
 * unescaped and some PDF text holds.
 */
async function* exportLines(file: string) {
	let rest = "";
	for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
		const lines = (rest + chunk).split("\n");
		rest = lines.pop()!;
		yield* lines;
	}
	if (rest) yield rest;
}

/** An export's documents, in batches of about `BATCH_BYTES` once serialised. */
async function* documentBatches(file: string) {
	let batch: string[] = [];
	let bytes = 0;
	for await (const line of exportLines(file)) {
		batch.push(line);
		bytes += line.length + 1;
		if (bytes >= BATCH_BYTES) {
			yield batch;
			batch = [];
			bytes = 0;
		}
	}
	if (batch.length) yield batch;
}

async function writeDocuments(output: WriteStream, documents: readonly object[]) {
	let bytes = 0;
	for (const document of documents) {
		const line = `${JSON.stringify(document)}\n`;
		bytes += Buffer.byteLength(line);
		if (!output.write(line)) await once(output, "drain");
	}
	return bytes;
}

async function exportDocuments(values: Arguments) {
	const { config, databaseResource, close } = await openLibraryDatabaseProcess({ maxConnections: 4 });
	const started = performance.now();
	const output = createWriteStream(required(values, "out"));
	let documents = 0;
	let bytes = 0;
	try {
		for await (const plan of generateFullSearchProjectionPlans(databaseResource.database, config, 500)) {
			bytes += await writeDocuments(output, plan.documents);
			documents += plan.documents.length;
		}
	} finally {
		output.end();
		await once(output, "finish");
		await close();
	}
	return { documents, megabytes: Math.round(bytes / 1_048_576), seconds: seconds(started) };
}

/** One request to Elasticsearch, without a client: the measurement runs before the runtime uses one. */
async function elasticsearch(url: string, method: string, path: string, body?: string) {
	const response = await fetch(new URL(path, url), {
		method,
		headers: { "content-type": path.endsWith("/_bulk") ? "application/x-ndjson" : "application/json" },
		body,
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Elasticsearch ${method} ${path} answered ${response.status}: ${text.slice(0, 2_000)}`);
	return JSON.parse(text || "null");
}

function bulkBody(batch: readonly string[]) {
	return batch.map((line) => `${JSON.stringify({ index: { _id: (JSON.parse(line) as { key: string }).key } })}\n${line}\n`).join("");
}

function keepFailures(result: { items: Array<{ index: { error?: unknown } }> }, failures: string[]) {
	const errors = result.items.flatMap((item) => (item.index.error ? [JSON.stringify(item.index.error).slice(0, 400)] : []));
	failures.push(...errors.slice(0, Math.max(0, 20 - failures.length)));
}

async function indexStats(url: string, index: string) {
	const [stats] = await elasticsearch(url, "GET", `/_cat/indices/${index}?format=json&bytes=b`);
	const nodes = await elasticsearch(url, "GET", "/_nodes/stats/jvm");
	const heap = Object.values(nodes.nodes as Record<string, { jvm: { mem: { heap_used_in_bytes: number } } }>)[0]!;
	return {
		indexed: Number(stats["docs.count"]),
		indexMegabytes: Math.round(Number(stats["store.size"]) / 1_048_576),
		heapUsedMegabytes: Math.round(heap.jvm.mem.heap_used_in_bytes / 1_048_576),
	};
}

async function loadElasticsearch(values: Arguments) {
	const [file, url, index] = [required(values, "in"), required(values, "url"), required(values, "index")];
	await fetch(new URL(`/${index}`, url), { method: "DELETE" });
	const { settings, mappings } = searchIndexDefinition();
	await elasticsearch(url, "PUT", `/${index}`, JSON.stringify({ settings: { ...settings, index: { ...settings.index, refresh_interval: "-1" } }, mappings }));
	const started = performance.now();
	let documents = 0;
	const failures: string[] = [];
	const inFlight = new Set<Promise<void>>();
	for await (const batch of documentBatches(file)) {
		const request = elasticsearch(url, "POST", `/${index}/_bulk`, bulkBody(batch)).then((result) => keepFailures(result, failures));
		const tracked = request.finally(() => inFlight.delete(tracked));
		inFlight.add(tracked);
		documents += batch.length;
		if (inFlight.size >= ELASTICSEARCH_BULKS_IN_FLIGHT) await Promise.race(inFlight);
	}
	await Promise.all(inFlight);
	await elasticsearch(url, "PUT", `/${index}/_settings`, JSON.stringify({ index: { refresh_interval: "1s" } }));
	await elasticsearch(url, "POST", `/${index}/_refresh`);
	const loadSeconds = seconds(started);
	return { documents, failures, seconds: loadSeconds, perSecond: Math.round(documents / loadSeconds), ...(await indexStats(url, index)) };
}

async function timed<T>(run: () => Promise<T>) {
	await run();
	const latencies: number[] = [];
	let result!: T;
	for (let attempt = 0; attempt < TIMED_RUNS; attempt += 1) {
		const started = performance.now();
		result = await run();
		latencies.push(performance.now() - started);
	}
	return { result, p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) };
}

function overlap(left: readonly string[], right: readonly string[], depth: number) {
	const expected = new Set(left.slice(0, depth));
	if (!expected.size) return right.length ? 0 : 1;
	return Math.round((right.slice(0, depth).filter((key) => expected.has(key)).length / expected.size) * 100) / 100;
}

type SearchRequest = ReturnType<typeof resolveSearchRequest>;

function engineOf(values: Arguments): SearchEngine {
	const [url, index] = [required(values, "url"), required(values, "index")];
	if (values.engine === "meilisearch") {
		const client = new Meilisearch({ host: url, apiKey: values.key });
		return meilisearchEngine({ client, index: client.index(index), indexName: index });
	}
	return elasticsearchEngine({ alias: index, client: new Client({ node: url }) });
}

/** The search the library's public results page sends, as `src/lib/search.ts` builds it, keys only. */
async function engineResult(engine: SearchEngine, request: SearchRequest): Promise<EngineResult | { error: string }> {
	try {
		const measured = await timed(() =>
			engine.search<{ key: string }>({
				text: request.search,
				fields: request.attributesToSearchOn,
				filters: request.finalFilters,
				sort: request.sortOption,
				size: request.limitNum,
				from: (request.pageNum - 1) * request.limitNum,
				returned: { only: ["key"] },
			}),
		);
		return { keys: measured.result.hits.map((hit) => String(hit.key)), total: measured.result.total, p50: measured.p50, p95: measured.p95 };
	} catch (error) {
		return { error: error instanceof Error ? error.message.slice(0, 500) : String(error) };
	}
}

function engineLatency(results: readonly ComparisonResult[], side: "baseline" | "candidate", field: "p50" | "p95") {
	return percentile(results.flatMap((result) => ("keys" in result[side] ? [(result[side] as EngineResult)[field]] : [])), 0.5);
}

function summarise(results: readonly ComparisonResult[], out: string) {
	const answered = results.filter((result) => result.overlapAt10 !== null);
	return {
		queries: results.length,
		errors: results.length - answered.length,
		medianOverlapAt10: percentile(answered.map((result) => result.overlapAt10!), 0.5),
		queriesUnderHalfOverlap: answered.filter((result) => result.overlapAt10! < 0.5).map((result) => result.id),
		medianLatencyMs: {
			baseline: { p50: engineLatency(results, "baseline", "p50"), p95: engineLatency(results, "baseline", "p95") },
			candidate: { p50: engineLatency(results, "candidate", "p50"), p95: engineLatency(results, "candidate", "p95") },
		},
		out,
	};
}

async function compareQuery(baseline: EngineResult, request: SearchRequest, engine: SearchEngine) {
	const candidate = await engineResult(engine, request);
	const keys = "keys" in candidate ? candidate.keys : null;
	return {
		baseline,
		candidate,
		overlapAt10: keys && overlap(baseline.keys, keys, 10),
		overlapAt20: keys && overlap(baseline.keys, keys, 20),
	};
}

async function compare(values: Arguments) {
	const out = required(values, "out");
	const engine = engineOf(values);
	const configProcess = await openLibraryConfigProcess();
	try {
		const results: ComparisonResult[] = [];
		for (const { id, params, ...baseline } of JSON.parse(readFileSync(required(values, "baseline"), "utf8")) as BaselineQuery[]) {
			const request = resolveSearchRequest(params, configProcess.config, [], RESULTS);
			results.push({ id, params, ...(await compareQuery(baseline, request, engine)) });
		}
		writeFileSync(out, `${JSON.stringify(results, null, "\t")}\n`);
		return { engine: engine.name, ...summarise(results, out) };
	} finally {
		configProcess.close();
	}
}

const USAGE = "Usage: npm run search:compare -- export --out <file> | load-elasticsearch --in <file> --url <url> --index <name> | compare --baseline <file> --url <url> --index <name> --out <file> [--engine meilisearch --key <key>]";

type Arguments = Partial<Record<"in" | "out" | "url" | "index" | "baseline" | "engine" | "key", string>>;

function required(values: Arguments, name: keyof Arguments) {
	const value = values[name];
	if (!value) throw new Error(USAGE);
	return value;
}

const COMMANDS: Record<string, (values: Arguments) => Promise<object>> = {
	export: exportDocuments,
	"load-elasticsearch": loadElasticsearch,
	compare,
};

async function main() {
	const [command = "", ...rest] = process.argv.slice(2);
	const run = COMMANDS[command];
	if (!run) throw new Error(USAGE);
	const { values } = parseArgs({
		args: rest,
		options: { in: { type: "string" }, out: { type: "string" }, url: { type: "string" }, index: { type: "string" }, baseline: { type: "string" }, engine: { type: "string" }, key: { type: "string" } },
	});
	console.log(JSON.stringify(await run(values)));
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
