/**
 * Checks records' vectors and search by meaning on a real Elasticsearch (OpenDevEd/new-el#720), with a local embedder
 * standing in for the library's: no paid service is called. It writes a test library's records with vectors, searches
 * them by meaning and from a record, changes a record, rebuilds reusing vectors, recovers from a failing embedder,
 * changes the embedder, backfills 1,204 records at 128 requests in flight, and turns it off. Its indexes are deleted
 * at the end.
 *
 *   ELASTICSEARCH_URL=http://127.0.0.1:59200 ELASTICSEARCH_PASSWORD=… npm run test:search-embedder
 *
 * `SEARCH_ENGINE=meilisearch` checks Meilisearch's own embedder instead (`verifySearchEmbedder.ts`).
 */
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@elastic/elasticsearch";

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { SearchService } from "../src/lib/elasticsearch-factory";
import { createEmbedder, MOST_PARALLEL_REQUESTS } from "../src/lib/embedder";
import { SearchMeaningUnavailableError } from "../src/lib/search-engine";
import { elasticsearchEngine } from "../src/lib/search-engines/elasticsearch";
import { elasticsearchEmbeddings } from "../src/lib/search-index/elasticsearch-embeddings";
import { elasticsearchWriter } from "../src/lib/search-index/elasticsearch-writer";
import type { ItemSearchDocument, SearchProjectionPlan } from "../src/lib/search-index/projection";

const alias = `search_embedder_e2e_${process.pid}`;
const elasticsearchUrl = process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:59200";
const client = new Client({
	node: elasticsearchUrl,
	auth: { username: process.env.ELASTICSEARCH_USERNAME ?? "elastic", password: process.env.ELASTICSEARCH_PASSWORD ?? "local-search-password" },
});
const service: SearchService = { alias, client };
const writeOptions = { maxDocumentBatchBytes: 10 * 1024 * 1024, taskTimeoutMs: 60_000 };

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type StubState = { texts: number; failing: boolean; inFlight: number; mostInFlight: number };

/** Each word of the text adds 1 to one of `dimensions` numbers, so texts sharing words point the same way. */
function wordVector(text: string, dimensions: number) {
	const vector = new Array<number>(dimensions).fill(0);
	for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
		let hash = 0;
		for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % dimensions;
		vector[hash]! += 1;
	}
	return vector;
}

function answer(state: StubState, body: string, response: ServerResponse) {
	if (state.failing) {
		response.writeHead(401).end("key refused");
		return;
	}
	const { input, dimensions } = JSON.parse(body) as { input: string[]; dimensions: number };
	if (input.some((text) => text.includes("unembeddable"))) {
		response.writeHead(422).end("input refused");
		return;
	}
	state.texts += input.length;
	const data = input.map((text) => ({ embedding: wordVector(text, dimensions) }));
	response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data }));
}

/**
 * A stand-in embedder answering `wordVector`s. It counts the texts it embeds and the most requests in flight at once,
 * refuses its key while `failing`, and refuses a request holding a text with "unembeddable" in it, as a model refuses
 * a text too long for it.
 */
