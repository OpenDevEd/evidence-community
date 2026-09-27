import { setTimeout as delay } from "node:timers/promises";

import {
	outbox,
	sourceConnection,
	sourceSyncRun,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { PARENT_REQUIRED_ITEM_TYPES } from "@/lib/admin/item-fields";

import {
	isSyncableSourceProvider,
	parseSourceSyncResult,
	type SourceAdapterRegistry,
	type SourceConnection,
	type SourceSyncResult,
	type SyncableSourceProvider,
} from "./adapter";
import { chunkValues } from "@/lib/chunk-values";
import type { SourceCredentialResolver } from "./credentials";
import { classifySourceError } from "./source-status";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1_000;
const MAX_ERROR_LENGTH = 32 * 1_024;
const MAX_WORKER_ID_LENGTH = 255;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type ClaimedRun = {
	connection: SourceConnection;
	runId: number;
};

export type SourceOrchestratorOptions = {
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	heartbeatIntervalMs?: number;
	leaseDurationMs?: number;
	now?: () => Date;
	registry: SourceAdapterRegistry;
	workerId: string;
};

type SourceConnectionRunOptions = SourceOrchestratorOptions & {
	sourceConnectionKey: string;
};

export type SourceRunOutcome = {
	connectionKey: string;
	provider: SyncableSourceProvider;
	result: SourceSyncResult;
	runId: number;
	status: "succeeded";
};

export type SourceRunSweepResult =
	| SourceRunOutcome
	| {
			connectionKey: string;
			error: string;
			status: "failed";
	  }
	| {
			connectionKey: string;
			status: "busy";
	  };

export class SourceConnectionNotFoundError extends Error {
	constructor(sourceConnectionKey: string) {
		super(`Source connection was not found: ${sourceConnectionKey}`);
		this.name = "SourceConnectionNotFoundError";
	}
}

export class SourceConnectionNotRunnableError extends Error {
	constructor(sourceConnectionKey: string, reason: string) {
		super(
			`Source connection cannot be synchronized: ${sourceConnectionKey} (${reason})`,
		);
		this.name = "SourceConnectionNotRunnableError";
	}
}

export class SourceLeaseUnavailableError extends Error {
	constructor(sourceConnectionKey: string) {
		super(`Source connection already has an active lease: ${sourceConnectionKey}`);
		this.name = "SourceLeaseUnavailableError";
	}
}

export class SourceLeaseLostError extends Error {
	constructor(sourceConnectionKey: string) {
		super(`Source connection lease was lost: ${sourceConnectionKey}`);
		this.name = "SourceLeaseLostError";
	}
}

function validateOptions(options: SourceOrchestratorOptions) {
	const workerId = options.workerId.trim();
	if (!workerId || workerId.length > MAX_WORKER_ID_LENGTH) {
		throw new Error(
			`workerId must contain 1-${MAX_WORKER_ID_LENGTH} characters`,
		);
	}
	const leaseDurationMs =
		options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
	const heartbeatIntervalMs =
		options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
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
	return { heartbeatIntervalMs, leaseDurationMs, workerId };
}

function errorMessage(error: unknown) {
	const message =
		error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error);
	return message.slice(0, MAX_ERROR_LENGTH);
}

function expiryFrom(now: Date, leaseDurationMs: number) {
	return new Date(now.getTime() + leaseDurationMs);
}

const EXPIRED_RUN_ERROR = "SourceLeaseLostError: worker lease expired";

/**
 * Marks runs whose worker died as failed. Their batches stay written, so what
 * they changed is counted as a failed run's is.
 */
async function closeExpiredRuns(transaction: Transaction, sourceConnectionKey: string, now: Date) {
	const expiredRuns = await transaction
		.update(sourceSyncRun)
		.set({ error: EXPIRED_RUN_ERROR, finishedAt: now, heartbeatAt: now, status: "failed" })
		.where(
			and(
				eq(sourceSyncRun.sourceConnectionKey, sourceConnectionKey),
				eq(sourceSyncRun.status, "running"),
			),
		)
		.returning({ id: sourceSyncRun.id });
	let changedPatch = {};
	for (const run of expiredRuns) {
		changedPatch = { ...changedPatch, ...(await changedRecordsPatch(transaction, run.id)) };
	}
	return { changedPatch, found: expiredRuns.length > 0 };
}

