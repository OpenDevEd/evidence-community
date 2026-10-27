/**
 * Checks records' vectors and search by meaning on a real Elasticsearch (OpenDevEd/new-el#720), with a local embedder
 * standing in for the library's: no paid service is called. It writes a test library's records with vectors, searches
 * them by meaning and from a record, changes a record, rebuilds reusing vectors, recovers from a failing embedder,
 * changes the embedder, and turns it off. Its indexes are deleted at the end.
 *
 *   ELASTICSEARCH_URL=http://127.0.0.1:59200 ELASTICSEARCH_PASSWORD=… npm run test:search-embedder
 *
 * `SEARCH_ENGINE=meilisearch` checks Meilisearch's own embedder instead (`verifySearchEmbedder.ts`).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@elastic/elasticsearch";

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { SearchService } from "../src/lib/elasticsearch-factory";
import { createEmbedder } from "../src/lib/embedder";
import { SearchMeaningUnavailableError } from "../src/lib/search-engine";
import { elasticsearchEngine } from "../src/lib/search-engines/elasticsearch";
import { elasticsearchEmbeddings } from "../src/lib/search-index/elasticsearch-embeddings";
import { elasticsearchWriter } from "../src/lib/search-index/elasticsearch-writer";
import type { ItemSearchDocument, SearchProjectionPlan } from "../src/lib/search-index/projection";

const alias = `search_embedder_e2e_${process.pid}`;
const client = new Client({
	node: process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:59200",
	auth: { username: process.env.ELASTICSEARCH_USERNAME ?? "elastic", password: process.env.ELASTICSEARCH_PASSWORD ?? "local-search-password" },
});
const service: SearchService = { alias, client };
const writeOptions = { maxDocumentBatchBytes: 10 * 1024 * 1024, taskTimeoutMs: 60_000 };

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/**
 * A stand-in embedder: each word of a text adds 1 to one of `dimensions` numbers, so texts sharing words point the
 * same way. It counts the texts it embeds, and refuses every request while `failing`.
 */
async function startEmbedder() {
	const state = { texts: 0, failing: false };
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
		request.on("end", () => {
			if (state.failing) {
				response.writeHead(400).end("refused");
				return;
			}
			const { input, dimensions } = JSON.parse(body) as { input: string[]; dimensions: number };
			state.texts += input.length;
			const data = input.map((text) => {
				const vector = new Array<number>(dimensions).fill(0);
				for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
					let hash = 0;
					for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % dimensions;
					vector[hash]! += 1;
				}
				return { embedding: vector };
			});
			response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data }));
		});
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
function library(configuration: LibraryServerConfig["search"]["embedder"]) {
	const embedder = createEmbedder(configuration);
	const embeddings = embedder ? elasticsearchEmbeddings(service, embedder) : null;
	return { writer: elasticsearchWriter(service, embeddings), embeddings, engine: elasticsearchEngine(service, embedder) };
}

async function rebuild(configuration: LibraryServerConfig["search"]["embedder"], documents = records) {
	await library(configuration).writer.rebuild(plansOf(documents), { ...writeOptions, reproject: () => plansOf([]) });
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

async function dimensions() {
	const mappings = await client.indices.getMapping({ index: alias });
	const properties = Object.values(mappings)[0]!.mappings.properties as Record<string, { dims?: number }>;
	return properties.embedding?.dims;
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
	await rebuild(enabled);
	assert(stub.state.texts === 4, `Turning the embedder on embedded ${stub.state.texts} texts, not 4.`);
	assert((await withoutVectors()) === 0, "A record has no vector after the embedder was turned on.");
	assert((await dimensions()) === 1_024, `The vectors have ${await dimensions()} dimensions, not 1,024.`);
	step("embedder on", "4 records embedded, 1,024 float dimensions");
}

async function searchByMeaning(enabled: Configuration) {
	const byMeaning = await keys(library(enabled).engine, { text: "radio lessons", size: 4, semantic: { ratio: 1 } });
	assert(byMeaning.join(",").startsWith("RADIO001,RURAL001,") && byMeaning.length === 4, `Search by meaning answered ${byMeaning.join(", ")}.`);
	step("search by meaning", byMeaning.join(", "));
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
	await rebuild(enabled);
	assert(stub.state.texts === before + 1, `The rebuild embedded ${stub.state.texts - before} texts, not just RADIO001's restored title.`);
	assert((await withoutVectors()) === 0, "A record lost its vector in the rebuild.");
	step("rebuild", "3 of 4 vectors reused from the old index");
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

async function changeEmbedder(stub: Stub) {
	const before = stub.state.texts;
	await rebuild(embedderConfig(stub.url, 512));
	assert(stub.state.texts === before + 4 && (await dimensions()) === 512, "Changing the embedder should embed every record again, at 512 dimensions.");
	step("embedder changed", "every record embedded again, 512 dimensions");
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
	await changeEmbedder(stub);
	await turnOff();
}

async function main() {
	const stub = await startEmbedder();
	try {
		await verify(stub);
		console.log("Search embedder verification passed.");
	} finally {
		await library(null).writer.remove().catch(() => undefined);
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
