import { errors as ElasticsearchErrors, type estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";

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
	if (!item.error || (action === "delete" && item.status === 404)) return "written";
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
 * Writes records to one of the library's indexes, in bulk requests no larger than `maxDocumentBatchBytes`, and
 * removes `deleteKeys`. With `searchable`, Elasticsearch answers only once readers can find the change.
 */
async function writeSearchDocuments(
	search: SearchService,
	target: string,
	plan: Pick<SearchProjectionPlan, "deleteKeys" | "documents">,
	options: SearchWriteOptions & { searchable: boolean },
) {
	validateMaxDocumentBatchBytes(options.maxDocumentBatchBytes);
	const requests: Array<Array<Record<string, unknown>>> = chunkDocumentsBySerializedBytes(
		plan.documents,
		options.maxDocumentBatchBytes,
	).map((documents) => documents.flatMap((document) => [{ index: { _index: target, _id: String(document.key) } }, document]));
	if (plan.deleteKeys.length > 0) {
		requests.push(plan.deleteKeys.map((key) => ({ delete: { _index: target, _id: key } })));
	}
	for (const [position, operations] of requests.entries()) {
		throwIfAborted(options.signal);
		const response = await search.client
			.bulk(
				{ operations, refresh: options.searchable && position === requests.length - 1 ? "wait_for" : false },
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

/**
 * Fills a new index with every record and moves the alias to it in one step, so readers keep searching the old index
 * until the new one is complete. The indexes it replaces, and any a stopped rebuild left behind, are deleted. One
 * write is in flight while the next batch of records is projected.
 */
async function rebuildSearchIndex(search: SearchService, plans: AsyncIterable<SearchProjectionPlan>, options: SearchRebuildOptions) {
	const writeOptions = { ...options, searchable: false };
	const target = newSearchIndexName(search.alias);
	await createSearchIndex(search, target, { bulkLoad: true, signal: options.signal });
	let indexed = 0;
	let failure: unknown;
	let writing = Promise.resolve();
	for await (const plan of plans) {
		await writing;
		if (failure) throw failure;
		throwIfAborted(options.signal);
		writing = writeSearchDocuments(search, target, { documents: plan.documents, deleteKeys: [] }, writeOptions).catch(
			(error: unknown) => {
				failure ??= error;
			},
		);
		indexed += plan.documents.length;
	}
	await writing;
	if (failure) throw failure;
	await search.client.indices.putSettings({ index: target, settings: { index: { refresh_interval: "1s" } } }, { signal: options.signal });
	await search.client.indices.refresh({ index: target }, { signal: options.signal });
	const replaced = (await libraryIndexes(search, options.signal)).filter((name) => name !== target);
	const live = await liveSearchIndex(search, options.signal);
	await search.client.indices.updateAliases(
		{
			actions: [
				...(live === null ? [] : [{ remove: { index: live, alias: search.alias } }]),
				{ add: { index: target, alias: search.alias, is_write_index: true } },
			],
		},
		{ signal: options.signal },
	);
	if (replaced.length > 0) await search.client.indices.delete({ index: replaced }, { signal: options.signal });
	// A bulk load leaves a dozen segments; one searches about twice as fast (OpenDevEd/new-el#721). Elasticsearch merges
	// them in the background, as a large library's merge can take far longer than a rebuild may wait.
	await search.client.indices.forcemerge({ index: target, max_num_segments: 1, wait_for_completion: false }, { signal: options.signal });
	return { indexed, deleted: replaced.length };
}

/** A library's records in the shared Elasticsearch, written through its alias and login (OpenDevEd/new-el#719). */
export function elasticsearchWriter(search: SearchService): SearchIndexWriter {
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
		/** Each plan is written as it comes, searchable once its write returns. */
		batch(options) {
			return {
				add: (plan) => writeSearchDocuments(search, search.alias, plan, { ...options, searchable: true }),
				finish: async () => {},
			};
		},
		rebuild: (plans, options) => rebuildSearchIndex(search, plans, options),
		async remove(signal) {
			const indexes = await libraryIndexes(search, signal);
			if (indexes.length > 0) await search.client.indices.delete({ index: indexes }, { signal });
		},
	};
}
