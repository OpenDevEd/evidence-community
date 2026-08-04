import { setTimeout as delay } from "node:timers/promises";

import { outbox } from "@opendeved/evidence-library-core";
import {
	MeilisearchApiError,
	MeilisearchTaskTimeOutError,
	type Index,
	type Meilisearch,
	type Task,
} from "meilisearch";
import {
	and,
	asc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lte,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/database-schema";
import type { MeilisearchService } from "@/lib/meilisearch-factory";

import {
	generateFullSearchProjectionPlans,
	generateSearchProjectionPlans,
	type SearchProjectionPlan,
} from "./projection";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 15;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_DOCUMENT_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_LENGTH = 32 * 1_024;

type ClaimedEvent = typeof outbox.$inferSelect;

export type SearchOutboxConsumerOptions = {
	batchClient?: Meilisearch["batches"];
	database: Database;
	heartbeatIntervalMs?: number;
	index: Index;
	leaseDurationMs?: number;
	maxDocumentBatchBytes?: number;
	maxAttempts?: number;
	now?: () => Date;
	onProgress?: (progress: SearchOutboxProgress) => Promise<void>;
	retryBaseMs?: number;
	retryMaxMs?: number;
	signal?: AbortSignal;
	taskTimeoutMs?: number;
	workerId: string;
};

export type SearchOutboxProgress = {
	batchProgress: number | null;
	batchUid: number | null;
	eventIds: number[];
	stage: "indexing" | "projecting" | "waiting";
	taskUid: number | null;
};

export type SearchOutboxProcessResult = {
	deleteCount: number;
	documentCount: number;
	eventIds: number[];
	status: "processed";
};

export class SearchOutboxLeaseLostError extends Error {
	constructor(eventId: number) {
		super(`Search outbox lease was lost for event ${eventId}`);
		this.name = "SearchOutboxLeaseLostError";
	}
}

export class SearchOutboxAbortError extends Error {
	constructor() {
		super("Search outbox processing was aborted");
		this.name = "SearchOutboxAbortError";
	}
}

export class SearchIndexTaskError extends Error {
	readonly task: Task;

	constructor(task: Task) {
		super(
			`Meilisearch task ${task.uid} ${task.status}: ${task.error?.message ?? "unknown error"}`,
		);
		this.name = "SearchIndexTaskError";
		this.task = task;
	}
}

function validateOptions(options: SearchOutboxConsumerOptions) {
	const workerId = options.workerId.trim();
	if (!workerId || workerId.length > 255) {
		throw new Error("workerId must contain 1-255 characters");
	}
	const leaseDurationMs =
		options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
	const heartbeatIntervalMs =
		options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
	const maxDocumentBatchBytes =
		options.maxDocumentBatchBytes ?? DEFAULT_MAX_DOCUMENT_BATCH_BYTES;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
	const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
	const taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(leaseDurationMs) ||
		leaseDurationMs < 1_000 ||
		leaseDurationMs > 60 * 60 * 1_000
	) {
		throw new Error(
			"leaseDurationMs must be an integer between 1,000 and 3,600,000",
		);
	}
	if (
		!Number.isSafeInteger(heartbeatIntervalMs) ||
		heartbeatIntervalMs < 100 ||
		heartbeatIntervalMs >= leaseDurationMs
	) {
		throw new Error(
			"heartbeatIntervalMs must be an integer of at least 100 and less than leaseDurationMs",
		);
	}
	if (
		!Number.isSafeInteger(maxDocumentBatchBytes) ||
		maxDocumentBatchBytes < 1_024 ||
		maxDocumentBatchBytes > 90 * 1024 * 1024
	) {
		throw new Error(
			"maxDocumentBatchBytes must be an integer between 1,024 and 94,371,840",
		);
	}
	if (
		!Number.isSafeInteger(maxAttempts) ||
		maxAttempts < 1 ||
		maxAttempts > 100
	) {
		throw new Error("maxAttempts must be an integer between 1 and 100");
	}
	if (
		!Number.isSafeInteger(retryBaseMs) ||
		retryBaseMs < 100 ||
		!Number.isSafeInteger(retryMaxMs) ||
		retryMaxMs < retryBaseMs
	) {
		throw new Error(
			"retry delays must be safe integers and retryMaxMs must be at least retryBaseMs",
		);
	}
	if (!Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1_000) {
		throw new Error("taskTimeoutMs must be an integer of at least 1,000");
	}
	return {
		heartbeatIntervalMs,
		leaseDurationMs,
		maxDocumentBatchBytes,
		maxAttempts,
		retryBaseMs,
		retryMaxMs,
		taskTimeoutMs,
		workerId,
	};
}

