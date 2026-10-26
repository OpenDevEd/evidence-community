import { setTimeout as delay } from "node:timers/promises";

import { outbox } from "@opendeved/evidence-library-core";
import { errors as ElasticsearchErrors, type estypes } from "@elastic/elasticsearch";
import {
	and,
	asc,
	count,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { chunkValues } from "@/lib/chunk-values";
import type { SearchService } from "@/lib/elasticsearch-factory";

import {
	generateFullSearchProjectionPlans,
	generateSearchProjectionPlans,
	type SearchProjectionPlan,
} from "./projection";
import { newSearchIndexName, searchIndexDefinition } from "./elasticsearch-index";
import type { LibraryServerConfig } from "@/config/library-config/schema";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 15;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_DOCUMENT_BATCH_BYTES = 20 * 1024 * 1024;
/** Events one drain claim takes; a large import indexes in fewer, bigger batches. */
const DRAIN_BATCH_SIZE = 5_000;
/** Claims one drain works on at once. */
const DRAIN_CONCURRENCY = 3;
const MAX_ERROR_LENGTH = 32 * 1_024;

type ClaimedEvent = typeof outbox.$inferSelect;

export type SearchOutboxConsumerOptions = {
	config: LibraryServerConfig;
	database: Database;
	heartbeatIntervalMs?: number;
	search: SearchService;
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
	constructor(eventId: number, cause?: unknown) {
		super(
			cause === undefined
				? `Search outbox lease was lost for event ${eventId}`
				: `Search outbox lease was lost for event ${eventId} while handling: ${errorMessage(cause)}`,
			cause === undefined ? undefined : { cause },
		);
		this.name = "SearchOutboxLeaseLostError";
	}
}

export class SearchOutboxAbortError extends Error {
	constructor() {
		super("Search outbox processing was aborted");
		this.name = "SearchOutboxAbortError";
	}
}

/**
 * Records Elasticsearch refused for their content. Sending the same claim again can't succeed, so the claim is split
 * until the event behind the record is found and only that event retries.
 */
export class SearchIndexDocumentError extends Error {
	readonly failures: ReadonlyArray<{ key: string; reason: string }>;

	constructor(failures: ReadonlyArray<{ key: string; reason: string }>) {
		super(
			`Elasticsearch rejected ${failures.length} record(s): ${failures
				.slice(0, 3)
				.map(({ key, reason }) => `${key}: ${reason}`)
				.join("; ")}`,
		);
		this.name = "SearchIndexDocumentError";
		this.failures = failures;
	}
}

/** A bulk write Elasticsearch answered for some records with a server-side or overload error; the claim retries. */
export class SearchIndexWriteError extends Error {
	constructor(status: number, reason: string) {
		super(`Elasticsearch could not write records (${status}): ${reason}`);
		this.name = "SearchIndexWriteError";
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

/** No other event for the same entity holds an unexpired lease. */
function noActiveEntityLease(transaction: DatabaseTransaction, claimedAt: Date) {
	const leasedEntity = alias(outbox, "leasedEntity");
	return notExists(
		transaction
			.select({ id: leasedEntity.id })
			.from(leasedEntity)
			.where(
				and(
					eq(leasedEntity.entityType, outbox.entityType),
					eq(leasedEntity.entityKey, outbox.entityKey),
					isNull(leasedEntity.processedAt),
					isNull(leasedEntity.deadLetteredAt),
					isNotNull(leasedEntity.leaseOwner),
					gt(leasedEntity.leaseExpiresAt, claimedAt),
				),
			),
	);
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
		// Claims in one library run one at a time. The lease check below then
		// sees every lease committed before it, so two workers never lease the
		// same entity, with one lock per claim instead of one per claimed row
		// (the lock table is shared by every database on the server).
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtextextended('search-outbox-claim', 0))`,
		);
		const candidates = await transaction
			.select({ id: outbox.id })
			.from(outbox)
			.where(
				and(
					isNull(outbox.processedAt),
					isNull(outbox.deadLetteredAt),
					// A new event's nextAttemptAt is PostgreSQL's now(), in microseconds; claimedAt
					// has milliseconds. Due by either clock, an event inserted this millisecond is
					// claimed now rather than on the next poll.
					lte(outbox.nextAttemptAt, sql`greatest(${claimedAt.toISOString()}::timestamptz, now())`),
					or(
						isNull(outbox.leaseExpiresAt),
						lte(outbox.leaseExpiresAt, claimedAt),
					),
					noActiveEntityLease(transaction, claimedAt),
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

/**
 * Updates events after locking them in entity key order, the order a source
 * import locks them in (`requeueLinkedRecords`). A plain `id IN (...)` update
 * locks in id order, so it could deadlock with an import holding a later id.
 */
function updateInKeyOrder<T>(
	database: Database,
	ids: readonly number[],
	update: (transaction: DatabaseTransaction) => Promise<T>,
) {
	return database.transaction(async (transaction) => {
		await transaction
			.select({ id: outbox.id })
			.from(outbox)
			.where(inArray(outbox.id, [...ids]))
			.orderBy(asc(outbox.entityKey), asc(outbox.id))
			.for("update");
		return update(transaction);
	});
}

/** Events this worker still holds: leased to it and not yet finished. */
function stillLeased(ids: readonly number[], workerId: string) {
	return and(
		inArray(outbox.id, [...ids]),
		eq(outbox.leaseOwner, workerId),
		isNull(outbox.processedAt),
		isNull(outbox.deadLetteredAt),
	);
}

async function releaseEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	workerId: string,
) {
	const ids = events.map(({ id }) => id);
	await updateInKeyOrder(options.database, ids, (transaction) => transaction
		.update(outbox)
		.set({ leaseExpiresAt: null, leaseOwner: null })
		.where(stillLeased(ids, workerId)));
}

async function heartbeatEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	leaseDurationMs: number,
	workerId: string,
) {
	const heartbeatAt = now(options);
	const ids = events.map(({ id }) => id);
	const updated = await updateInKeyOrder(options.database, ids, (transaction) => transaction
		.update(outbox)
		.set({
			leaseExpiresAt: expiresAt(heartbeatAt, leaseDurationMs),
		})
		.where(stillLeased(ids, workerId))
		.returning({ id: outbox.id }));
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
	const ids = events.map(({ id }) => id);
	const acknowledged = await updateInKeyOrder(options.database, ids, (transaction) => transaction
		.update(outbox)
		.set({
			lastError: null,
			leaseExpiresAt: null,
			leaseOwner: null,
			processedAt: now(options),
		})
		.where(stillLeased(ids, workerId))
		.returning({ id: outbox.id }));
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
	// Each event is marked on its own. A lease that was lost on one event
	// must not stop the others from getting their retry time, or they stay
	// leased until the lease expires and block every later event for the
	// same entity.
	const failedAt = now(options);
	const lost: number[] = [];
	for (const event of events) {
		const attempts = event.attempts + 1;
		const retryDelay = Math.min(
			retryMaxMs,
			retryBaseMs * 2 ** Math.min(attempts - 1, 30),
		);
		const [failed] = await options.database
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
		if (!failed) lost.push(event.id);
	}
	return lost;
}

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
		if (outcome === "retry") throw new SearchIndexWriteError(item.status, reason.slice(0, 2_000));
		if (outcome === "refused") rejected.push({ key: String(item._id), reason: reason.slice(0, 500) });
	}
	if (rejected.length > 0) throw new SearchIndexDocumentError(rejected);
}

/**
 * Writes records to one of the library's indexes, in bulk requests no larger than `maxDocumentBatchBytes`, and
 * removes `deleteKeys`. With `searchable`, Elasticsearch answers only once readers can find the change.
 */
async function writeSearchDocuments(
	search: SearchService,
	target: string,
	plan: Pick<SearchProjectionPlan, "deleteKeys" | "documents">,
	options: { maxDocumentBatchBytes: number; searchable: boolean; signal?: AbortSignal; taskTimeoutMs: number },
) {
	if (!Number.isSafeInteger(options.maxDocumentBatchBytes) || options.maxDocumentBatchBytes < 1_024) {
		throw new Error("maxDocumentBatchBytes must be an integer of at least 1,024");
	}
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

/** Writes one projection plan to the library's live index, searchable once this returns. */
export async function applySearchProjectionPlan(
	search: SearchService,
	plan: SearchProjectionPlan,
	taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
	maxDocumentBatchBytes = DEFAULT_MAX_DOCUMENT_BATCH_BYTES,
	options: { signal?: AbortSignal } = {},
) {
	await writeSearchDocuments(search, search.alias, plan, {
		maxDocumentBatchBytes,
		searchable: true,
		signal: options.signal,
		taskTimeoutMs,
	});
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

/**
 * Marks a failed batch for retry and returns the error to throw. When the
 * batch itself failed, that failure is the cause worth recording, even if a
 * heartbeat also lost the lease meanwhile. A lease lost on some events is
 * reported after the others are marked, with the cause attached.
 */
async function markBatchFailed(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	workerId: string,
	failure: {
		error: unknown;
		heartbeatFailure: unknown;
		maxAttempts: number;
		retryBaseMs: number;
		retryMaxMs: number;
	},
): Promise<unknown> {
	const { error, heartbeatFailure } = failure;
	const batchFailed =
		error !== heartbeatFailure &&
		!(error instanceof SearchOutboxAbortError);
	const cause = heartbeatFailure && !batchFailed ? heartbeatFailure : error;
	const lost = await failEvents(
		options,
		events,
		cause,
		workerId,
		failure.maxAttempts,
		failure.retryBaseMs,
		failure.retryMaxMs,
	);
	return lost.length > 0
		? new SearchOutboxLeaseLostError(lost[0]!, cause)
		: cause;
}

/**
 * Projects the claimed events and writes each plan as soon as it is built. The last write waits until readers can
 * find the change, so acknowledging the events afterwards means the change is searchable.
 */
async function indexClaimedEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	validated: ValidatedConsumerOptions,
	heartbeatFailure: () => unknown,
) {
	const eventIds = events.map(({ id }) => id);
	let deleteCount = 0;
	let documentCount = 0;
	for await (const plan of generateSearchProjectionPlans(
		options.database,
		options.config,
		events,
		500,
		options.signal,
	)) {
		throwIfAborted(options.signal);
		if (heartbeatFailure()) throw heartbeatFailure();
		await heartbeatEvents(
			options,
			events,
			validated.leaseDurationMs,
			validated.workerId,
		);
		await options.onProgress?.({
			batchProgress: null,
			batchUid: null,
			eventIds,
			stage: "indexing",
			taskUid: null,
		});
		await applySearchProjectionPlan(
			options.search,
			plan,
			validated.taskTimeoutMs,
			validated.maxDocumentBatchBytes,
			{ signal: options.signal },
		);
		deleteCount += plan.deleteKeys.length;
		documentCount += plan.documents.length;
	}
	return { deleteCount, documentCount };
}

async function processClaimedEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	validated: ValidatedConsumerOptions,
	deferBatchTaskFailure: boolean,
): Promise<SearchOutboxProcessResult> {
	const {
		heartbeatIntervalMs,
		leaseDurationMs,
		maxAttempts,
		retryBaseMs,
		retryMaxMs,
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
		const { deleteCount, documentCount } = await indexClaimedEvents(
			options,
			events,
			validated,
			() => heartbeatFailure,
		);
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
			failure instanceof SearchIndexDocumentError
		) {
			throw failure;
		}
		throw await markBatchFailed(options, events, workerId, {
			error,
			heartbeatFailure,
			maxAttempts,
			retryBaseMs,
			retryMaxMs,
		});
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
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
		throw new Error("batchSize must be an integer between 1 and 5,000");
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
		if (!(error instanceof SearchIndexDocumentError && events.length > 1)) {
			throw error;
		}
		// Elasticsearch rejected a record. Halving the claim finds the event behind
		// it in about 2 x log2(n) writes instead of one write per event.
		const outcome: IsolationOutcome = { failure: undefined, results: [] };
		await isolateRejectedEvents(options, events, validated, outcome);
		if (outcome.failure) throw outcome.failure;
		return outcome.results;
	}
}

type IsolationOutcome = {
	failure: unknown;
	results: SearchOutboxProcessResult[];
};

async function isolateRejectedEvents(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	validated: ValidatedConsumerOptions,
	outcome: IsolationOutcome,
) {
	const middle = Math.ceil(events.length / 2);
	const halves = [events.slice(0, middle), events.slice(middle)];
	for (const [index, half] of halves.entries()) {
		// The half still waiting keeps its leases, so no other lane or worker
		// claims it while this half is indexed.
		await whileLeasesRenewed(
			options,
			halves.slice(index + 1).flat(),
			validated,
			async () => {
				try {
					outcome.results.push(
						await processClaimedEvents(
							options,
							half,
							validated,
							half.length > 1,
						),
					);
				} catch (error) {
					if (half.length > 1 && error instanceof SearchIndexDocumentError) {
						await isolateRejectedEvents(options, half, validated, outcome);
					} else {
						outcome.failure ??= error;
					}
				}
			},
		);
	}
}

async function whileLeasesRenewed(
	options: SearchOutboxConsumerOptions,
	events: readonly ClaimedEvent[],
	validated: ValidatedConsumerOptions,
	work: () => Promise<void>,
) {
	if (events.length === 0) return work();
	const abortController = new AbortController();
	let heartbeatFailure: unknown;
	const loop = heartbeatLoop(
		options,
		events,
		validated.heartbeatIntervalMs,
		validated.leaseDurationMs,
		validated.workerId,
		abortController.signal,
		(error) => {
			heartbeatFailure = error;
		},
	);
	try {
		await work();
	} finally {
		abortController.abort();
		await loop;
	}
	if (heartbeatFailure) throw heartbeatFailure;
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
	// Several claims run at once, so one is projected while Elasticsearch
	// writes another. Claims never share an entity (see claimEvents).
	const drain = { failed: false, reserved: 0, results: [] as SearchOutboxProcessResult[] };
	const lanes = await Promise.allSettled(
		Array.from({ length: DRAIN_CONCURRENCY }, (_, lane) =>
			drainLane(
				{
					...options,
					// Each lane owns its leases, so heartbeats and acknowledgements
					// never touch another lane's events.
					workerId: `${options.workerId}:${lane + 1}`,
					// One lane reports progress; three would rewrite the worker
					// state on every poll.
					onProgress: lane === 0 ? options.onProgress : undefined,
				},
				maxEvents,
				drain,
			),
		),
	);
	const failure = lanes.find((lane) => lane.status === "rejected");
	if (failure) throw failure.reason;
	return drain.results;
}

async function drainLane(
	options: SearchOutboxConsumerOptions,
	maxEvents: number,
	drain: { failed: boolean; reserved: number; results: SearchOutboxProcessResult[] },
) {
	while (!drain.failed && drain.reserved < maxEvents) {
		throwIfAborted(options.signal);
		const batchSize = Math.min(DRAIN_BATCH_SIZE, maxEvents - drain.reserved);
		drain.reserved += batchSize;
		try {
			const batchResults = await processNextSearchOutboxBatch({
				...options,
				batchSize,
			});
			const processed = (batchResults ?? []).reduce(
				(total, result) => total + result.eventIds.length,
				0,
			);
			drain.reserved -= batchSize - processed;
			if (!batchResults) return;
			drain.results.push(...batchResults);
		} catch (error) {
			drain.failed = true;
			throw error;
		}
	}
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

/** Makes sure the library's alias points to an index, creating the first one when it has none. */
export async function ensureSearchIndex(
	search: SearchService,
	options: {
		onMissing?: () => Promise<void>;
		signal?: AbortSignal;
	} = {},
) {
	throwIfAborted(options.signal);
	const live = await liveSearchIndex(search, options.signal);
	if (live === null) {
		await options.onMissing?.();
		throwIfAborted(options.signal);
		const index = newSearchIndexName(search.alias);
		await createSearchIndex(search, index, { bulkLoad: false, signal: options.signal });
		await search.client.indices.updateAliases(
			{ actions: [{ add: { index, alias: search.alias, is_write_index: true } }] },
			{ signal: options.signal },
		);
		return { created: true };
	}
	return { created: false };
}

/**
 * Rebuilding beats draining the outbox once this many events wait and they
 * cover at least a quarter of the records: a first import of 1M records took
 * 2 h through the drain and 37 min as a rebuild.
 */
const BACKLOG_REBUILD_MIN_EVENTS = 50_000;

/** The number of waiting events when a rebuild should index them, else 0. */
export async function outboxBacklogForRebuild(database: Database) {
	const waiting = and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt));
	const sample = await database
		.select({ id: outbox.id })
		.from(outbox)
		.where(waiting)
		.limit(BACKLOG_REBUILD_MIN_EVENTS);
	if (sample.length < BACKLOG_REBUILD_MIN_EVENTS) return 0;
	const [[{ pending }], [{ records }]] = await Promise.all([
		database.select({ pending: count() }).from(outbox).where(waiting),
		database
			.select({ records: count() })
			.from(item)
			.where(isNull(item.parentItem)),
	]);
	return pending * 4 >= records ? pending : 0;
}

/**
 * Indexes a large outbox backlog with a rebuild, then acknowledges the events
 * that were waiting before it started. The rebuild reads every record after
 * those events were committed, so it indexed what they describe. Events
 * written during the rebuild stay queued for the drain.
 */
export async function rebuildForOutboxBacklog(
	database: Database,
	search: SearchService,
	config: LibraryServerConfig,
	options: { signal?: AbortSignal; taskTimeoutMs?: number } = {},
) {
	const waiting = await database
		.select({ id: outbox.id })
		.from(outbox)
		.where(and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt)));
	const rebuilt = await rebuildSearchIndex(database, search, config, options);
	const acknowledgedAt = new Date();
	let acknowledged = 0;
	for (const ids of chunkValues(
		waiting.map(({ id }) => id),
		10_000,
	)) {
		throwIfAborted(options.signal);
		const rows = await updateInKeyOrder(database, ids, (transaction) => transaction
			.update(outbox)
			.set({
				lastError: null,
				leaseExpiresAt: null,
				leaseOwner: null,
				processedAt: acknowledgedAt,
			})
			.where(
				and(
					inArray(outbox.id, ids),
					isNull(outbox.processedAt),
					isNull(outbox.deadLetteredAt),
					// An event another worker is still processing stays its own.
					or(
						isNull(outbox.leaseExpiresAt),
						lte(outbox.leaseExpiresAt, acknowledgedAt),
					),
				),
			)
			.returning({ id: outbox.id }));
		acknowledged += rows.length;
	}
	return { ...rebuilt, acknowledged };
}

/**
 * Rebuilds the library's search into a new index and moves the alias to it in one step, so readers keep searching
 * the old index until the new one is complete. The indexes it replaces, and any a stopped rebuild left behind, are
 * deleted afterwards. One write is in flight while the next batch of records is projected.
 *
 * While the rebuild reads records, a worker may write a change to the old index and acknowledge its event after the
 * rebuild read that record. Those events are put back once the alias moves, so the drain writes the change again.
 */
export async function rebuildSearchIndex(
	database: Database,
	search: SearchService,
	config: LibraryServerConfig,
	options: {
		maxDocumentBatchBytes?: number;
		signal?: AbortSignal;
		taskTimeoutMs?: number;
	} = {},
) {
	const writeOptions = {
		maxDocumentBatchBytes: options.maxDocumentBatchBytes ?? DEFAULT_MAX_DOCUMENT_BATCH_BYTES,
		searchable: false,
		signal: options.signal,
		taskTimeoutMs: options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
	};
	throwIfAborted(options.signal);
	const startedAt = new Date();
	const target = newSearchIndexName(search.alias);
	await createSearchIndex(search, target, { bulkLoad: true, signal: options.signal });
	let indexed = 0;
	let failure: unknown;
	let writing = Promise.resolve();
	for await (const plan of generateFullSearchProjectionPlans(database, config, 500, options.signal)) {
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
	const resolved = await search.client.indices.resolveIndex({ name: `${search.alias}_*` }, { signal: options.signal });
	const replaced = resolved.indices.map((index) => index.name).filter((name) => name !== target);
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
	return { indexed, replacedIndexes: replaced.length, redrained: await redrainEventsAcknowledgedSince(database, startedAt) };
}

async function redrainEventsAcknowledgedSince(database: Database, since: Date) {
	const acknowledged = await database
		.select({ id: outbox.id })
		.from(outbox)
		.where(and(gte(outbox.processedAt, since), isNull(outbox.deadLetteredAt)));
	for (const ids of chunkValues(acknowledged.map(({ id }) => id), 10_000)) {
		await updateInKeyOrder(database, ids, (transaction) =>
			transaction.update(outbox).set({ processedAt: null }).where(inArray(outbox.id, ids)),
		);
	}
	return acknowledged.length;
}