async function claimRun(
	options: SourceConnectionRunOptions,
	leaseDurationMs: number,
	workerId: string,
): Promise<ClaimedRun> {
	const now = (options.now ?? (() => new Date()))();
	return options.database.transaction(async (transaction) => {
		const [connection] = await transaction
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, options.sourceConnectionKey))
			.for("update")
			.limit(1);
		if (!connection) {
			throw new SourceConnectionNotFoundError(
				options.sourceConnectionKey,
			);
		}
		if (connection.status !== "active") {
			throw new SourceConnectionNotRunnableError(
				connection.key,
				`status is ${connection.status}`,
			);
		}
		if (!isSyncableSourceProvider(connection.provider)) {
			throw new SourceConnectionNotRunnableError(
				connection.key,
				`provider is ${connection.provider}`,
			);
		}

		await transaction
			.insert(sourceSyncState)
			.values({ sourceConnectionKey: connection.key })
			.onConflictDoNothing();
		const [state] = await transaction
			.select()
			.from(sourceSyncState)
			.where(
				eq(
					sourceSyncState.sourceConnectionKey,
					connection.key,
				),
			)
			.for("update")
			.limit(1);
		if (!state) {
			throw new Error(
				`Source sync state could not be created: ${connection.key}`,
			);
		}
		if (
			state.leaseExpiresAt &&
			state.leaseExpiresAt.getTime() > now.getTime()
		) {
			throw new SourceLeaseUnavailableError(connection.key);
		}

		const expired = await closeExpiredRuns(transaction, connection.key, now);

		const [run] = await transaction
			.insert(sourceSyncRun)
			.values({
				heartbeatAt: now,
				sourceConnectionKey: connection.key,
				startedAt: now,
				workerId,
			})
			.returning({ id: sourceSyncRun.id });
		if (!run) throw new Error("Source sync run was not created");

		await transaction
			.update(sourceSyncState)
			.set({
				activeRunId: run.id,
				...expired.changedPatch,
				...(expired.found
					? {
							consecutiveFailures: sql`${sourceSyncState.consecutiveFailures} + 1`,
							lastError: EXPIRED_RUN_ERROR,
							lastErrorCode: "interrupted" as const,
							lastFailureAt: now,
							lastResult: null,
						}
					: {}),
				lastAttemptAt: now,
				leaseExpiresAt: expiryFrom(now, leaseDurationMs),
				leaseOwner: workerId,
				runRequestedAt: null,
				updatedAt: now,
			})
			.where(
				eq(
					sourceSyncState.sourceConnectionKey,
					connection.key,
				),
			);

		return { connection, runId: run.id };
	});
}

async function heartbeatRun(
	options: SourceOrchestratorOptions,
	claimed: ClaimedRun,
	leaseDurationMs: number,
	workerId: string,
) {
	const now = (options.now ?? (() => new Date()))();
	await options.database.transaction(async (transaction) => {
		const [state] = await transaction
			.update(sourceSyncState)
			.set({
				leaseExpiresAt: expiryFrom(now, leaseDurationMs),
				updatedAt: now,
			})
			.where(
				and(
					eq(
						sourceSyncState.sourceConnectionKey,
						claimed.connection.key,
					),
					eq(sourceSyncState.activeRunId, claimed.runId),
					eq(sourceSyncState.leaseOwner, workerId),
				),
			)
			.returning({ sourceConnectionKey: sourceSyncState.sourceConnectionKey });
		if (!state) {
			throw new SourceLeaseLostError(claimed.connection.key);
		}
		const [run] = await transaction
			.update(sourceSyncRun)
			.set({ heartbeatAt: now })
			.where(
				and(
					eq(sourceSyncRun.id, claimed.runId),
					eq(sourceSyncRun.status, "running"),
				),
			)
			.returning({ id: sourceSyncRun.id });
		if (!run) throw new SourceLeaseLostError(claimed.connection.key);
	});
}

/**
 * Records a run changed: its search work on top-level records. Counted when
 * the run ends either way, since a failed run keeps the batches it wrote.
 */