async function startEmbedder() {
	const state: StubState = { texts: 0, failing: false, inFlight: 0, mostInFlight: 0 };
	const server = createServer((request, response) => {
		state.inFlight += 1;
		state.mostInFlight = Math.max(state.mostInFlight, state.inFlight);
		response.on("close", () => (state.inFlight -= 1));
		let body = "";
		request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
		// Each answer takes 50 ms, as a service's would, so requests sent together are in flight together.
		request.on("end", () => setTimeout(() => answer(state, body, response), 50));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/embeddings`;
	return { state, url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function embedderConfig(url: string, dimensions: number): NonNullable<LibraryServerConfig["search"]["embedder"]> {
	return {
		source: "rest",
		url,
		dimensions,
		request: { model: "stand-in", dimensions, input: ["{{text}}", "{{..}}"] },
		response: { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
	};
}

function record(key: string, title: string, abstractNote: string): ItemSearchDocument {
	return {
		key,
		title,
		abstractNote,
		itemType: "journalArticle",
		collections: [],
		collectionsAncestry: [],
		deleted: 0,
		provider: "native",
		revision: 1,
		sourceConnectionKey: "native",
		sourceExternalScopeKey: null,
		sourceRecordKey: key,
		tags: [],
		topicAncestors: [],
		topics: [],
	};
}

const records = [
	record("RADIO001", "Radio lessons for rural schools", "Teachers broadcast lessons by radio to rural schools."),
	record("MOBILE01", "Mobile phones and literacy", "Text messages helped adults practise reading."),
	record("TUTOR001", "Intelligent tutoring for algebra", "A tutoring system adapts algebra problems to each student."),
	record("RURAL001", "Rural schools and radio broadcast", "Radio programmes reached schools far from towns."),
];

async function* plansOf(documents: readonly ItemSearchDocument[]): AsyncGenerator<SearchProjectionPlan> {
	yield { documents: [...documents], deleteKeys: [] };
}

/** The library's writer, vector step and search with this embedder, as a worker or page would make them. */
function library(configuration: LibraryServerConfig["search"]["embedder"], parallelRequests?: number) {
	const embedder = createEmbedder(configuration, { parallelRequests });
	const embeddings = embedder ? elasticsearchEmbeddings(service, embedder) : null;
	return { writer: elasticsearchWriter(service, embeddings), embeddings, engine: elasticsearchEngine(service, embedder) };
}

/** A rebuild, which reuses stored vectors only, then the worker's backfill; returns how many records it embedded. */
async function rebuild(configuration: LibraryServerConfig["search"]["embedder"], documents = records) {
	const { writer, embeddings } = library(configuration);
	await writer.rebuild(plansOf(documents), { ...writeOptions, reproject: () => plansOf([]) });
	return embeddings ? embeddings.embedMissing() : 0;
}

async function write(configuration: LibraryServerConfig["search"]["embedder"], documents: readonly ItemSearchDocument[]) {
	const batch = library(configuration).writer.batch(writeOptions);
	await batch.add({ documents: [...documents], deleteKeys: [] });
	await batch.finish();
}

async function withoutVectors() {
	await client.indices.refresh({ index: alias });
	return (await client.count({ index: alias, query: { bool: { must_not: [{ exists: { field: "embedding" } }] } } })).count;
}

async function vectorField() {
	const mappings = await client.indices.getMapping({ index: alias });
	const properties = Object.values(mappings)[0]!.mappings.properties as Record<string, { dims?: number; index_options?: { type: string } }>;
	return properties.embedding;
}

async function dimensions() {
	return (await vectorField())?.dims;
}

const searched = { fields: ["title", "abstractNote"], filters: [], returned: { only: ["key"] } };

async function keys(engine: ReturnType<typeof library>["engine"], request: { text: string; size: number; semantic: { ratio: number; like?: string } }) {
	// Similar records leave out the record they start from, as the Similar Resources route does.
	const like = request.semantic.like;
	const filters = like ? [{ not: { field: "key", equals: like } }] : [];
	return (await engine.search<{ key: string }>({ ...searched, filters, ...request })).hits.map((hit) => hit.key);
}

function step(name: string, detail: string) {
	console.log(`✓ ${name}: ${detail}`);
}

type Stub = Awaited<ReturnType<typeof startEmbedder>>;
type Configuration = LibraryServerConfig["search"]["embedder"];

async function turnOn(stub: Stub, enabled: Configuration) {
	const embedded = await rebuild(enabled);
	assert(stub.state.texts === 4 && embedded === 4, `Turning the embedder on embedded ${stub.state.texts} texts, not 4.`);
	assert((await vectorField())?.index_options?.type === "hnsw", "The vectors should be kept as unquantised floats (hnsw).");
	assert((await withoutVectors()) === 0, "A record has no vector after the embedder was turned on.");
	assert((await dimensions()) === 1_024, `The vectors have ${await dimensions()} dimensions, not 1,024.`);
	step("embedder on", "the rebuild wrote 4 records, the backfill embedded them: 1,024 unquantised float dimensions");
}

async function searchByMeaning(enabled: Configuration) {
	const byMeaning = await keys(library(enabled).engine, { text: "radio lessons", size: 4, semantic: { ratio: 1 } });
	assert(byMeaning.join(",").startsWith("RADIO001,RURAL001,") && byMeaning.length === 4, `Search by meaning answered ${byMeaning.join(", ")}.`);
	// AI search weighs words and meaning alike; "radio" alone matches two records by words.
	const asAiSearch = await keys(library(enabled).engine, { text: "radio lessons", size: 4, semantic: { ratio: 0.5 } });
	assert(asAiSearch[0] === "RADIO001" && asAiSearch.length === 4, `Words and meaning alike answered ${asAiSearch.join(", ")}.`);
	step("search by meaning", `${byMeaning.join(", ")}; with words alike ${asAiSearch.join(", ")}`);
}

async function searchFromRecord(enabled: Configuration) {
	const similar = await keys(library(enabled).engine, { text: "Radio lessons for rural schools", size: 3, semantic: { ratio: 0.7, like: "RADIO001" } });
	// RADIO001 itself is left out, as Similar Resources leaves it out.
	assert(similar[0] === "RURAL001" && similar.length === 3, `Records like RADIO001 were ${similar.join(", ")}.`);
	step("records like RADIO001", similar.join(", "));
}

async function changeRecord(stub: Stub, enabled: Configuration) {
	const before = stub.state.texts;
	await write(enabled, [record("RADIO001", "Radio lessons for rural schools, revised", records[0]!.abstractNote as string), records[1]!]);
	assert(stub.state.texts === before + 1, `Writing one changed and one unchanged record embedded ${stub.state.texts - before} texts, not 1.`);
	step("record changed", "only the changed record was embedded again");
}

async function rebuildReusing(stub: Stub, enabled: Configuration) {
	const before = stub.state.texts;
	const embedded = await rebuild(enabled);
	assert(embedded === 1 && stub.state.texts === before + 1, `The rebuild and backfill embedded ${stub.state.texts - before} texts, not just RADIO001's restored title.`);
	assert((await withoutVectors()) === 0, "A record lost its vector in the rebuild.");
	step("rebuild", "3 of 4 vectors reused from the old index; the backfill embedded the changed one");
}

async function recoverFromFailure(stub: Stub, enabled: Configuration) {
	stub.state.failing = true;
	const failing = library(enabled);
	const batch = failing.writer.batch(writeOptions);
	await batch.add({ documents: [record("MOBILE01", "Mobile phones and reading", records[1]!.abstractNote as string)], deleteKeys: [] });
	await batch.finish();
	assert((await withoutVectors()) === 1 && failing.embeddings?.lastError(), "A record written while the embedder failed should have no vector and a recorded error.");
	stub.state.failing = false;
	const embedded = await library(enabled).embeddings!.embedMissing();
	assert(embedded === 1 && (await withoutVectors()) === 0, `Once the embedder answered, ${embedded} record(s) got their vector, not 1.`);
	step("embedder failing", "the record was written without a vector, and got it once the embedder answered");
}

async function refusedText(stub: Stub, enabled: Configuration) {
	await write(enabled, [record("TUTOR001", "Intelligent tutoring for algebra, unembeddable", records[2]!.abstractNote as string), records[3]!]);
	const before = stub.state.texts;
	const embedded = await library(enabled).embeddings!.embedMissing();
	assert((await withoutVectors()) === 1 && embedded === 0 && stub.state.texts === before, "A text the embedder refused should stay without a vector and not be asked again.");
	await write(enabled, [records[2]!]);
	assert((await withoutVectors()) === 0, "Once its text changed, the refused record should get a vector.");
	step("text refused", "the record was marked and not asked again, and got a vector once its text changed");
}

async function changeEmbedder(stub: Stub) {
	const before = stub.state.texts;
	await rebuild(embedderConfig(stub.url, 512));
	assert(stub.state.texts === before + 4 && (await dimensions()) === 512, "Changing the embedder should embed every record again, at 512 dimensions.");
	step("embedder changed", "every record embedded again, 512 dimensions");
}

/** The backfill at the most requests in flight: one page of 1,204 records, its vectors written 500 a request. */
async function backfillAtMost(stub: Stub, enabled: Configuration) {
	const many = Array.from({ length: 1_200 }, (_, index) => record(`BULK${String(index).padStart(4, "0")}`, `School radio record ${index}`, "Lessons reached schools by radio."));
	const { writer, embeddings } = library(enabled, MOST_PARALLEL_REQUESTS);
	await writer.rebuild(plansOf([...records, ...many]), { ...writeOptions, reproject: () => plansOf([]) });
	const before = stub.state.texts;
	stub.state.mostInFlight = 0;
	const embedded = await embeddings!.embedMissing();
	assert(embedded === 1_204 && stub.state.texts === before + 1_204, `The backfill embedded ${stub.state.texts - before} texts and wrote ${embedded} vectors, not 1,204.`);
	assert((await withoutVectors()) === 0, "A record has no vector after the backfill at 128 requests in flight.");
	assert(stub.state.mostInFlight > 64, `Only ${stub.state.mostInFlight} requests were in flight at once, not up to ${MOST_PARALLEL_REQUESTS}.`);
	step(`backfill at ${MOST_PARALLEL_REQUESTS} in flight`, `1,204 records in one page, ${stub.state.mostInFlight} requests at once, every record with a vector`);
}

async function turnOff() {
	await rebuild(null);
	assert((await withoutVectors()) === 4, "Turning the embedder off should leave no vector.");
	const off = library(null).engine;
	const byWords = await keys(off, { text: "radio lessons", size: 4, semantic: { ratio: 0.5 } });
	assert(byWords[0] === "RADIO001", `Without an embedder, words alone should rank; they gave ${byWords.join(", ")}.`);
	const unavailable = await off.search({ ...searched, text: "", size: 3, semantic: { ratio: 0.7, like: "RADIO001" } }).then(
		() => false,
		(error: unknown) => error instanceof SearchMeaningUnavailableError,
	);
	assert(unavailable, "Similar records without vectors should say they aren't ready.");
	step("embedder off", "no vectors; search by words; similar records not ready");
}

async function verify(stub: Stub) {
	const enabled = embedderConfig(stub.url, 1_024);
	await turnOn(stub, enabled);
	await searchByMeaning(enabled);
	await searchFromRecord(enabled);
	await changeRecord(stub, enabled);
	await rebuildReusing(stub, enabled);
	await recoverFromFailure(stub, enabled);
	await refusedText(stub, enabled);
	await changeEmbedder(stub);
	await backfillAtMost(stub, enabled);
	await turnOff();
}

async function main() {
	// It creates and deletes indexes; a local Elasticsearch only, unless asked.
	const host = new URL(elasticsearchUrl).hostname;
	if (!["127.0.0.1", "localhost", "::1"].includes(host) && process.env.EMBEDDER_TEST_ALLOW_REMOTE !== "1") {
		throw new Error(`ELASTICSEARCH_URL names ${host}; set EMBEDDER_TEST_ALLOW_REMOTE=1 to check a remote Elasticsearch.`);
	}
	const stub = await startEmbedder();
	try {
		await verify(stub);
		console.log("Search embedder verification passed.");
	} finally {
		await library(null)
			.writer.remove()
			.catch((error: unknown) => console.error(`Deleting the test indexes ${alias}_* failed: ${error instanceof Error ? error.message : error}`));
		await stub.close();
		await client.close();
	}
}

if (process.env.SEARCH_ENGINE === "meilisearch") {
	void import("./verifySearchEmbedder");
} else {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
