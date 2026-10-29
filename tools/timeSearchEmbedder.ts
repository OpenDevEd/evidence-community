/**
 * Times the library's embedder on the library's own records (OpenDevEd/new-el#720): records a second at each number of
 * requests in flight, sent in the pages the worker's backfill sends, and how long all the library's records would
 * take. It also reports what the worker spends: the answers' statuses and time, CPU, bytes received, and the CPU and
 * bytes of writing the vectors out for Elasticsearch. It reads records from the library's Elasticsearch and writes
 * nothing, but a paid embedder charges for what it embeds. Each setting embeds its own share of the records, chosen at
 * random.
 *
 *   LIBRARY_CONFIG_PATH=… npm run search:embedder-speed -- --records 10000 --parallel 8,16,32 [--batch 100]
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { libraryConfigSchema, type LibraryServerConfig } from "../src/config/library-config/schema";
import { RevisionAwareSearchFactory } from "../src/lib/elasticsearch-factory";
import { createEmbedder, MOST_BATCH_TEXTS, MOST_PARALLEL_REQUESTS } from "../src/lib/embedder";
import { missingPage } from "../src/lib/search-index/elasticsearch-embeddings";
import { embeddingText } from "../src/lib/search-index/embedder-settings";

const TEXT_FIELDS = ["title", "abstractNote", "fullNames", "tags", "year"];
/** Elasticsearch answers at most this many records at once. */
const MOST_RECORDS = 10_000;
/** Records a bulk write of vectors holds in the worker's backfill. */
const WRITE_RECORDS = 500;

function wholeNumberIn(value: number, lowest: number, highest: number) {
	return Number.isSafeInteger(value) && value >= lowest && value <= highest;
}

function batchSetting(value: string | undefined) {
	if (value === undefined) return undefined;
	if (!wholeNumberIn(Number(value), 1, MOST_BATCH_TEXTS)) throw new Error(`--batch takes a number from 1 to ${MOST_BATCH_TEXTS}.`);
	return Number(value);
}

function settings() {
	const { values } = parseArgs({ options: { records: { type: "string", default: "1000" }, parallel: { type: "string", default: "8" }, batch: { type: "string" } } });
	const records = Number(values.records);
	const parallel = values.parallel.split(",").map(Number);
	if (!wholeNumberIn(records, 1, MOST_RECORDS)) throw new Error(`--records must be 1 to ${MOST_RECORDS}.`);
	if (!parallel.every((value) => wholeNumberIn(value, 1, MOST_PARALLEL_REQUESTS))) throw new Error(`--parallel takes numbers from 1 to ${MOST_PARALLEL_REQUESTS}, such as 8,16,32.`);
	return { records, parallel, batchTexts: batchSetting(values.batch) };
}

/** The library's configuration from `LIBRARY_CONFIG_PATH`, which must have an embedder. */
async function libraryWithEmbedder() {
	const configPath = process.env.LIBRARY_CONFIG_PATH;
	if (!configPath) throw new Error("LIBRARY_CONFIG_PATH is required");
	const config = libraryConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
	if (!config.search.embedder) throw new Error("This library has no embedder.");
	return config;
}

/** `count` records' embedding texts, chosen at random, and how many records the library has. */
async function libraryTexts(config: LibraryServerConfig, count: number) {
	const connection = config.services.search.elasticsearch;
	if (!connection) throw new Error("This library has no Elasticsearch connection.");
	const { alias, client } = await new RevisionAwareSearchFactory().get({ configuration: connection, revision: config.revision, updatedAt: config.updatedAt });
	const [{ count: total }, sample] = await Promise.all([
		client.count({ index: alias }),
		client.search<Record<string, unknown>>({
			index: alias,
			size: count,
			query: { function_score: { functions: [{ random_score: { seed: 7, field: "_seq_no" } }] } },
			_source: TEXT_FIELDS,
		}),
	]);
	await client.close();
	return { total, texts: sample.hits.hits.map((hit) => embeddingText(hit._source ?? {})) };
}

/** The embedder's requests, counted as they are answered: how many, by status, and seconds until each answered. */
const answers = { byStatus: {} as Record<string, number>, seconds: 0 };
const sendRequest = globalThis.fetch;
globalThis.fetch = async (...request: Parameters<typeof fetch>) => {
	const started = performance.now();
	const response = await sendRequest(...request).catch((error: unknown) => {
		answers.byStatus["no answer"] = (answers.byStatus["no answer"] ?? 0) + 1;
		throw error;
	});
	answers.seconds += (performance.now() - started) / 1_000;
	answers.byStatus[response.status] = (answers.byStatus[response.status] ?? 0) + 1;
	return response;
};

/** Bytes this process has read, sockets included (Linux only): what the embedder's answers cost on the network. */
async function bytesRead() {
	const io = await readFile("/proc/self/io", "utf8").catch(() => "");
	const match = /^rchar: (\d+)$/m.exec(io);
	return match ? Number(match[1]) : null;
}