function now(options: SearchOutboxConsumerOptions) {
	return (options.now ?? (() => new Date()))();
}

function expiresAt(value: Date, leaseDurationMs: number) {
	return new Date(value.getTime() + leaseDurationMs);
}

function errorMessage(error: unknown) {
	return (
		error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error)
	).slice(0, MAX_ERROR_LENGTH);
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new SearchOutboxAbortError();
}

async function abortable<T>(promise: PromiseLike<T>, signal?: AbortSignal) {
	throwIfAborted(signal);
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new SearchOutboxAbortError());
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(promise)
			.then(resolve, reject)
			.finally(() => {
				signal.removeEventListener("abort", abort);
			});
	});
}

async function claimEvents(
	options: SearchOutboxConsumerOptions,
	leaseDurationMs: number,
	workerId: string,
	limit: number,
) {
	throwIfAborted(options.signal);
	const claimedAt = now(options);
	return options.database.transaction(async (transaction) => {
		const leasedEntity = alias(outbox, "leasedEntity");
		const candidates = await transaction
			.select()
			.from(outbox)
			.where(
				and(
					isNull(outbox.processedAt),
					isNull(outbox.deadLetteredAt),
					lte(outbox.nextAttemptAt, claimedAt),
					or(
						isNull(outbox.leaseExpiresAt),
						lte(outbox.leaseExpiresAt, claimedAt),
					),
					notExists(
						transaction
							.select({ id: leasedEntity.id })
							.from(leasedEntity)
							.where(
								and(
									eq(
										leasedEntity.entityType,
										outbox.entityType,
									),
									eq(
										leasedEntity.entityKey,
										outbox.entityKey,
									),
									isNull(leasedEntity.processedAt),
									isNull(leasedEntity.deadLetteredAt),
									isNotNull(leasedEntity.leaseOwner),
									gt(leasedEntity.leaseExpiresAt, claimedAt),
								),
							),
					),
					sql<boolean>`pg_try_advisory_xact_lock(hashtextextended(${outbox.entityType} || ':' || ${outbox.entityKey}, 0))`,
				),
			)
			.orderBy(asc(outbox.id))
			.for("update", { skipLocked: true })
			.limit(limit);
		if (candidates.length === 0) return [];

		return transaction
			.update(outbox)
			.set({
				leaseExpiresAt: expiresAt(claimedAt, leaseDurationMs),
				leaseOwner: workerId,
			})
			.where(
				inArray(
					outbox.id,
					candidates.map(({ id }) => id),
				),
			)
			.returning();
	});
}

async function releaseEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	workerId: string,
) {
	await options.database
		.update(outbox)
		.set({ leaseExpiresAt: null, leaseOwner: null })
		.where(
			and(
				inArray(
					outbox.id,
					events.map(({ id }) => id),
				),
				eq(outbox.leaseOwner, workerId),
				isNull(outbox.processedAt),
				isNull(outbox.deadLetteredAt),
			),
		);
}

async function heartbeatEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	leaseDurationMs: number,
	workerId: string,
) {
	const heartbeatAt = now(options);
	const updated = await options.database
		.update(outbox)
		.set({
			leaseExpiresAt: expiresAt(heartbeatAt, leaseDurationMs),
		})
		.where(
			and(
				inArray(
					outbox.id,
					events.map(({ id }) => id),
				),
				eq(outbox.leaseOwner, workerId),
				isNull(outbox.processedAt),
				isNull(outbox.deadLetteredAt),
			),
		)
		.returning({ id: outbox.id });
	if (updated.length !== events.length) {
		throw new SearchOutboxLeaseLostError(events[0]!.id);
	}
}

