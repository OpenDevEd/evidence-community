/**
 * Times the library's embedder on the library's own records (OpenDevEd/new-el#720): records a second at each number of
 * requests in flight, sent in the pages the worker's backfill sends, and how long all the library's records would
 * take. It reads records from the library's Elasticsearch and writes nothing, but a paid embedder charges for what
 * it embeds. Each setting embeds its own share of the records, chosen at random.
 *
 *   LIBRARY_CONFIG_PATH=… npm run search:embedder-speed -- --records 10000 --parallel 8,16,32
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { libraryConfigSchema, type LibraryServerConfig } from "../src/config/library-config/schema";
import { RevisionAwareSearchFactory } from "../src/lib/elasticsearch-factory";
import { createEmbedder, MOST_PARALLEL_REQUESTS } from "../src/lib/embedder";
import { missingPage } from "../src/lib/search-index/elasticsearch-embeddings";
import { embeddingText } from "../src/lib/search-index/embedder-settings";

const TEXT_FIELDS = ["title", "abstractNote", "fullNames", "tags", "year"];
/** Elasticsearch answers at most this many records at once. */
const MOST_RECORDS = 10_000;

function wholeNumberIn(value: number, lowest: number, highest: number) {
	return Number.isSafeInteger(value) && value >= lowest && value <= highest;
}

function settings() {
	const { values } = parseArgs({ options: { records: { type: "string", default: "1000" }, parallel: { type: "string", default: "8" } } });
	const records = Number(values.records);
	const parallel = values.parallel.split(",").map(Number);
	if (!wholeNumberIn(records, 1, MOST_RECORDS)) throw new Error(`--records must be 1 to ${MOST_RECORDS}.`);
	if (!parallel.every((value) => wholeNumberIn(value, 1, MOST_PARALLEL_REQUESTS))) throw new Error(`--parallel takes numbers from 1 to ${MOST_PARALLEL_REQUESTS}, such as 8,16,32.`);
	return { records, parallel };
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

/** Embeds `texts` page by page with `parallelRequests` requests in flight, printing progress after each page. */
async function timeSetting(config: LibraryServerConfig, parallelRequests: number, texts: readonly string[]) {
	const embedder = createEmbedder(config.search.embedder, { parallelRequests })!;
	const page = missingPage(embedder);
	const started = performance.now();
	let embedded = 0;
	let refused = 0;
	for (let start = 0; start < texts.length; start += page) {
		const vectors = await embedder.embed(texts.slice(start, start + page));
		embedded += vectors.length;
		refused += vectors.filter((vector) => vector === null).length;
		const rate = embedded / ((performance.now() - started) / 1_000);
		console.log(`${parallelRequests} in flight: ${embedded.toLocaleString("en")} of ${texts.length.toLocaleString("en")} records, ${rate.toFixed(1)} a second, ${Math.round((texts.length - embedded) / rate)} s left`);
	}
	const seconds = (performance.now() - started) / 1_000;
	return { parallelRequests, pageRecords: page, records: texts.length, refused, seconds: Number(seconds.toFixed(1)), recordsPerSecond: Number((texts.length / seconds).toFixed(1)) };
}

/** One setting's timing, with how long the whole library would take, or why it failed. */
function timed(config: LibraryServerConfig, parallelRequests: number, texts: readonly string[], total: number) {
	return timeSetting(config, parallelRequests, texts).then(
		(result) => ({ ...result, wholeLibraryMinutes: Math.round(total / result.recordsPerSecond / 60) }),
		(error: unknown) => ({ parallelRequests, failed: error instanceof Error ? error.message : String(error) }),
	);
}

async function main() {
	const { records, parallel } = settings();
	const config = await libraryWithEmbedder();
	const { total, texts } = await libraryTexts(config, records);
	const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
	console.log(`${texts.length.toLocaleString("en")} of ${total.toLocaleString("en")} records, ${Math.round(bytes / texts.length)} bytes of text on average`);
	const share = Math.ceil(texts.length / parallel.length);
	const results = [];
	for (const [index, requests] of parallel.entries()) {
		results.push(await timed(config, requests, texts.slice(index * share, (index + 1) * share), total));
	}
	console.log(JSON.stringify({ libraryRecords: total, meanTextBytes: Math.round(bytes / texts.length), results }, null, 1));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
