/**
 * What the search outbox verifier needs from the engine it checks (OpenDevEd/new-el#722): writers for a working index
 * and for one that refuses every record, a way to count writes and act before each, and reads that check what was
 * written. `SEARCH_ENGINE=meilisearch` picks Meilisearch; Elasticsearch is the default.
 */
import { Client, errors } from "@elastic/elasticsearch";
import { Meilisearch, MeilisearchApiError, type Index } from "meilisearch";

import type { SearchEngineName } from "../src/config/library-config/schema";
import type { SearchService } from "../src/lib/elasticsearch-factory";
import type { MeilisearchService } from "../src/lib/meilisearch-factory";
import { FULL_TEXT_PDF_PRESENCE_ATTRIBUTE } from "../src/lib/search-filter-constants";
import { elasticsearchWriter } from "../src/lib/search-index/elasticsearch-writer";
import { meilisearchWriter } from "../src/lib/search-index/meilisearch-writer";
import type { SearchIndexWriter } from "../src/lib/search-index/writer";

export type OutboxVerifierEngine = {
	name: SearchEngineName;
	writer(): SearchIndexWriter;
	/** A writer whose every record write fails for the record's content. */
	refusingWriter(): SearchIndexWriter;
	/** A writer that counts its write requests and runs `before` ahead of each. */
	intercept(before: () => Promise<void>): { writer: SearchIndexWriter; writeCalls: () => number };
	/** Deletes both test indexes. */
	reset(): Promise<void>;
	/** Creates the working index and the refusing one. */
	prepare(): Promise<void>;
	readDocument<T>(key: string): Promise<T>;
	documentMissing(key: string): Promise<boolean>;
	addDocuments(documents: ReadonlyArray<Record<string, unknown>>): Promise<void>;
	deleteDocument(key: string): Promise<void>;
	/** The keys a text search over `fields` finds, limited to records with PDF page text when `withPageText`. */
	searchKeys(text: string, fields: readonly string[], withPageText: boolean): Promise<string[]>;
};

const TASK_TIMEOUT_MS = 60_000;

/** Whether Meilisearch answered with this error code. */
function meilisearchError(error: unknown, code: string) {
	return error instanceof MeilisearchApiError && error.cause?.code === code;
}

