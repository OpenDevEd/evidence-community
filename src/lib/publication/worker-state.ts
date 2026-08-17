import { and, eq, gt, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { publicationSyncRun } from "@/db/schema/publication";

import {
	publicationWorkerProgressSchema,
	type PublicationWorkerProgress,
} from "./worker-contract";

export type {
	PublicationWorkerProgress,
	PublicationWorkerStage,
} from "./worker-contract";

export const PUBLICATION_WORKER_MAX_HEARTBEAT_AGE_MS = 20_000;
export const PUBLICATION_WORKER_LEASE_SECONDS = 30;

export class PublicationWorkerAlreadyRunningError extends Error {
	constructor() {
		super("A publication worker is already running");
		this.name = "PublicationWorkerAlreadyRunningError";
	}
}

export class PublicationWorkerOwnershipLostError extends Error {
	constructor() {
		super("Publication worker ownership was lost");
		this.name = "PublicationWorkerOwnershipLostError";
	}
}

function validateIdentifier(value: string, name: string, maximum: number) {
	const normalized = value.trim();
	if (!normalized || normalized.length > maximum) {
		throw new Error(`${name} must contain 1-${maximum} characters`);
	}
	return normalized;
}

function leaseExpiry(now: Date, leaseSeconds: number) {
	return new Date(now.getTime() + leaseSeconds * 1_000);
}

function progressResult(progress: PublicationWorkerProgress) {
	return { ...progress } as Record<string, unknown>;
}

export async function registerPublicationWorker(
	database: Database,
	input: {
		workerId: string;
		instanceId: string;
		registeredAt?: Date;
		leaseSeconds: number;
	},
) {
	const workerId = validateIdentifier(input.workerId, "workerId", 255);
	const instanceId = validateIdentifier(input.instanceId, "instanceId", 56);
	const registeredAt = input.registeredAt ?? new Date();
	return database.transaction(async (transaction) => {
		await transaction.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended('publication:worker', 0))`,
		);
		await transaction
			.update(publicationSyncRun)
			.set({
				status: "failed",
				leaseOwner: null,
				leaseExpiresAt: null,
				heartbeatAt: registeredAt,
				completedAt: registeredAt,
				failure: "PublicationWorkerOwnershipLostError: worker lease expired",
			})
			.where(
				and(
					eq(publicationSyncRun.trigger, "immediate"),
					eq(publicationSyncRun.status, "running"),
					lte(publicationSyncRun.leaseExpiresAt, registeredAt),
				),
			);
		const [active] = await transaction
			.select({ id: publicationSyncRun.id })
			.from(publicationSyncRun)
			.where(
				and(
					eq(publicationSyncRun.trigger, "immediate"),
					eq(publicationSyncRun.status, "running"),
					gt(publicationSyncRun.leaseExpiresAt, registeredAt),
				),
			)
			.limit(1);
		if (active) throw new PublicationWorkerAlreadyRunningError();

		const runId = `worker:${instanceId}`;
		const progress: PublicationWorkerProgress = {
			workerId,
			instanceId,
			stage: "starting",
			currentProvider: null,
			lastCompletedAt: null,
			lastError: null,
		};
		const [run] = await transaction
			.insert(publicationSyncRun)
			.values({
				id: runId,
				trigger: "immediate",
				status: "running",
				leaseOwner: instanceId,
				leaseExpiresAt: leaseExpiry(registeredAt, input.leaseSeconds),
				heartbeatAt: registeredAt,
				startedAt: registeredAt,
				result: progressResult(progress),
			})
			.returning();
		return run!;
	});
}

export async function updatePublicationWorker(
	database: Database,
	input: {
		runId: string;
		instanceId: string;
		heartbeatAt?: Date;
		leaseSeconds: number;
		claimedJobs: number;
		succeededJobs: number;
		failedJobs: number;
		progress: PublicationWorkerProgress;
	},
) {
	const heartbeatAt = input.heartbeatAt ?? new Date();
	const [run] = await database
		.update(publicationSyncRun)
		.set({
			heartbeatAt,
			leaseExpiresAt: leaseExpiry(heartbeatAt, input.leaseSeconds),
			claimedJobs: input.claimedJobs,
			succeededJobs: input.succeededJobs,
			failedJobs: input.failedJobs,
			result: progressResult(input.progress),
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.instanceId),
				gt(publicationSyncRun.leaseExpiresAt, heartbeatAt),
			),
		)
		.returning();
	if (!run) throw new PublicationWorkerOwnershipLostError();
	return run;
}

export async function stopPublicationWorker(
	database: Database,
	input: {
		runId: string;
		instanceId: string;
		stoppedAt?: Date;
		claimedJobs: number;
		succeededJobs: number;
		failedJobs: number;
		progress: PublicationWorkerProgress;
	},
) {
	const stoppedAt = input.stoppedAt ?? new Date();
	const [run] = await database
		.update(publicationSyncRun)
		.set({
			status: "succeeded",
			leaseOwner: null,
			leaseExpiresAt: null,
			heartbeatAt: stoppedAt,
			completedAt: stoppedAt,
			claimedJobs: input.claimedJobs,
			succeededJobs: input.succeededJobs,
			failedJobs: input.failedJobs,
			result: progressResult(input.progress),
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.instanceId),
				gt(publicationSyncRun.leaseExpiresAt, stoppedAt),
			),
		)
		.returning();
	if (!run) throw new PublicationWorkerOwnershipLostError();
	return run;
}

export async function failPublicationWorker(
	database: Database,
	input: {
		runId: string;
		instanceId: string;
		failedAt?: Date;
		claimedJobs: number;
		succeededJobs: number;
		failedJobs: number;
		failure: string;
		progress: PublicationWorkerProgress;
	},
) {
	const failedAt = input.failedAt ?? new Date();
	const [run] = await database
		.update(publicationSyncRun)
		.set({
			status: "failed",
			leaseOwner: null,
			leaseExpiresAt: null,
			heartbeatAt: failedAt,
			completedAt: failedAt,
			claimedJobs: input.claimedJobs,
			succeededJobs: input.succeededJobs,
			failedJobs: input.failedJobs,
			failure: input.failure,
			result: progressResult(input.progress),
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.instanceId),
				gt(publicationSyncRun.leaseExpiresAt, failedAt),
			),
		)
		.returning();
	if (!run) throw new PublicationWorkerOwnershipLostError();
	return run;
}

export async function getPublicationWorkerRun(database: Database, runId: string) {
	const [run] = await database
		.select()
		.from(publicationSyncRun)
		.where(eq(publicationSyncRun.id, runId))
		.limit(1);
	return run ?? null;
}

export function publicationWorkerIsReady(
	run: typeof publicationSyncRun.$inferSelect,
	now = new Date(),
	maximumHeartbeatAgeMs = PUBLICATION_WORKER_MAX_HEARTBEAT_AGE_MS,
) {
	if (
		!Number.isSafeInteger(maximumHeartbeatAgeMs) ||
		maximumHeartbeatAgeMs < 1
	) {
		throw new Error("maximumHeartbeatAgeMs must be a positive integer");
	}
	const progress = publicationWorkerProgressSchema.safeParse(run.result);
	return (
		run.status === "running" &&
		run.leaseExpiresAt !== null &&
		run.heartbeatAt !== null &&
		run.leaseExpiresAt.getTime() > now.getTime() &&
		now.getTime() - run.heartbeatAt.getTime() <= maximumHeartbeatAgeMs &&
		progress.success &&
		!["starting", "stopping", "stopped"].includes(progress.data.stage)
	);
}
