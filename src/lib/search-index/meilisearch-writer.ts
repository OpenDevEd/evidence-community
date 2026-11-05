import { setTimeout as delay } from "node:timers/promises";

import { MeilisearchApiError, MeilisearchTaskTimeOutError, type Index, type Meilisearch, type Settings, type Task } from "meilisearch";

import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import type { MeilisearchService } from "@/lib/meilisearch-factory";
import {
	FULL_TEXT_PDF_PRESENCE_ATTRIBUTE,
	PDF_PRESENCE_ATTRIBUTE,
	SEARCH_RESULT_LIMITS,
	SOURCES_FIELD,
} from "@/lib/search-filter-constants";

import { buildEmbedderSettings, EMBEDDER_TASK_POLL_INTERVAL_MS, EMBEDDER_TASK_TIMEOUT_MS, type SearchEmbedderConfiguration } from "./embedder-settings";
import type { SearchProjectionPlan } from "./projection";
import {
	abortable,
	chunkDocumentsBySerializedBytes,
	SearchIndexDocumentError,
	SearchOutboxAbortError,
	throwIfAborted,
	validateMaxDocumentBatchBytes,
	type SearchIndexWriter,
	type SearchRebuildOptions,
	type SearchWriteOptions,
	type SearchWriteProgress,
} from "./writer";

/**
 * A library's records in its own Meilisearch, written as the library wrote them before EL-32 (OpenDevEd/new-el#722).
 * A write is complete only once its Meilisearch task succeeded.
 */

const DEFAULT_TASK_POLL_INTERVAL_MS = 100;
/** Queued rebuild batches; each holds an open file in Meilisearch. */
const REBUILD_TASKS_IN_FLIGHT = 500;
type EnqueuedTask = ReturnType<Index["addDocuments"]>;

/** A Meilisearch task that failed. The claim is split until the event behind it is found, as for a refused record. */
export class SearchIndexTaskError extends SearchIndexDocumentError {
	readonly task: Task;

	constructor(task: Task) {
		super("Meilisearch", []);
		this.message = `Meilisearch task ${task.uid} ${task.status}: ${task.error?.message ?? "unknown error"}`;
		this.name = "SearchIndexTaskError";
		this.task = task;
	}
}

type TaskWaitOptions = {
	batchClient?: Meilisearch["batches"];
	eventIds?: number[];
	onProgress?: (progress: SearchWriteProgress) => Promise<void>;
	pollIntervalMs?: number;
	signal?: AbortSignal;
	taskClient: Index["tasks"];
};

/** How far the batch a task is in has got, which keeps a long batch from counting as stalled. */
async function batchMovement(task: Task, batchClient: Meilisearch["batches"], signal?: AbortSignal) {
	try {
		if (task.batchUid !== null) {
			const batch = await abortable(batchClient.getBatch(task.batchUid), signal);
			const progress = batch.progress?.percentage ?? null;
			return { progress, movement: `${task.batchUid}:${progress}` };
		}
		const { results } = await abortable(batchClient.getBatches({ statuses: ["processing"], limit: 1 }), signal);
		return { progress: null, movement: `running:${results[0]?.uid}:${results[0]?.progress?.percentage}` };
	} catch (error) {
		if (error instanceof SearchOutboxAbortError) throw error;
		// Batch telemetry is optional; task status remains authoritative.
		return null;
	}
}

/** Whether Meilisearch answered a request with this error code. */
function apiErrorCode(error: unknown, code: string) {
	return error instanceof MeilisearchApiError && error.cause?.code === code;
}

/** Whether a Meilisearch task failed with this error code. */
function taskErrorCode(error: unknown, code: string) {
	return error instanceof SearchIndexTaskError && error.task.error?.code === code;
}

function isRunning(task: Task) {
	return task.status === "enqueued" || task.status === "processing";
}

/** The progress a task reports: still queued, indexing, or done (its batch then at 100%). */
function taskProgress(task: Task, batchProgress: number | null, eventIds: number[]): SearchWriteProgress {
	const done = task.status === "succeeded" && task.batchUid !== null;
	return { batchProgress: done ? 100 : batchProgress, batchUid: task.batchUid, eventIds, stage: task.status === "enqueued" ? "waiting" : "indexing", taskUid: task.uid };
}

