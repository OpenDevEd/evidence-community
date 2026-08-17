import {
	searchIndexWorker,
	type SearchIndexWorkerStage,
} from "@opendeved/evidence-library-core";
import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	createWorkerStateReporter,
	type WorkerStateReporter,
} from "@/lib/worker-state-reporter";

const MAX_WORKER_ID_LENGTH = 255;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
export const SEARCH_INDEX_WORKER_MAX_HEARTBEAT_AGE_MS = 20_000;

export type SearchIndexWorkerSnapshot = typeof searchIndexWorker.$inferSelect;

export type SearchIndexWorkerProgress = {
	currentBatchProgress?: number | null;
	currentBatchUid?: number | null;
	currentEventCount?: number;
	currentTaskUid?: number | null;
	lastCompletedAt?: Date | null;
	lastError?: string | null;
	stage: SearchIndexWorkerStage;
};

export type SearchIndexWorkerStateReporter =
	WorkerStateReporter<SearchIndexWorkerProgress>;

function normalizedWorkerId(workerId: string) {
	const normalized = workerId.trim();
	if (!normalized || normalized.length > MAX_WORKER_ID_LENGTH) {
		throw new Error("workerId must contain 1-255 characters");
	}
	return normalized;
}

function normalizedInstanceId(instanceId: string) {
	const normalized = instanceId.trim();
	if (!INSTANCE_ID_PATTERN.test(normalized)) {
		throw new Error(
			"instanceId must contain 1-64 safe identifier characters",
		);
	}
	return normalized;
}

export class SearchIndexWorkerOwnershipLostError extends Error {
	constructor(workerId: string) {
		super(`Search index worker ownership was lost: ${workerId}`);
		this.name = "SearchIndexWorkerOwnershipLostError";
	}
}

export function createSearchIndexWorkerStateReporter(options: {
	initialProgress: SearchIndexWorkerProgress;
	minimumWriteIntervalMs?: number;
	now?: () => Date;
	write: (
		progress: SearchIndexWorkerProgress,
		heartbeatAt: Date,
	) => Promise<unknown>;
}): SearchIndexWorkerStateReporter {
	return createWorkerStateReporter(options);
}

export function searchIndexWorkerIsActive(
	worker: SearchIndexWorkerSnapshot,
	now = new Date(),
	maximumHeartbeatAgeMs = SEARCH_INDEX_WORKER_MAX_HEARTBEAT_AGE_MS,
) {
	if (
		!Number.isSafeInteger(maximumHeartbeatAgeMs) ||
		maximumHeartbeatAgeMs < 1
	) {
		throw new Error("maximumHeartbeatAgeMs must be a positive integer");
	}
	return (
		worker.stoppedAt === null &&
		now.getTime() - worker.heartbeatAt.getTime() <= maximumHeartbeatAgeMs
	);
}

export function searchIndexWorkerIsReady(
	worker: SearchIndexWorkerSnapshot,
	now = new Date(),
	maximumHeartbeatAgeMs = SEARCH_INDEX_WORKER_MAX_HEARTBEAT_AGE_MS,
) {
	return (
		worker.stage !== "starting" &&
		searchIndexWorkerIsActive(worker, now, maximumHeartbeatAgeMs)
	);
}

export async function getSearchIndexWorker(
	database: Database,
	workerId: string,
) {
	const normalized = normalizedWorkerId(workerId);
	const [worker] = await database
		.select()
		.from(searchIndexWorker)
		.where(eq(searchIndexWorker.workerId, normalized))
		.limit(1);
	return worker ?? null;
}

export async function registerSearchIndexWorker(
	database: Database,
	workerId: string,
	instanceId: string,
	registeredAt = new Date(),
) {
	const normalized = normalizedWorkerId(workerId);
	const normalizedInstance = normalizedInstanceId(instanceId);
	const [worker] = await database
		.insert(searchIndexWorker)
		.values({
			heartbeatAt: registeredAt,
			instanceId: normalizedInstance,
			stage: "starting",
			startedAt: registeredAt,
			workerId: normalized,
		})
		.onConflictDoUpdate({
			target: searchIndexWorker.workerId,
			set: {
				currentBatchProgress: null,
				currentBatchUid: null,
				currentEventCount: 0,
				currentTaskUid: null,
				heartbeatAt: registeredAt,
				instanceId: normalizedInstance,
				stage: "starting",
				startedAt: registeredAt,
				stoppedAt: null,
			},
		})
		.returning();
	return worker!;
}

export async function updateSearchIndexWorker(
	database: Database,
	workerId: string,
	instanceId: string,
	progress: SearchIndexWorkerProgress,
	heartbeatAt = new Date(),
) {
	const normalized = normalizedWorkerId(workerId);
	const normalizedInstance = normalizedInstanceId(instanceId);
	const [worker] = await database
		.update(searchIndexWorker)
		.set({
			...progress,
			heartbeatAt,
			stoppedAt: null,
		})
		.where(
			and(
				eq(searchIndexWorker.workerId, normalized),
				eq(searchIndexWorker.instanceId, normalizedInstance),
			),
		)
		.returning();
	if (!worker) {
		throw new SearchIndexWorkerOwnershipLostError(normalized);
	}
	return worker;
}

export async function stopSearchIndexWorker(
	database: Database,
	workerId: string,
	instanceId: string,
	stoppedAt = new Date(),
) {
	const normalized = normalizedWorkerId(workerId);
	const normalizedInstance = normalizedInstanceId(instanceId);
	const [worker] = await database
		.update(searchIndexWorker)
		.set({
			currentBatchProgress: null,
			currentBatchUid: null,
			currentEventCount: 0,
			currentTaskUid: null,
			heartbeatAt: stoppedAt,
			stage: "stopped",
			stoppedAt,
		})
		.where(
			and(
				eq(searchIndexWorker.workerId, normalized),
				eq(searchIndexWorker.instanceId, normalizedInstance),
			),
		)
		.returning();
	if (!worker) {
		throw new SearchIndexWorkerOwnershipLostError(normalized);
	}
	return worker;
}
