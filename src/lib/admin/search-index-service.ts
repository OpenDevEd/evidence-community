import { outbox, searchIndexWorker } from "@opendeved/evidence-library-core";
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	SEARCH_INDEX_WORKER_MAX_HEARTBEAT_AGE_MS,
	searchIndexWorkerIsActive,
} from "@/lib/search-index/worker-state";
import { requeueSearchOutboxDeadLetters } from "@/lib/search-index/consumer";

import type {
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptState,
	AdminSearchIndexReceiptStatus,
	AdminSearchIndexRetryRequest,
} from "./search-index-contract";

type OutboxReceiptRow = Pick<
	typeof outbox.$inferSelect,
	| "attempts"
	| "createdAt"
	| "deadLetteredAt"
	| "entityKey"
	| "entityType"
	| "lastError"
	| "leaseExpiresAt"
	| "leaseOwner"
	| "nextAttemptAt"
	| "processedAt"
	| "revision"
>;

function receiptIdentity(receipt: AdminSearchIndexReceipt) {
	return `${receipt.entityType}:${receipt.entityKey}:${receipt.revision}`;
}

function receiptState(row: OutboxReceiptRow, now: Date) {
	if (row.processedAt) return "indexed";
	if (row.deadLetteredAt) return "failed";
	if (
		row.leaseOwner &&
		row.leaseExpiresAt &&
		row.leaseExpiresAt.getTime() > now.getTime()
	) {
		return "processing";
	}
	if (row.attempts > 0) return "retrying";
	return "queued";
}

function receiptJson(
	receipt: AdminSearchIndexReceipt,
	row: OutboxReceiptRow | undefined,
	now: Date,
): AdminSearchIndexReceiptStatus {
	if (!row) {
		return {
			...receipt,
			attempts: null,
			createdAt: null,
			error: null,
			nextAttemptAt: null,
			processedAt: null,
			state: "unknown",
		};
	}
	return {
		entityKey: row.entityKey,
		entityType: row.entityType,
		revision: row.revision,
		attempts: row.attempts,
		createdAt: row.createdAt.toISOString(),
		error: row.lastError,
		nextAttemptAt: row.nextAttemptAt.toISOString(),
		processedAt: row.processedAt?.toISOString() ?? null,
		state: receiptState(row, now),
	};
}

function receiptPredicate(receipts: readonly AdminSearchIndexReceipt[]) {
	if (receipts.length === 0) {
		throw new Error("At least one search indexing receipt is required");
	}
	return or(
		...receipts.map((receipt) =>
			and(
				eq(outbox.entityType, receipt.entityType),
				eq(outbox.entityKey, receipt.entityKey),
				eq(outbox.revision, receipt.revision),
			),
		),
	);
}

export function resolveAdminSearchIndexReceiptState(
	row: OutboxReceiptRow,
	now = new Date(),
): AdminSearchIndexReceiptState {
	return receiptState(row, now);
}

export async function getAdminSearchIndexReceipts(
	database: Database,
	receipts: readonly AdminSearchIndexReceipt[],
	now = new Date(),
) {
	if (receipts.length === 0) return [];
	const rows = await database
		.select({
			attempts: outbox.attempts,
			createdAt: outbox.createdAt,
			deadLetteredAt: outbox.deadLetteredAt,
			entityKey: outbox.entityKey,
			entityType: outbox.entityType,
			lastError: outbox.lastError,
			leaseExpiresAt: outbox.leaseExpiresAt,
			leaseOwner: outbox.leaseOwner,
			nextAttemptAt: outbox.nextAttemptAt,
			processedAt: outbox.processedAt,
			revision: outbox.revision,
		})
		.from(outbox)
		.where(receiptPredicate(receipts));
	const byIdentity = new Map(
		rows.map((row) => [receiptIdentity(row), row] as const),
	);
	return receipts.map((receipt) =>
		receiptJson(receipt, byIdentity.get(receiptIdentity(receipt)), now),
	);
}

export async function getAdminSearchIndexOverview(
	database: Database,
	now = new Date(),
) {
	const [workers, pending, failed] = await Promise.all([
		database
			.select()
			.from(searchIndexWorker)
			.orderBy(desc(searchIndexWorker.heartbeatAt))
			.limit(1),
		database
			.select({ nextAttemptAt: outbox.nextAttemptAt })
			.from(outbox)
			.where(
				and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt)),
			)
			.orderBy(asc(outbox.nextAttemptAt), asc(outbox.id))
			.limit(1),
		database
			.select({ id: outbox.id })
			.from(outbox)
			.where(
				and(isNull(outbox.processedAt), isNotNull(outbox.deadLetteredAt)),
			)
			.limit(1),
	]);
	const worker = workers[0] ?? null;
	const nextPending = pending[0] ?? null;
	return {
		queue: {
			hasFailed: failed.length > 0,
			hasPending: Boolean(nextPending),
			nextAttemptAt: nextPending?.nextAttemptAt.toISOString() ?? null,
		},
		worker: worker
			? {
				active: searchIndexWorkerIsActive(
					worker,
					now,
					SEARCH_INDEX_WORKER_MAX_HEARTBEAT_AGE_MS,
				),
				batchProgress: worker.currentBatchProgress,
				batchUid: worker.currentBatchUid,
				currentEventCount: worker.currentEventCount,
				heartbeatAt: worker.heartbeatAt.toISOString(),
				lastCompletedAt:
					worker.lastCompletedAt?.toISOString() ?? null,
				lastError: worker.lastError,
				stage: worker.stage,
				startedAt: worker.startedAt.toISOString(),
				stoppedAt: worker.stoppedAt?.toISOString() ?? null,
				taskUid: worker.currentTaskUid,
				workerId: worker.workerId,
			}
			: null,
	};
}

export async function retryAdminSearchIndexFailures(
	database: Database,
	request: AdminSearchIndexRetryRequest,
	requeuedAt = new Date(),
) {
	const requeued = await requeueSearchOutboxDeadLetters(database, {
		...(request.scope === "receipts"
			? { receipts: request.receipts }
			: {}),
		requeuedAt,
	});
	return {
		receipts: request.scope === "receipts" ? requeued : [],
		requeued: requeued.length,
	};
}