/** Reports progress only when it changed since the last report. */
function progressReporter(onProgress: TaskWaitOptions["onProgress"]) {
	let last = "";
	return async (progress: SearchWriteProgress) => {
		const signature = JSON.stringify(progress);
		if (signature === last) return;
		last = signature;
		await onProgress?.(progress);
	};
}

/** The task now, its batch's progress, and a token that changes whenever Meilisearch made headway on it. */
async function pollTask(taskUid: number, options: TaskWaitOptions, previousMovement: string) {
	const task = await abortable(options.taskClient.getTask(taskUid, { signal: options.signal }), options.signal);
	const watchBatch = options.batchClient && (task.batchUid !== null || task.status === "enqueued");
	const moved = watchBatch ? await batchMovement(task, options.batchClient!, options.signal) : null;
	const movement = moved?.movement ?? previousMovement;
	return { task, batchProgress: moved?.progress ?? null, movement, state: `${task.status}:${task.batchUid}:${movement}` };
}

async function pause(pollIntervalMs: number, signal?: AbortSignal) {
	await delay(pollIntervalMs, undefined, { signal }).catch((error: unknown) => {
		if (signal?.aborted) throw new SearchOutboxAbortError();
		throw error;
	});
}

/**
 * Waits for a task to succeed. The timeout is for a task that stopped moving: a task in a long batch waits as long as
 * its batch makes progress, and a queued task as long as the batch Meilisearch is running does. A failed progress read
 * keeps the last one, so it never counts as movement.
 */
async function waitForSuccessfulTask(taskPromise: EnqueuedTask, taskTimeoutMs: number, options: TaskWaitOptions) {
	const enqueued = await abortable(taskPromise, options.signal);
	const eventIds = options.eventIds ?? [];
	const report = progressReporter(options.onProgress);
	await report({ batchProgress: null, batchUid: null, eventIds, stage: "waiting", taskUid: enqueued.taskUid });
	let deadline = Date.now() + taskTimeoutMs;
	let lastState = "";
	let movement = "";
	while (Date.now() <= deadline) {
		throwIfAborted(options.signal);
		const polled = await pollTask(enqueued.taskUid, options, movement);
		const { task, batchProgress } = polled;
		movement = polled.movement;
		if (polled.state !== lastState) {
			lastState = polled.state;
			deadline = Date.now() + taskTimeoutMs;
		}
		await report(taskProgress(task, batchProgress, eventIds));
		if (isRunning(task)) {
			await pause(options.pollIntervalMs ?? DEFAULT_TASK_POLL_INTERVAL_MS, options.signal);
			continue;
		}
		if (task.status === "succeeded") return task;
		throw new SearchIndexTaskError(task);
	}
	throw new MeilisearchTaskTimeOutError(enqueued.taskUid, taskTimeoutMs);
}

/** Sends a plan's Meilisearch tasks without waiting for them to finish. */
async function queueSearchProjectionPlan(index: Index, plan: SearchProjectionPlan, maxDocumentBatchBytes: number, signal?: AbortSignal) {
	validateMaxDocumentBatchBytes(maxDocumentBatchBytes);
	const tasks: EnqueuedTask[] = [];
	for (const documents of chunkDocumentsBySerializedBytes(plan.documents, maxDocumentBatchBytes)) {
		tasks.push(index.addDocuments(documents, { primaryKey: "key" }));
		await abortable(tasks.at(-1)!, signal);
	}
	if (plan.deleteKeys.length > 0) {
		tasks.push(index.deleteDocuments(plan.deleteKeys));
		await abortable(tasks.at(-1)!, signal);
	}
	return tasks;
}

