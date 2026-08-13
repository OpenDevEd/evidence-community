import { outbox } from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationSyncJob,
	type PublicationProvider,
} from "@/db/schema/publication";

type Executor = Database | DatabaseTransaction;

export class PublicationJobLeaseLostError extends Error {
	constructor() {
		super("The publication job lease was lost");
		this.name = "PublicationJobLeaseLostError";
	}
}

export async function assertPublicationJobLease(
	transaction: DatabaseTransaction,
	input: { jobId: number; workerId: string },
) {
	const [job] = await transaction
		.select({ id: publicationSyncJob.id })
		.from(publicationSyncJob)
		.where(
			and(
				eq(publicationSyncJob.id, input.jobId),
				eq(publicationSyncJob.leaseOwner, input.workerId),
			),
		)
		.limit(1)
		.for("update");
	if (!job) throw new PublicationJobLeaseLostError();
}

export async function enqueueItemSearchReprojection(
	transaction: DatabaseTransaction,
	input: { itemKey: string; revision: number; queuedAt: Date },
) {
	await transaction
		.insert(outbox)
		.values({
			entityType: "item",
			entityKey: input.itemKey,
			operation: "upsert",
			revision: input.revision,
			nextAttemptAt: input.queuedAt,
		})
		.onConflictDoUpdate({
			target: [outbox.entityType, outbox.entityKey, outbox.revision],
			set: {
				attempts: 0,
				lastError: null,
				nextAttemptAt: input.queuedAt,
				leaseOwner: null,
				leaseExpiresAt: null,
				processedAt: null,
				deadLetteredAt: null,
			},
		});
}

export async function claimPublicationJobs(
	database: Database,
	input: {
		provider: PublicationProvider;
		environment: "test" | "sandbox";
		workerId: string;
		limit: number;
		leaseSeconds: number;
		claimedAt: Date;
	},
) {
	return database.transaction(async (transaction) => {
		const candidates = await transaction
			.select({ id: publicationSyncJob.id })
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.provider, input.provider),
					eq(publicationSyncJob.environment, input.environment),
					isNull(publicationSyncJob.processedAt),
					isNull(publicationSyncJob.deadLetteredAt),
					isNull(publicationSyncJob.supersededAt),
					lte(publicationSyncJob.nextAttemptAt, input.claimedAt),
					or(
						isNull(publicationSyncJob.leaseOwner),
						lte(publicationSyncJob.leaseExpiresAt, input.claimedAt),
					),
				),
			)
			.orderBy(publicationSyncJob.nextAttemptAt, publicationSyncJob.id)
			.limit(input.limit)
			.for("update", { skipLocked: true });
		if (candidates.length === 0) return [];
		const ids = candidates.map(({ id }) => id);
		return transaction
			.update(publicationSyncJob)
			.set({
				attempts: sql`${publicationSyncJob.attempts} + 1`,
				leaseOwner: input.workerId,
				leaseExpiresAt: new Date(
					input.claimedAt.getTime() + input.leaseSeconds * 1_000,
				),
				updatedAt: input.claimedAt,
			})
			.where(inArray(publicationSyncJob.id, ids))
			.returning();
	});
}

export async function finishPublicationJob(
	database: Executor,
	input: {
		jobId: number;
		workerId: string;
		finishedAt: Date;
		receipt: Record<string, unknown>;
	},
) {
	const [job] = await database
		.update(publicationSyncJob)
		.set({
			processedAt: input.finishedAt,
			resultReceipt: input.receipt,
			lastError: null,
			leaseOwner: null,
			leaseExpiresAt: null,
			updatedAt: input.finishedAt,
		})
		.where(
			and(
				eq(publicationSyncJob.id, input.jobId),
				eq(publicationSyncJob.leaseOwner, input.workerId),
			),
		)
		.returning();
	if (!job) throw new PublicationJobLeaseLostError();
	return job;
}

export async function deferPublicationJob(
	database: Executor,
	input: {
		jobId: number;
		workerId: string;
		deferredAt: Date;
		delayMs: number;
		error: string;
		deadLetter: boolean;
	},
) {
	const [job] = await database
		.update(publicationSyncJob)
		.set({
			deadLetteredAt: input.deadLetter ? input.deferredAt : null,
			lastError: input.error,
			nextAttemptAt: new Date(input.deferredAt.getTime() + input.delayMs),
			leaseOwner: null,
			leaseExpiresAt: null,
			updatedAt: input.deferredAt,
		})
		.where(
			and(
				eq(publicationSyncJob.id, input.jobId),
				eq(publicationSyncJob.leaseOwner, input.workerId),
			),
		)
		.returning();
	if (!job) throw new PublicationJobLeaseLostError();
	return job;
}