async function heartbeatLoop(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	heartbeatIntervalMs: number,
	leaseDurationMs: number,
	workerId: string,
	signal: AbortSignal,
	onFailure: (error: unknown) => void,
) {
	while (!signal.aborted) {
		try {
			await delay(heartbeatIntervalMs, undefined, { signal });
		} catch (error) {
			if (signal.aborted) return;
			onFailure(error);
			return;
		}
		try {
			await heartbeatEvents(options, events, leaseDurationMs, workerId);
		} catch (error) {
			onFailure(error);
			return;
		}
	}
}

async function acknowledgeEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	workerId: string,
) {
	const acknowledged = await options.database
		.update(outbox)
		.set({
			lastError: null,
			leaseExpiresAt: null,
			leaseOwner: null,
			processedAt: now(options),
		})
		.where(
			and(
				inArray(
					outbox.id,
					events.map(({ id }) => id),
				),
				eq(outbox.leaseOwner, workerId),
				isNull(outbox.processedAt),
				isNull(outbox.deadLetteredAt),
			),
		)
		.returning({ id: outbox.id });
	if (acknowledged.length !== events.length) {
		throw new SearchOutboxLeaseLostError(events[0]!.id);
	}
}

async function failEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	error: unknown,
	workerId: string,
	maxAttempts: number,
	retryBaseMs: number,
	retryMaxMs: number,
) {
	const failedAt = now(options);
	await options.database.transaction(async (transaction) => {
		for (const event of events) {
			const attempts = event.attempts + 1;
			const retryDelay = Math.min(
				retryMaxMs,
				retryBaseMs * 2 ** Math.min(attempts - 1, 30),
			);
			const [failed] = await transaction
				.update(outbox)
				.set({
					attempts,
					deadLetteredAt: attempts >= maxAttempts ? failedAt : null,
					lastError: errorMessage(error),
					leaseExpiresAt: null,
					leaseOwner: null,
					nextAttemptAt: new Date(failedAt.getTime() + retryDelay),
				})
				.where(
					and(
						eq(outbox.id, event.id),
						eq(outbox.leaseOwner, workerId),
						isNull(outbox.processedAt),
						isNull(outbox.deadLetteredAt),
					),
				)
				.returning({ id: outbox.id });
			if (!failed) {
				throw new SearchOutboxLeaseLostError(event.id);
			}
		}
	});
}

async function waitForSuccessfulTask(
	taskPromise: ReturnType<Index["addDocuments"]>,
	taskTimeoutMs: number,
	options: {
		batchClient?: Meilisearch["batches"];
		eventIds?: number[];
		onProgress?: SearchOutboxConsumerOptions["onProgress"];
		signal?: AbortSignal;
		taskClient?: Index["tasks"];
	} = {},
) {
	if (!options.taskClient) {
		const task = await taskPromise.waitTask({
			interval: 50,
			timeout: taskTimeoutMs,
		});
		if (task.status !== "succeeded") throw new SearchIndexTaskError(task);
		return task;
	}
	const enqueued = await abortable(taskPromise, options.signal);
	const eventIds = options.eventIds ?? [];
	let lastProgressSignature = "";
	const reportProgress = async (progress: SearchOutboxProgress) => {
		const signature = JSON.stringify(progress);
		if (signature === lastProgressSignature) return;
		lastProgressSignature = signature;
		await options.onProgress?.(progress);
	};
	await reportProgress({
		batchProgress: null,
		batchUid: null,
		eventIds,
		stage: "waiting",
		taskUid: enqueued.taskUid,
	});
	const deadline = Date.now() + taskTimeoutMs;
	while (Date.now() <= deadline) {
		throwIfAborted(options.signal);
		const task = await abortable(
			options.taskClient.getTask(enqueued.taskUid, {
				signal: options.signal,
			}),
			options.signal,
		);
		let batchProgress: number | null = null;
		if (task.batchUid !== null && options.batchClient) {
			try {
				const batch = await abortable(
					options.batchClient.getBatch(task.batchUid),
					options.signal,
				);
				batchProgress = batch.progress?.percentage ?? null;
			} catch (error) {
				if (error instanceof SearchOutboxAbortError) throw error;
				// Batch telemetry is optional; task status remains authoritative.
			}
		}
		if (task.status === "enqueued" || task.status === "processing") {
			await reportProgress({
				batchProgress,
				batchUid: task.batchUid,
				eventIds,
				stage: task.status === "enqueued" ? "waiting" : "indexing",
				taskUid: task.uid,
			});
			try {
				await delay(100, undefined, { signal: options.signal });
			} catch (error) {
				if (options.signal?.aborted) throw new SearchOutboxAbortError();
				throw error;
			}
			continue;
		}
		await reportProgress({
			batchProgress:
				task.status === "succeeded" && task.batchUid !== null
					? 100
					: batchProgress,
			batchUid: task.batchUid,
			eventIds,
			stage: "indexing",
			taskUid: task.uid,
		});
		if (task.status === "succeeded") return task;
		throw new SearchIndexTaskError(task);
	}
	throw new MeilisearchTaskTimeOutError(enqueued.taskUid, taskTimeoutMs);
}