/** The library's index settings: what readers filter, count, sort and search, and how deep they page. */
function indexSettings(): Settings {
	return {
		faceting: {
			maxValuesPerFacet: 10_000,
			sortFacetValuesBy: {
				collectionsAncestry: "count",
				country: "count",
				authorCountry: "count",
				[SOURCES_FIELD]: "count",
				topicAncestors: "count",
				studyType: "count",
				studyTypeShown: "count",
				fullNames: "count",
				[INSTITUTION_FILTER_FIELD]: "count",
			},
		},
		// Only `year` is range-filtered, and nothing searches inside facet values. Leaving the other features off saves
		// Meilisearch work on every indexing task; facet counts are unaffected.
		facetSearch: false,
		filterableAttributes: [
			{ attributePatterns: ["year"], features: { facetSearch: false, filter: { equality: true, comparison: true } } },
			{
				attributePatterns: [
					"itemType",
					"studyType",
					"studyTypeShown",
					"deleted",
					"tags",
					INSTITUTION_FILTER_FIELD,
					"country",
					"authorCountry",
					"fullNames",
					"collections",
					"collectionsAncestry",
					"topicAncestors",
					"key",
					"provider",
					"sourceConnectionKey",
					SOURCES_FIELD,
					FULL_TEXT_PDF_PRESENCE_ATTRIBUTE,
					PDF_PRESENCE_ATTRIBUTE,
				],
				features: { facetSearch: false, filter: { equality: true, comparison: false } },
			},
		],
		pagination: { maxTotalHits: SEARCH_RESULT_LIMITS.meilisearch },
		searchableAttributes: ["*"],
		sortableAttributes: ["citationCount", "dateSortKey", "fullNames", "title", "year", "dateAdded", "updatedAt"],
	};
}

/** Creates the index when it has none; another worker creating it meanwhile counts as there. */
async function createIndexIfMissing(service: MeilisearchService, options: { onMissing?: () => Promise<void>; signal?: AbortSignal; taskTimeoutMs: number }) {
	try {
		await abortable(service.client.getRawIndex(service.indexName), options.signal);
		return false;
	} catch (error) {
		if (!apiErrorCode(error, "index_not_found")) throw error;
	}
	await options.onMissing?.();
	throwIfAborted(options.signal);
	try {
		await waitForSuccessfulTask(service.client.createIndex(service.indexName, { primaryKey: "key" }), options.taskTimeoutMs, {
			signal: options.signal,
			taskClient: service.index.tasks,
		});
		return true;
	} catch (creationError) {
		if (!taskErrorCode(creationError, "index_already_exists")) throw creationError;
		return false;
	}
}

async function ensureSearchIndex(service: MeilisearchService, options: { onMissing?: () => Promise<void>; signal?: AbortSignal; taskTimeoutMs: number }) {
	throwIfAborted(options.signal);
	const created = await createIndexIfMissing(service, options);
	// A new sortable or filterable field makes Meilisearch reindex every record; its progress keeps the wait going.
	await waitForSuccessfulTask(service.index.updateSettings(indexSettings()), options.taskTimeoutMs, {
		batchClient: service.client.batches,
		signal: options.signal,
		taskClient: service.index.tasks,
	});
	return { created };
}

/** Writes the library's embedder to the index under the platform name and waits for Meilisearch to embed. `null` removes it. */
export function applySearchIndexEmbedder(
	service: MeilisearchService,
	embedder: SearchEmbedderConfiguration,
	options: { onProgress?: (progress: SearchWriteProgress) => Promise<void>; signal?: AbortSignal; taskTimeoutMs?: number } = {},
) {
	throwIfAborted(options.signal);
	return waitForSuccessfulTask(service.index.updateSettings({ embedders: buildEmbedderSettings(embedder) }), options.taskTimeoutMs ?? EMBEDDER_TASK_TIMEOUT_MS, {
		batchClient: service.client.batches,
		onProgress: options.onProgress,
		pollIntervalMs: EMBEDDER_TASK_POLL_INTERVAL_MS,
		signal: options.signal,
		taskClient: service.index.tasks,
	});
}

async function readIndexedKeys(index: Index, signal?: AbortSignal) {
	const keys = new Set<string>();
	for (let offset = 0; ; offset += 1_000) {
		const page = await abortable(index.getDocuments<{ key: string }>({ fields: ["key"], limit: 1_000, offset }), signal);
		for (const document of page.results) keys.add(document.key);
		if (page.results.length < 1_000) return keys;
	}
}