/** The CPU seconds and bytes of turning the vectors into the backfill's bulk writes, 500 records a request. */
function writeCost(vectors: ReadonlyArray<number[] | null>) {
	const started = process.cpuUsage();
	let bytes = 0;
	for (let start = 0; start < vectors.length; start += WRITE_RECORDS) {
		bytes += Buffer.byteLength(JSON.stringify(vectors.slice(start, start + WRITE_RECORDS).map((embedding) => ({ doc: { embedding } }))));
	}
	const { user, system } = process.cpuUsage(started);
	return { cpuSeconds: (user + system) / 1e6, bytes };
}

/** Embeds `texts` page by page, printing progress after each page; returns the vectors and the seconds it took. */
async function embedPages(embedder: NonNullable<ReturnType<typeof createEmbedder>>, label: string, texts: readonly string[]) {
	const page = missingPage(embedder);
	const started = performance.now();
	const vectors: Array<number[] | null> = [];
	for (let start = 0; start < texts.length; start += page) {
		vectors.push(...(await embedder.embed(texts.slice(start, start + page))));
		const rate = vectors.length / ((performance.now() - started) / 1_000);
		console.log(`${label}: ${vectors.length.toLocaleString("en")} of ${texts.length.toLocaleString("en")} records, ${rate.toFixed(1)} a second, ${Math.round((texts.length - vectors.length) / rate)} s left`);
	}
	return { page, vectors, seconds: (performance.now() - started) / 1_000 };
}

const perThousand = (value: number, records: number) => Number(((value * 1_000) / records).toFixed(3));

/** One setting's speed, and what the worker spent on it. */
async function timeSetting(config: LibraryServerConfig, parallelRequests: number, batchTexts: number | undefined, texts: readonly string[]) {
	const embedder = createEmbedder(config.search.embedder, { parallelRequests, batchTexts })!;
	const label = `${parallelRequests} in flight, ${embedder.capacity / parallelRequests} texts a request`;
	answers.byStatus = {};
	answers.seconds = 0;
	const [readBefore, cpuBefore] = [await bytesRead(), process.cpuUsage()];
	const { page, vectors, seconds } = await embedPages(embedder, label, texts);
	const { user, system } = process.cpuUsage(cpuBefore);
	const readAfter = await bytesRead();
	const requests = Object.values(answers.byStatus).reduce((sum, count) => sum + count, 0);
	const write = writeCost(vectors);
	return {
		parallelRequests,
		textsPerRequest: Number((texts.length / (answers.byStatus[200] ?? requests)).toFixed(1)),
		pageRecords: page,
		records: texts.length,
		refused: vectors.filter((vector) => vector === null).length,
		seconds: Number(seconds.toFixed(1)),
		recordsPerSecond: Number((texts.length / seconds).toFixed(1)),
		answers: answers.byStatus,
		secondsPerRequest: Number((answers.seconds / requests).toFixed(2)),
		workerCpuSecondsPer1000Records: perThousand((user + system) / 1e6, texts.length),
		workerCores: Number(((user + system) / 1e6 / seconds).toFixed(2)),
		receivedKBPerRecord: readBefore === null || readAfter === null ? null : Number(((readAfter - readBefore) / texts.length / 1_024).toFixed(1)),
		writeCpuSecondsPer1000Records: perThousand(write.cpuSeconds, texts.length),
		writeKBPerRecord: Number((write.bytes / texts.length / 1_024).toFixed(1)),
	};
}

/** One setting's timing, with how long the whole library would take, or why it failed. */
function timed(config: LibraryServerConfig, parallelRequests: number, batchTexts: number | undefined, texts: readonly string[], total: number) {
	return timeSetting(config, parallelRequests, batchTexts, texts).then(
		(result) => ({ ...result, wholeLibraryMinutes: Number((total / result.recordsPerSecond / 60).toFixed(1)) }),
		(error: unknown) => ({ parallelRequests, batchTexts, answers: { ...answers.byStatus }, failed: error instanceof Error ? error.message : String(error) }),
	);
}

async function main() {
	const { records, parallel, batchTexts } = settings();
	const config = await libraryWithEmbedder();
	const { total, texts } = await libraryTexts(config, records);
	const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
	console.log(`${texts.length.toLocaleString("en")} of ${total.toLocaleString("en")} records, ${Math.round(bytes / texts.length)} bytes of text on average`);
	const share = Math.ceil(texts.length / parallel.length);
	const results = [];
	for (const [index, requests] of parallel.entries()) {
		results.push(await timed(config, requests, batchTexts, texts.slice(index * share, (index + 1) * share), total));
	}
	console.log(JSON.stringify({ libraryRecords: total, meanTextBytes: Math.round(bytes / texts.length), results }, null, 1));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