export async function applySearchProjectionPlan(
	index: Index,
	plan: SearchProjectionPlan,
	taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
	maxDocumentBatchBytes = DEFAULT_MAX_DOCUMENT_BATCH_BYTES,
	progressOptions: {
		batchClient?: Meilisearch["batches"];
		eventIds?: number[];
		onProgress?: SearchOutboxConsumerOptions["onProgress"];
		signal?: AbortSignal;
	} = {},
) {
	if (
		!Number.isSafeInteger(maxDocumentBatchBytes) ||
		maxDocumentBatchBytes < 1_024
	) {
		throw new Error(
			"maxDocumentBatchBytes must be an integer of at least 1,024",
		);
	}
	for (const documents of chunkDocumentsBySerializedBytes(
		plan.documents,
		maxDocumentBatchBytes,
	)) {
		await waitForSuccessfulTask(
			index.addDocuments(documents, {
				primaryKey: "key",
			}),
			taskTimeoutMs,
			{ ...progressOptions, taskClient: index.tasks },
		);
	}
	if (plan.deleteKeys.length > 0) {
		await waitForSuccessfulTask(
			index.deleteDocuments(plan.deleteKeys),
			taskTimeoutMs,
			{ ...progressOptions, taskClient: index.tasks },
		);
	}
}

function chunkDocumentsBySerializedBytes(
	documents: SearchProjectionPlan["documents"],
	maxBytes: number,
) {
	const chunks: Array<SearchProjectionPlan["documents"]> = [];
	let chunk: SearchProjectionPlan["documents"] = [];
	let chunkBytes = 2;
	for (const document of documents) {
		const documentBytes = Buffer.byteLength(
			JSON.stringify(document),
			"utf8",
		);
		const nextBytes =
			chunkBytes + documentBytes + (chunk.length > 0 ? 1 : 0);
		if (chunk.length > 0 && nextBytes > maxBytes) {
			chunks.push(chunk);
			chunk = [];
			chunkBytes = 2;
		}
		chunk.push(document);
		chunkBytes += documentBytes + (chunk.length > 1 ? 1 : 0);
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}

type ValidatedConsumerOptions = ReturnType<typeof validateOptions>;

async function processClaimedEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	validated: ValidatedConsumerOptions,
	deferBatchTaskFailure: boolean,
): Promise<SearchOutboxProcessResult> {
	const {
		heartbeatIntervalMs,
		leaseDurationMs,
		maxDocumentBatchBytes,
		maxAttempts,
		retryBaseMs,
		retryMaxMs,
		taskTimeoutMs,
		workerId,
	} = validated;
	const abortController = new AbortController();
	let heartbeatFailure: unknown;
	const loop = heartbeatLoop(
		options,
		events,
		heartbeatIntervalMs,
		leaseDurationMs,
		workerId,
		abortController.signal,
		(error) => {
			heartbeatFailure = error;
		},
	);

	try {
		throwIfAborted(options.signal);
		await options.onProgress?.({
			batchProgress: null,
			batchUid: null,
			eventIds: events.map(({ id }) => id),
			stage: "projecting",
			taskUid: null,
		});
		let deleteCount = 0;
		let documentCount = 0;
		for await (const plan of generateSearchProjectionPlans(
			options.database,
			events,
			500,
			options.signal,
		)) {
			throwIfAborted(options.signal);
			if (heartbeatFailure) throw heartbeatFailure;
			await heartbeatEvents(options, events, leaseDurationMs, workerId);
			await applySearchProjectionPlan(
				options.index,
				plan,
				taskTimeoutMs,
				maxDocumentBatchBytes,
				{
					batchClient: options.batchClient,
					eventIds: events.map(({ id }) => id),
					onProgress: options.onProgress,
					signal: options.signal,
				},
			);
			deleteCount += plan.deleteKeys.length;
			documentCount += plan.documents.length;
		}
		if (heartbeatFailure) throw heartbeatFailure;
		await heartbeatEvents(options, events, leaseDurationMs, workerId);
		await acknowledgeEvents(options, events, workerId);
		return {
			deleteCount,
			documentCount,
			eventIds: events.map(({ id }) => id),
			status: "processed",
		};
	} catch (error) {
		const failure = heartbeatFailure ?? error;
		if (
			!heartbeatFailure &&
			(failure instanceof SearchOutboxAbortError ||
				options.signal?.aborted)
		) {
			await releaseEvents(options, events, workerId);
			throw new SearchOutboxAbortError();
		}
		if (
			deferBatchTaskFailure &&
			!heartbeatFailure &&
			failure instanceof SearchIndexTaskError
		) {
			throw failure;
		}
		await failEvents(
			options,
			events,
			failure,
			workerId,
			maxAttempts,
			retryBaseMs,
			retryMaxMs,
		);
		throw failure;
	} finally {
		abortController.abort();
		await loop;
	}
}

