import { errors as ElasticsearchErrors, type estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";

import type { ElasticsearchEmbeddings } from "./elasticsearch-embeddings";
import { newSearchIndexName, searchIndexDefinition } from "./elasticsearch-index";
import type { SearchProjectionPlan } from "./projection";
import {
	chunkDocumentsBySerializedBytes,
	SearchIndexDocumentError,
	SearchIndexWriteError,
	SearchOutboxAbortError,
	throwIfAborted,
	validateMaxDocumentBatchBytes,
	type SearchIndexWriter,
	type SearchRebuildOptions,
	type SearchWriteOptions,
} from "./writer";

type BulkItem = { status: number; _id?: string | null; error?: { type?: string; reason?: string | null } };

/** Elasticsearch error types that mean the record itself can't be indexed as it is. */
const DOCUMENT_ERROR_TYPES = new Set([
	"document_parsing_exception",
	"illegal_argument_exception",
	"mapper_parsing_exception",
	"strict_dynamic_mapping_exception",
]);

/** Whether one bulk answer succeeded, refused the record for its content, or failed in a way a retry can fix. */
function bulkItemOutcome(action: string, item: BulkItem) {
	// A delete of a record the index doesn't have is done; a missing index is not.
	if (!item.error || (action === "delete" && item.status === 404 && item.error.type !== "index_not_found_exception")) return "written";
	const busyOrBroken = item.status === 429 || item.status >= 500;
	return !busyOrBroken && DOCUMENT_ERROR_TYPES.has(item.error.type ?? "") ? "refused" : "retry";
}

/** Checks one bulk answer: a refused record throws `SearchIndexDocumentError`, an overload or server error a retry. */
function checkBulkItems(items: ReadonlyArray<Record<string, BulkItem>>) {
	const rejected: Array<{ key: string; reason: string }> = [];
	for (const entry of items) {
		const [action, item] = Object.entries(entry)[0]!;
		const outcome = bulkItemOutcome(action, item);
		const reason = `${item.error?.type}: ${item.error?.reason ?? ""}`;
		if (outcome === "retry") throw new SearchIndexWriteError("Elasticsearch", item.status, reason.slice(0, 2_000));
		if (outcome === "refused") rejected.push({ key: String(item._id), reason: reason.slice(0, 500) });
	}
	if (rejected.length > 0) throw new SearchIndexDocumentError("Elasticsearch", rejected);
}

/**
 * Writes records to one of the library's indexes, with their vectors when the library has an embedder, in bulk
 * requests no larger than `maxDocumentBatchBytes`, and removes `deleteKeys`. Through the alias, a write fails rather
 * than create an index under the alias's name.
 */
async function writeSearchDocuments(
	search: SearchService,
	target: string,
	plan: Pick<SearchProjectionPlan, "deleteKeys" | "documents">,
	options: SearchWriteOptions & { embeddings: ElasticsearchEmbeddings | null },
) {
	validateMaxDocumentBatchBytes(options.maxDocumentBatchBytes);
	const documents = options.embeddings ? await options.embeddings.attach(plan.documents, options.signal) : plan.documents;
	const requests: Array<Array<Record<string, unknown>>> = chunkDocumentsBySerializedBytes(
		documents,
		options.maxDocumentBatchBytes,
	).map((documents) => documents.flatMap((document) => [{ index: { _index: target, _id: String(document.key) } }, document]));
	if (plan.deleteKeys.length > 0) {
		requests.push(plan.deleteKeys.map((key) => ({ delete: { _index: target, _id: key } })));
	}
	for (const operations of requests) {
		throwIfAborted(options.signal);
		const response = await search.client
			.bulk(
				{ operations, require_alias: target === search.alias },
				{ signal: options.signal, requestTimeout: options.taskTimeoutMs },
			)
			.catch((error: unknown) => {
				if (options.signal?.aborted) throw new SearchOutboxAbortError();
				throw error;
			});
		if (response.errors) checkBulkItems(response.items as unknown as ReadonlyArray<Record<string, BulkItem>>);
	}
}

/** The index the library's alias points to, or null before the library has one. */
async function liveSearchIndex(search: SearchService, signal?: AbortSignal) {
	try {
		const aliases = await search.client.indices.getAlias({ name: search.alias }, { signal });
		return Object.keys(aliases)[0] ?? null;
	} catch (error) {
		if (error instanceof ElasticsearchErrors.ResponseError && error.statusCode === 404) return null;
		throw error;
	}
}

/** Creates an empty index; a bulk load creates it with refresh off and turns refresh on once it is full. */
async function createSearchIndex(search: SearchService, index: string, options: { bulkLoad: boolean; signal?: AbortSignal }) {
	const { settings, mappings } = searchIndexDefinition();
	await search.client.indices.create(
		{
			index,
			settings: (options.bulkLoad
				? { ...settings, index: { ...settings.index, refresh_interval: "-1" } }
				: settings) as estypes.IndicesIndexSettings,
			mappings: mappings as estypes.MappingTypeMapping,
		},
		{ signal: options.signal },
	);
}

/** Every index behind the library's alias, and any a stopped rebuild left behind. */
async function libraryIndexes(search: SearchService, signal?: AbortSignal) {
	const resolved = await search.client.indices.resolveIndex({ name: `${search.alias}_*` }, { signal });
	return resolved.indices.map((index) => index.name);
}

/** The size Elasticsearch stops merging segments at; a forced merge keeps segments under it so they still merge later. */
const MERGED_SEGMENT_BYTES = 5 * 1024 ** 3;

async function deleteIndexes(search: SearchService, names: readonly string[], signal?: AbortSignal) {
	if (names.length > 0) await search.client.indices.delete({ index: [...names] }, { signal });
}

/** Deletes the library's indexes no alias points to: what a stopped or failed rebuild left behind. */
async function deleteLeftovers(search: SearchService, signal?: AbortSignal) {
	const live = await liveSearchIndex(search, signal);
	const leftovers = (await libraryIndexes(search, signal)).filter((name) => name !== live);
	await deleteIndexes(search, leftovers, signal);
	return leftovers.length;
}

/** Writes every record to `target`, one write in flight while the next batch of records is projected. */
async function fillIndex(
	search: SearchService,
	target: string,
	plans: AsyncIterable<SearchProjectionPlan>,
	options: SearchRebuildOptions & { embeddings: ElasticsearchEmbeddings | null },
) {
	let indexed = 0;
	let failure: unknown;
	let writing = Promise.resolve();
	try {
		for await (const plan of plans) {
			await writing;
			if (failure) throw failure;
			throwIfAborted(options.signal);
			writing = writeSearchDocuments(search, target, { documents: plan.documents, deleteKeys: [] }, options).catch((error: unknown) => {
				failure ??= error;
			});
			indexed += plan.documents.length;
		}
	} finally {
		// A write still landing could otherwise create `target` again after a failed rebuild deletes it.
		await writing;
	}
	if (failure) throw failure;
	return indexed;
}

/** Turns refresh back on and moves the alias to `target` in one step; returns the index readers left. */
async function swapAlias(search: SearchService, target: string, signal?: AbortSignal) {
	await search.client.indices.putSettings({ index: target, settings: { index: { refresh_interval: "1s" } } }, { signal });
	await search.client.indices.refresh({ index: target }, { signal });
	const live = await liveSearchIndex(search, signal);
	await search.client.indices.updateAliases(
		{
			actions: [
				...(live === null ? [] : [{ remove: { index: live, alias: search.alias } }]),
				{ add: { index: target, alias: search.alias, is_write_index: true } },
			],
		},
		{ signal },
	);
	return live;
}

/**
 * A bulk load leaves a dozen segments; fewer search about twice as fast (OpenDevEd/new-el#721). Segments stay under
 * the size Elasticsearch still merges, since the index keeps taking writes. Elasticsearch merges in the background, as
 * a large library's merge can take far longer than a rebuild may wait.
 */
async function mergeSegments(search: SearchService, target: string, signal?: AbortSignal) {
	const stats = await search.client.indices.stats({ index: target, metric: "store" }, { signal });
	const bytes = stats._all.primaries?.store?.size_in_bytes ?? 0;
	const segments = Math.max(1, Math.ceil(bytes / MERGED_SEGMENT_BYTES));
	await search.client.indices.forcemerge({ index: target, max_num_segments: segments, wait_for_completion: false }, { signal });
}

/**
 * Fills a new index with every record and moves the alias to it in one step, so readers keep searching the old index
 * until the new one is complete. A failed or stopped rebuild deletes its new index; any one a crash left behind is
 * deleted by the next rebuild, before it creates another.
 */
async function rebuildSearchIndex(
	search: SearchService,
	plans: AsyncIterable<SearchProjectionPlan>,
	options: SearchRebuildOptions & { embeddings: ElasticsearchEmbeddings | null },
) {
	const leftovers = await deleteLeftovers(search, options.signal);
	const target = newSearchIndexName(search.alias);
	await createSearchIndex(search, target, { bulkLoad: true, signal: options.signal });
	let indexed: number;
	let replaced: string | null;
	try {
		indexed = await fillIndex(search, target, plans, options);
		replaced = await swapAlias(search, target, options.signal);
	} catch (error) {
		// The alias may have moved even though its request failed; then readers search `target`, which must stay.
		const live = await liveSearchIndex(search).catch(() => target);
		if (live !== target) await search.client.indices.delete({ index: target }).catch(() => undefined);
		if (options.signal?.aborted) throw new SearchOutboxAbortError();
		throw error;
	}
	// Readers already search the new index; tidying up after it can fail without undoing that.
	try {
		await deleteIndexes(search, replaced === null ? [] : [replaced], options.signal);
		await mergeSegments(search, target, options.signal);
	} catch (error) {
		console.error(`Search index: tidying up after the rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	return { indexed, deleted: leftovers + (replaced === null ? 0 : 1) };
}

/**
 * A library's records in the shared Elasticsearch, written through its alias and login (OpenDevEd/new-el#719), with
 * their vectors when the library has an embedder (OpenDevEd/new-el#720). A rebuild reuses the vectors of the index
 * readers search, which the alias still names while the new index fills.
 */
export function elasticsearchWriter(search: SearchService, embeddings: ElasticsearchEmbeddings | null = null): SearchIndexWriter {
	return {
		engine: "elasticsearch",
		async ensure(options) {
			throwIfAborted(options.signal);
			if ((await liveSearchIndex(search, options.signal)) !== null) return { created: false };
			await options.onMissing?.();
			throwIfAborted(options.signal);
			const index = newSearchIndexName(search.alias);
			await createSearchIndex(search, index, { bulkLoad: false, signal: options.signal });
			await search.client.indices.updateAliases(
				{ actions: [{ add: { index, alias: search.alias, is_write_index: true } }] },
				{ signal: options.signal },
			);
			return { created: true };
		},
		/** Each plan is written as it comes; readers find the claim's changes once `finish` refreshes the index. */
		batch(options) {
			return {
				add: (plan) => writeSearchDocuments(search, search.alias, plan, { ...options, embeddings }),
				finish: async () => {
					await search.client.indices.refresh({ index: search.alias }, { signal: options.signal }).catch((error: unknown) => {
						if (options.signal?.aborted) throw new SearchOutboxAbortError();
						throw error;
					});
				},
			};
		},
		rebuild: (plans, options) => rebuildSearchIndex(search, plans, { ...options, embeddings }),
		async remove(signal) {
			const indexes = await libraryIndexes(search, signal);
			if (indexes.length > 0) await search.client.indices.delete({ index: indexes }, { signal });
		},
	};
}