async function countChangedRecords(transaction: Transaction, runId: number) {
	const [row] = await transaction
		.select({ changed: sql<number>`count(distinct ${outbox.entityKey})::int` })
		.from(outbox)
		.innerJoin(item, eq(item.key, outbox.entityKey))
		.where(
			and(
				eq(outbox.sourceSyncRunId, runId),
				eq(outbox.entityType, "item"),
				isNull(item.parentItem),
				// Attachments, notes and annotations are not records of their own.
				notInArray(sql`lower(${item.itemType}::text)`, [...PARENT_REQUIRED_ITEM_TYPES]),
			),
		);
	return row?.changed ?? 0;
}

/** The sync state fields for what a run changed; nothing when it changed nothing. */
async function changedRecordsPatch(transaction: Transaction, runId: number) {
	const changed = await countChangedRecords(transaction, runId);
	return changed > 0 ? { lastChangedRecords: changed } : {};
}

async function finishRunSucceeded(
	options: SourceOrchestratorOptions,
	claimed: ClaimedRun,
	result: SourceSyncResult,
	workerId: string,
) {
	const now = (options.now ?? (() => new Date()))();
	await options.database.transaction(async (transaction) => {
		const changedPatch = await changedRecordsPatch(transaction, claimed.runId);
		const [state] = await transaction
			.update(sourceSyncState)
			.set({
				...changedPatch,
				activeRunId: null,
				consecutiveFailures: 0,
				lastError: null,
				lastErrorCode: null,
				lastResult: result,
				lastSuccessAt: now,
				leaseExpiresAt: null,
				leaseOwner: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(
						sourceSyncState.sourceConnectionKey,
						claimed.connection.key,
					),
					eq(sourceSyncState.activeRunId, claimed.runId),
					eq(sourceSyncState.leaseOwner, workerId),
				),
			)
			.returning({ sourceConnectionKey: sourceSyncState.sourceConnectionKey });
		if (!state) {
			throw new SourceLeaseLostError(claimed.connection.key);
		}
		const [run] = await transaction
			.update(sourceSyncRun)
			.set({
				finishedAt: now,
				heartbeatAt: now,
				result,
				status: "succeeded",
			})
			.where(
				and(
					eq(sourceSyncRun.id, claimed.runId),
					eq(sourceSyncRun.status, "running"),
				),
			)
			.returning({ id: sourceSyncRun.id });
		if (!run) throw new SourceLeaseLostError(claimed.connection.key);
	});
}

async function finishRunFailed(
	options: SourceOrchestratorOptions,
	claimed: ClaimedRun,
	error: unknown,
	workerId: string,
) {
	const now = (options.now ?? (() => new Date()))();
	const message = errorMessage(error);
	const code =
		error instanceof SourceLeaseLostError
			? "interrupted"
			: classifySourceError(error);
	await options.database.transaction(async (transaction) => {
		const changedPatch = await changedRecordsPatch(transaction, claimed.runId);
		const [state] = await transaction
			.update(sourceSyncState)
			.set({
				...changedPatch,
				activeRunId: null,
				consecutiveFailures: sql`${sourceSyncState.consecutiveFailures} + 1`,
				lastError: message,
				lastErrorCode: code,
				lastFailureAt: now,
				lastResult: null,
				leaseExpiresAt: null,
				leaseOwner: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(
						sourceSyncState.sourceConnectionKey,
						claimed.connection.key,
					),
					eq(sourceSyncState.activeRunId, claimed.runId),
					eq(sourceSyncState.leaseOwner, workerId),
				),
			)
			.returning({ sourceConnectionKey: sourceSyncState.sourceConnectionKey });

		await transaction
			.update(sourceSyncRun)
			.set({
				error: message,
				finishedAt: now,
				heartbeatAt: now,
				status: "failed",
			})
			.where(
				and(
					eq(sourceSyncRun.id, claimed.runId),
					eq(sourceSyncRun.status, "running"),
				),
			);

		if (!state && !(error instanceof SourceLeaseLostError)) {
			throw new SourceLeaseLostError(claimed.connection.key);
		}
	});
}