export async function processNextSearchOutboxBatch(
	options: SearchOutboxConsumerOptions & {
		batchSize?: number;
	},
): Promise<SearchOutboxProcessResult[] | null> {
	const batchSize = options.batchSize ?? 100;
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
		throw new Error("batchSize must be an integer between 1 and 500");
	}
	const validated = validateOptions(options);
	throwIfAborted(options.signal);
	const events = await claimEvents(
		options,
		validated.leaseDurationMs,
		validated.workerId,
		batchSize,
	);
	if (events.length === 0) return null;

	try {
		return [
			await processClaimedEvents(
				options,
				events,
				validated,
				events.length > 1,
			),
		];
	} catch (error) {
		if (!(error instanceof SearchIndexTaskError && events.length > 1)) {
			throw error;
		}

		const results: SearchOutboxProcessResult[] = [];
		let firstFailure: unknown;
		for (const event of events) {
			try {
				results.push(
					await processClaimedEvents(
						options,
						[event],
						validated,
						false,
					),
				);
			} catch (eventError) {
				firstFailure ??= eventError;
			}
		}
		if (firstFailure) throw firstFailure;
		return results;
	}
}

export async function processNextSearchOutboxEvent(
	options: SearchOutboxConsumerOptions,
): Promise<SearchOutboxProcessResult | null> {
	const results = await processNextSearchOutboxBatch({
		...options,
		batchSize: 1,
	});
	return results?.[0] ?? null;
}

export async function drainSearchOutbox(
	options: SearchOutboxConsumerOptions & {
		maxEvents?: number;
	},
) {
	const maxEvents = options.maxEvents ?? 10_000;
	if (
		!Number.isSafeInteger(maxEvents) ||
		maxEvents < 1 ||
		maxEvents > 1_000_000
	) {
		throw new Error("maxEvents must be an integer between 1 and 1,000,000");
	}
	const results: SearchOutboxProcessResult[] = [];
	let processedEvents = 0;
	while (processedEvents < maxEvents) {
		throwIfAborted(options.signal);
		const batchResults = await processNextSearchOutboxBatch({
			...options,
			batchSize: Math.min(100, maxEvents - processedEvents),
		});
		if (!batchResults) break;
		results.push(...batchResults);
		processedEvents += batchResults.reduce(
			(total, result) => total + result.eventIds.length,
			0,
		);
	}
	return results;
}

export type SearchOutboxReceiptSelector = {
	entityKey: string;
	entityType: "collection" | "item";
	revision: number;
};

