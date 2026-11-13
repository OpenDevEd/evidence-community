import { setTimeout as delay } from "node:timers/promises";

import { outbox } from "@opendeved/evidence-library-core";
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
import type { LibraryServerConfig } from "@/config/library-config/schema";

import {
	generateFullSearchProjectionPlans,
	generateSearchProjectionPlans,
	type SearchProjectionPlan,
} from "./projection";
import {
	SearchIndexDocumentError,
	SearchOutboxAbortError,
	throwIfAborted,
	type SearchIndexWriter,
	type SearchWriteOptions,
} from "./writer";

export { SearchIndexDocumentError, SearchIndexWriteError, SearchOutboxAbortError } from "./writer";

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
	/** Where the library's records go, in the engine it searches. */
	writer: SearchIndexWriter;
	leaseDurationMs?: number;
	maxDocumentBatchBytes?: number;
	maxAttempts?: number;
	now?: () => Date;
	onProgress?: (progress: SearchOutboxProgress) => Promise<void>;
	/**
	 * Told which records' pages a claim changed, once the claim is acknowledged: the ones written and the ones removed.
	 * A record that has just been hidden is among them, as its page is gone; a child item never is, as it has no page.
	 * Not waited for, and must not throw.
	 */
	onPagesChanged?: (recordKeys: string[]) => void;
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

/** Writes one projection plan to the library's index, searchable once this returns. */
export async function applySearchProjectionPlan(
	writer: SearchIndexWriter,
	plan: SearchProjectionPlan,
	taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
	maxDocumentBatchBytes = DEFAULT_MAX_DOCUMENT_BATCH_BYTES,
	options: Pick<SearchWriteOptions, "signal" | "onProgress" | "eventIds" | "readFrom"> = {},
) {
	const batch = writer.batch({ ...options, taskTimeoutMs, maxDocumentBatchBytes });
	await batch.add(plan);
	await batch.finish();
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
	const batch = options.writer.batch({
		checkLease: () => {
			if (heartbeatFailure()) throw heartbeatFailure();
		},
		eventIds,
		maxDocumentBatchBytes: validated.maxDocumentBatchBytes,
		onProgress: options.onProgress,
		// Before any record is read: a change committed after this time is one the claim may not have seen.
		readFrom: Date.now(),
		signal: options.signal,
		taskTimeoutMs: validated.taskTimeoutMs,
	});
	let deleteCount = 0;
	let documentCount = 0;
	const pageKeys: string[] = [];
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
			// `indexing` names an engine task; until a writer reports one, the claim is still being projected.
			stage: "projecting",
			taskUid: null,
		});
		await batch.add(plan);
		deleteCount += plan.deleteKeys.length;
		documentCount += plan.documents.length;
		for (const document of plan.documents) pageKeys.push(document.key);
		pageKeys.push(...(plan.removedRecordKeys ?? []));
	}
	await batch.finish();
	return { deleteCount, documentCount, pageKeys };
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
		const { deleteCount, documentCount, pageKeys } = await indexClaimedEvents(
			options,
			events,
			validated,
			() => heartbeatFailure,
		);
		if (heartbeatFailure) throw heartbeatFailure;
		await heartbeatEvents(options, events, leaseDurationMs, workerId);
		await acknowledgeEvents(options, events, workerId);
		options.onPagesChanged?.(pageKeys);
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

/** Makes sure the library has an index with this runtime's settings, creating the first one when it has none. */
export function ensureSearchIndex(
	writer: SearchIndexWriter,
	options: {
		onMissing?: () => Promise<void>;
		signal?: AbortSignal;
	} = {},
) {
	return writer.ensure(options);
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
	writer: SearchIndexWriter,
	config: LibraryServerConfig,
	options: { signal?: AbortSignal; taskTimeoutMs?: number } & Pick<SearchOutboxConsumerOptions, "onPagesChanged"> = {},
) {
	const waiting = await database
		.select({ id: outbox.id })
		.from(outbox)
		.where(and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt)));
	const rebuilt = await rebuildSearchIndex(database, writer, config, options);
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
			.returning({ entityKey: outbox.entityKey, entityType: outbox.entityType }));
		acknowledged += rows.length;
		if (options.onPagesChanged) options.onPagesChanged(await recordKeysAmong(database, rows));
	}
	return { ...rebuilt, acknowledged };
}

/** The records among these events' items: a child item has no page of its own. */
async function recordKeysAmong(database: Database, events: readonly { entityKey: string; entityType: string }[]) {
	const keys = [...new Set(events.filter((event) => event.entityType === "item").map((event) => event.entityKey))];
	if (keys.length === 0) return [];
	const records = await database.select({ key: item.key }).from(item).where(and(inArray(item.key, keys), isNull(item.parentItem)));
	return records.map((record) => record.key);
}

/**
 * Rebuilds the library's search from every record. Readers keep finding the old records until the new ones are
 * complete: Elasticsearch fills a new index and moves the alias to it, Meilisearch replaces records in place.
 *
 * While the rebuild reads records, a worker may write a change to the old records and acknowledge its event after the
 * rebuild read that record. Those events are put back afterwards, so the drain writes the change again.
 */
export async function rebuildSearchIndex(
	database: Database,
	writer: SearchIndexWriter,
	config: LibraryServerConfig,
	options: {
		maxDocumentBatchBytes?: number;
		signal?: AbortSignal;
		taskTimeoutMs?: number;
	} = {},
) {
	throwIfAborted(options.signal);
	const startedAt = new Date();
	const rebuilt = await writer.rebuild(generateFullSearchProjectionPlans(database, config, 500, options.signal), {
		maxDocumentBatchBytes: options.maxDocumentBatchBytes ?? DEFAULT_MAX_DOCUMENT_BATCH_BYTES,
		signal: options.signal,
		taskTimeoutMs: options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
		reproject: (keys) =>
			generateSearchProjectionPlans(database, config, keys.map((entityKey) => ({ entityKey, entityType: "item" })), 500, options.signal),
	});
	return { ...rebuilt, redrained: await redrainEventsAcknowledgedSince(database, startedAt) };
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