function elasticsearchEngine(goodIndexName: string, badIndexName: string): OutboxVerifierEngine {
	const client = new Client({
		node: process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:59200",
		auth: { username: process.env.ELASTICSEARCH_USERNAME ?? "elastic", password: process.env.ELASTICSEARCH_PASSWORD ?? "local-search-password" },
	});
	const good: SearchService = { alias: goodIndexName, client };
	/** Deletes every index behind an alias, and any a stopped rebuild left beside them. */
	const deleteIndexes = async (alias: string) => {
		const resolved = await client.indices.resolveIndex({ name: `${alias}_*` });
		const names = resolved.indices.map((index) => index.name);
		if (names.length > 0) await client.indices.delete({ index: names });
	};
	return {
		name: "elasticsearch",
		writer: () => elasticsearchWriter(good),
		refusingWriter: () => elasticsearchWriter({ alias: badIndexName, client }),
		intercept(before) {
			let calls = 0;
			const intercepted = new Proxy(client, {
				get(target, property, receiver) {
					if (property === "bulk") {
						return async (request: unknown, options?: unknown) => {
							calls += 1;
							await before();
							return target.bulk(request as never, options as never);
						};
					}
					const value = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return { writer: elasticsearchWriter({ alias: goodIndexName, client: intercepted }), writeCalls: () => calls };
		},
		reset: async () => {
			await Promise.all([deleteIndexes(goodIndexName), deleteIndexes(badIndexName)]);
		},
		async prepare() {
			await elasticsearchWriter(good).ensure({});
			// No field may be added, so every record is refused for its content.
			await client.indices.create({
				index: `${badIndexName}_1`,
				mappings: { dynamic: "strict", properties: {} },
				aliases: { [badIndexName]: { is_write_index: true } },
			});
		},
		readDocument: async <T>(key: string) => (await client.get<T>({ index: goodIndexName, id: key }))._source as T,
		async documentMissing(key) {
			try {
				await client.get({ index: goodIndexName, id: key });
				return false;
			} catch (error) {
				if (error instanceof errors.ResponseError && error.statusCode === 404) return true;
				throw error;
			}
		},
		async addDocuments(documents) {
			await client.bulk({
				refresh: "wait_for",
				operations: documents.flatMap((document) => [{ index: { _index: goodIndexName, _id: String(document.key) } }, document]),
			});
		},
		async deleteDocument(key) {
			await client.delete({ index: goodIndexName, id: key, refresh: "wait_for" });
		},
		async searchKeys(text, fields, withPageText) {
			const response = await client.search<{ key: string }>({
				index: goodIndexName,
				query: {
					bool: {
						must: [{ multi_match: { query: text, fields: [...fields], operator: "and" } }],
						filter: withPageText ? [{ exists: { field: FULL_TEXT_PDF_PRESENCE_ATTRIBUTE } }] : [],
					},
				},
			});
			return response.hits.hits.map((hit) => hit._source!.key);
		},
	};
}

function meilisearchEngine(goodIndexName: string, badIndexName: string): OutboxVerifierEngine {
	const client = new Meilisearch({ host: process.env.MEILISEARCH_URL ?? "http://127.0.0.1:57700", apiKey: process.env.MEILISEARCH_KEY });
	const service = (index: Index, indexName: string): MeilisearchService => ({ client, index, indexName });
	const good = service(client.index(goodIndexName), goodIndexName);
	const writer = (meilisearch: MeilisearchService) => meilisearchWriter(meilisearch, { taskTimeoutMs: TASK_TIMEOUT_MS });
	const succeeded = async (task: { waitTask: () => Promise<{ status: string; uid: number; error?: { message?: string } | null }> }) => {
		const done = await task.waitTask();
		if (done.status !== "succeeded") throw new Error(`Meilisearch setup task ${done.uid} failed: ${done.error?.message}`);
	};
	const deleteIndex = async (indexName: string) => {
		try {
			await client.getRawIndex(indexName);
			await succeeded(client.deleteIndex(indexName));
		} catch (error) {
			if (!meilisearchError(error, "index_not_found")) throw error;
		}
	};
	return {
		name: "meilisearch",
		writer: () => writer(good),
		refusingWriter: () => writer(service(client.index(badIndexName), badIndexName)),
		intercept(before) {
			let calls = 0;
			const intercepted = new Proxy(good.index, {
				get(target, property, receiver) {
					if (property === "addDocuments" || property === "deleteDocuments") {
						const write = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
						return async (...args: unknown[]) => {
							calls += 1;
							await before();
							return write.apply(target, args);
						};
					}
					const value = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return { writer: writer(service(intercepted, goodIndexName)), writeCalls: () => calls };
		},
		reset: async () => {
			await Promise.all([deleteIndex(goodIndexName), deleteIndex(badIndexName)]);
		},
		async prepare() {
			await writer(good).ensure({});
			// Records carry `key`; an index whose primary key is `id` refuses every one.
			await succeeded(client.createIndex(badIndexName, { primaryKey: "id" }));
		},
		readDocument: <T>(key: string) => good.index.getDocument(key) as Promise<T>,
		async documentMissing(key) {
			try {
				await good.index.getDocument(key);
				return false;
			} catch (error) {
				if (!meilisearchError(error, "document_not_found")) throw error;
				return true;
			}
		},
		async addDocuments(documents) {
			await succeeded(good.index.addDocuments([...documents], { primaryKey: "key" }));
		},
		async deleteDocument(key) {
			await succeeded(good.index.deleteDocument(key));
		},
		async searchKeys(text, fields, withPageText) {
			const response = await good.index.search<{ key: string }>(text, {
				attributesToSearchOn: [...fields],
				attributesToRetrieve: ["key"],
				filter: withPageText ? [`${FULL_TEXT_PDF_PRESENCE_ATTRIBUTE} EXISTS`] : [],
			});
			return response.hits.map((hit) => hit.key);
		},
	};
}

export function outboxVerifierEngine(goodIndexName: string, badIndexName: string): OutboxVerifierEngine {
	return process.env.SEARCH_ENGINE === "meilisearch" ? meilisearchEngine(goodIndexName, badIndexName) : elasticsearchEngine(goodIndexName, badIndexName);
}