export async function requeueSearchOutboxDeadLetters(
	database: Database,
	options: {
		receipts?: readonly SearchOutboxReceiptSelector[];
		requeuedAt?: Date;
	} = {},
) {
	if (options.receipts?.length === 0) return [];
	const receiptFilter = options.receipts
		? or(
				...options.receipts.map((receipt) =>
					and(
						eq(outbox.entityType, receipt.entityType),
						eq(outbox.entityKey, receipt.entityKey),
						eq(outbox.revision, receipt.revision),
					),
				),
			)
		: undefined;
	const rows = await database
		.update(outbox)
		.set({
			attempts: 0,
			deadLetteredAt: null,
			lastError: null,
			leaseExpiresAt: null,
			leaseOwner: null,
			nextAttemptAt: options.requeuedAt ?? new Date(),
		})
		.where(
			and(
				isNull(outbox.processedAt),
				isNotNull(outbox.deadLetteredAt),
				receiptFilter,
			),
		)
		.returning({
			entityKey: outbox.entityKey,
			entityType: outbox.entityType,
			revision: outbox.revision,
		});
	return rows;
}

export async function ensureSearchIndex(
	service: MeilisearchService,
	options: {
		signal?: AbortSignal;
		taskTimeoutMs?: number;
	} = {},
) {
	const taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
	throwIfAborted(options.signal);
	try {
		await abortable(
			service.client.getRawIndex(service.indexName),
			options.signal,
		);
	} catch (error) {
		if (!(
			error instanceof MeilisearchApiError &&
			error.cause?.code === "index_not_found"
		)) {
			throw error;
		}
		try {
			await waitForSuccessfulTask(
				service.client.createIndex(service.indexName, {
					primaryKey: "key",
				}),
				taskTimeoutMs,
				{
					signal: options.signal,
					taskClient: service.index.tasks,
				},
			);
		} catch (creationError) {
			if (!(
				creationError instanceof SearchIndexTaskError &&
				creationError.task.error?.code === "index_already_exists"
			)) {
				throw creationError;
			}
		}
	}

	await waitForSuccessfulTask(
		service.index.updateSettings({
			faceting: {
				maxValuesPerFacet: 10_000,
				sortFacetValuesBy: {
					collectionsAncestry: "count",
					country: "count",
					institution: "count",
				},
			},
			filterableAttributes: [
				"itemType",
				"deleted",
				"tags",
				"institution",
				"country",
				"creators.institutions.country_code",
				"fullNames",
				"collections",
				"collectionsAncestry",
				"datePublished",
				"year",
				"key",
				"provider",
				"sourceConnectionKey",
			],
			pagination: { maxTotalHits: 1_000_000 },
			searchableAttributes: ["*"],
			sortableAttributes: [
				"datePublished",
				"fullNames",
				"title",
				"year",
				"dateAdded",
				"updatedAt",
			],
		}),
		taskTimeoutMs,
		{
			signal: options.signal,
			taskClient: service.index.tasks,
		},
	);
}

export async function rebuildSearchIndex(
	database: Database,
	service: MeilisearchService,
	options: {
		maxDocumentBatchBytes?: number;
		signal?: AbortSignal;
		taskTimeoutMs?: number;
	} = {},
) {
	const taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
	const maxDocumentBatchBytes =
		options.maxDocumentBatchBytes ?? DEFAULT_MAX_DOCUMENT_BATCH_BYTES;
	await ensureSearchIndex(service, options);
	await waitForSuccessfulTask(
		service.index.deleteAllDocuments(),
		taskTimeoutMs,
		{ signal: options.signal, taskClient: service.index.tasks },
	);
	let deleted = 0;
	let indexed = 0;
	for await (const plan of generateFullSearchProjectionPlans(
		database,
		500,
		options.signal,
	)) {
		throwIfAborted(options.signal);
		await applySearchProjectionPlan(
			service.index,
			plan,
			taskTimeoutMs,
			maxDocumentBatchBytes,
			{ signal: options.signal },
		);
		deleted += plan.deleteKeys.length;
		indexed += plan.documents.length;
	}
	return { deleted, indexed };
}