/** Saves how far the run has got, for the status the admin and OpenScholar show. */
async function reportRunProgress(
	options: SourceOrchestratorOptions,
	runId: number,
	done: number,
	total: number | null,
) {
	const now = (options.now ?? (() => new Date()))();
	await options.database
		.update(sourceSyncRun)
		.set({
			recordsDone: done,
			recordsFrom: sql`coalesce(${sourceSyncRun.recordsFrom}, ${done})`,
			recordsFromAt: sql`coalesce(${sourceSyncRun.recordsFromAt}, ${now})`,
			recordsTotal: total,
		})
		.where(
			and(eq(sourceSyncRun.id, runId), eq(sourceSyncRun.status, "running")),
		);
}

async function heartbeatLoop(
	options: SourceOrchestratorOptions,
	claimed: ClaimedRun,
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
			await heartbeatRun(
				options,
				claimed,
				leaseDurationMs,
				workerId,
			);
		} catch (error) {
			onFailure(error);
			return;
		}
	}
}

export async function runSourceConnection(
	options: SourceConnectionRunOptions,
): Promise<SourceRunOutcome> {
	const { heartbeatIntervalMs, leaseDurationMs, workerId } =
		validateOptions(options);
	const claimed = await claimRun(options, leaseDurationMs, workerId);
	const provider = claimed.connection.provider;
	if (!isSyncableSourceProvider(provider)) {
		throw new SourceConnectionNotRunnableError(
			claimed.connection.key,
			`provider is ${provider}`,
		);
	}
	const abortController = new AbortController();
	let heartbeatFailure: unknown;
	const loop = heartbeatLoop(
		options,
		claimed,
		heartbeatIntervalMs,
		leaseDurationMs,
		workerId,
		abortController.signal,
		(error) => {
			heartbeatFailure = error;
		},
	);

	try {
		const adapter = options.registry.get(provider);
		const result = parseSourceSyncResult(
			await adapter.sync({
				credentialResolver: options.credentialResolver,
				database: options.database,
				heartbeat: () =>
					heartbeatRun(
						options,
						claimed,
						leaseDurationMs,
						workerId,
					),
				run: {
					id: claimed.runId,
					report: (done, total) =>
						reportRunProgress(options, claimed.runId, done, total),
				},
				sourceConnection: claimed.connection,
			}),
		);
		if (heartbeatFailure) throw heartbeatFailure;
		await heartbeatRun(options, claimed, leaseDurationMs, workerId);
		await finishRunSucceeded(options, claimed, result, workerId);
		return {
			connectionKey: claimed.connection.key,
			provider,
			result,
			runId: claimed.runId,
			status: "succeeded",
		};
	} catch (error) {
		await finishRunFailed(options, claimed, error, workerId);
		throw error;
	} finally {
		abortController.abort();
		await loop;
	}
}

export async function runActiveSourceConnections(
	options: SourceOrchestratorOptions & {
		concurrency?: number;
	},
): Promise<SourceRunSweepResult[]> {
	const concurrency = options.concurrency ?? 2;
	if (
		!Number.isSafeInteger(concurrency) ||
		concurrency < 1 ||
		concurrency > 32
	) {
		throw new Error("concurrency must be an integer between 1 and 32");
	}
	const connections = await options.database
		.select({
			key: sourceConnection.key,
			provider: sourceConnection.provider,
		})
		.from(sourceConnection)
		.where(
			and(
				eq(sourceConnection.status, "active"),
				ne(sourceConnection.provider, "native"),
			),
		)
		.orderBy(asc(sourceConnection.key));
	const results: SourceRunSweepResult[] = [];
	for (const connectionChunk of chunkValues(connections, concurrency)) {
		const chunkResults = await Promise.all(
			connectionChunk.map(async (connection) => {
				if (!isSyncableSourceProvider(connection.provider)) {
					return {
						connectionKey: connection.key,
						error: `Unsupported source provider: ${connection.provider}`,
						status: "failed" as const,
					};
				}
				try {
					return await runSourceConnection({
						...options,
						sourceConnectionKey: connection.key,
					});
				} catch (error) {
					if (error instanceof SourceLeaseUnavailableError) {
						return {
							connectionKey: connection.key,
							status: "busy" as const,
						};
					}
					return {
						connectionKey: connection.key,
						error: errorMessage(error),
						status: "failed" as const,
					};
				}
			}),
		);
		results.push(...chunkResults);
	}
	return results;
}