/**
 * Records are replaced in place, not deleted first: search keeps answering during the rebuild, and Meilisearch keeps
 * the embedding of every record whose embedded text did not change. Whatever is left afterwards is removed.
 */
async function rebuildSearchIndex(service: MeilisearchService, plans: AsyncIterable<SearchProjectionPlan>, options: SearchRebuildOptions) {
	const taskClient = service.index.tasks;
	await ensureSearchIndex(service, options);
	const staleKeys = await readIndexedKeys(service.index, options.signal);
	// Batches are sent ahead of the ones Meilisearch is still indexing, so it indexes them together instead of
	// repeating its per-batch work for each one. Meilisearch keeps a file open for every queued batch, so at most
	// REBUILD_TASKS_IN_FLIGHT wait at once.
	const tasks: EnqueuedTask[] = [];
	const waitForOldestTask = () =>
		waitForSuccessfulTask(tasks.shift()!, options.taskTimeoutMs, { batchClient: service.client.batches, signal: options.signal, taskClient });
	let indexed = 0;
	for await (const plan of plans) {
		throwIfAborted(options.signal);
		for (const documents of chunkDocumentsBySerializedBytes(plan.documents, options.maxDocumentBatchBytes)) {
			const task = service.index.addDocuments(documents, { primaryKey: "key" });
			await abortable(task, options.signal);
			tasks.push(task);
			if (tasks.length >= REBUILD_TASKS_IN_FLIGHT) await waitForOldestTask();
		}
		for (const document of plan.documents) staleKeys.delete(document.key);
		indexed += plan.documents.length;
	}
	while (tasks.length > 0) await waitForOldestTask();
	if (staleKeys.size > 0) {
		await waitForSuccessfulTask(service.index.deleteDocuments([...staleKeys]), options.taskTimeoutMs, { signal: options.signal, taskClient });
		// A running worker may have indexed one of these records after it was published again during the rebuild.
		// Reading PostgreSQL only after the delete puts any such record back; a later publish has its own event.
		for await (const plan of options.reproject([...staleKeys])) {
			for (const task of await queueSearchProjectionPlan(service.index, plan, options.maxDocumentBatchBytes, options.signal)) {
				await waitForSuccessfulTask(task, options.taskTimeoutMs, { signal: options.signal, taskClient });
			}
		}
	}
	return { indexed, deleted: staleKeys.size };
}

/** Every plan of a claim is sent before any is awaited, so Meilisearch indexes a large claim in one batch. */
function writeBatch(service: MeilisearchService, options: SearchWriteOptions) {
	const tasks: EnqueuedTask[] = [];
	return {
		async add(plan: SearchProjectionPlan) {
			tasks.push(...(await queueSearchProjectionPlan(service.index, plan, options.maxDocumentBatchBytes, options.signal)));
		},
		async finish() {
			for (const task of tasks) {
				options.checkLease?.();
				await waitForSuccessfulTask(task, options.taskTimeoutMs, {
					batchClient: service.client.batches,
					eventIds: options.eventIds,
					onProgress: options.onProgress,
					signal: options.signal,
					taskClient: service.index.tasks,
				});
			}
		},
	};
}

export function meilisearchWriter(service: MeilisearchService, options: { taskTimeoutMs: number }): SearchIndexWriter {
	return {
		engine: "meilisearch",
		ensure: (ensureOptions) => ensureSearchIndex(service, { ...ensureOptions, taskTimeoutMs: options.taskTimeoutMs }),
		batch: (batchOptions) => writeBatch(service, batchOptions),
		rebuild: (plans, rebuildOptions) => rebuildSearchIndex(service, plans, rebuildOptions),
		async remove(signal) {
			try {
				await waitForSuccessfulTask(service.client.deleteIndex(service.indexName), options.taskTimeoutMs, { signal, taskClient: service.index.tasks });
			} catch (error) {
				if (!taskErrorCode(error, "index_not_found")) throw error;
			}
		},
	};
}
