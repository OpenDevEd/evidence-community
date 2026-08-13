import { outbox } from "@opendeved/evidence-library-core";
import {
	and,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	ne,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { tryLockItemMutation } from "@/db/canonical-mutation-lock";
import {
	publicationIdentifier,
	publicationSyncJob,
	publicationTarget,
	type PublicationEnvironment,
	type PublicationJobReason,
	type PublicationProvider,
	type ZenodoIdentifierPolicy,
} from "@/db/schema/publication";
import { itemFilePublication } from "@/db/schema/source";

type Executor = Database | DatabaseTransaction;

export function publicationJobState(
	job: typeof publicationSyncJob.$inferSelect,
) {
	if (job.processedAt) return "finished" as const;
	if (job.deadLetteredAt) return "failed" as const;
	if (job.leaseOwner) return "working" as const;
	if (job.attempts > 0) return "retrying" as const;
	return "queued" as const;
}

export class PublicationJobLeaseLostError extends Error {
	constructor() {
		super("The publication job lease was lost");
		this.name = "PublicationJobLeaseLostError";
	}
}

export async function assertPublicationJobLease(
	transaction: DatabaseTransaction,
	input: { jobId: number; workerId: string; observedAt: Date },
) {
	const [job] = await transaction
		.select({ id: publicationSyncJob.id })
		.from(publicationSyncJob)
		.where(
			and(
				eq(publicationSyncJob.id, input.jobId),
				eq(publicationSyncJob.leaseOwner, input.workerId),
				gt(publicationSyncJob.leaseExpiresAt, input.observedAt),
			),
		)
		.limit(1)
		.for("update");
	if (!job) throw new PublicationJobLeaseLostError();
}

export function publicationJobIdempotencyKey(input: {
	itemKey: string;
	provider: PublicationProvider;
	environment: PublicationEnvironment;
	identifierPolicy: ZenodoIdentifierPolicy | null;
	canonicalRevision: number;
	fileRevision: number | null;
	idempotencyDiscriminator?: string;
}) {
	return [
		"publication",
		input.provider,
		input.environment,
		input.itemKey,
		...(input.identifierPolicy ? [input.identifierPolicy] : []),
		input.canonicalRevision,
		...(input.provider === "zenodo"
			? [input.fileRevision ?? "no-file"]
			: []),
		...(input.idempotencyDiscriminator
			? [input.idempotencyDiscriminator]
			: []),
	].join(":");
}

export async function supersedeUnleasedPublicationJobs(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		provider: PublicationProvider;
		environment: PublicationEnvironment;
		now: Date;
	},
) {
	await transaction
		.update(publicationSyncJob)
		.set({ supersededAt: input.now, updatedAt: input.now })
		.where(
			and(
				eq(publicationSyncJob.itemKey, input.itemKey),
				eq(publicationSyncJob.provider, input.provider),
				eq(publicationSyncJob.environment, input.environment),
				isNull(publicationSyncJob.processedAt),
				isNull(publicationSyncJob.deadLetteredAt),
				isNull(publicationSyncJob.supersededAt),
				isNull(publicationSyncJob.leaseOwner),
			),
		);
}

export async function savePublicationJob(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		provider: PublicationProvider;
		environment: PublicationEnvironment;
		identifierPolicy: ZenodoIdentifierPolicy | null;
		canonicalRevision: number;
		fileRevision: number | null;
		idempotencyDiscriminator?: string;
		reason: PublicationJobReason;
		now: Date;
	},
) {
	const idempotencyKey = publicationJobIdempotencyKey(input);
	const [inserted] = await transaction
		.insert(publicationSyncJob)
		.values({
			itemKey: input.itemKey,
			provider: input.provider,
			environment: input.environment,
			canonicalRevision: input.canonicalRevision,
			fileRevision: input.fileRevision,
			reason: input.reason,
			idempotencyKey,
			nextAttemptAt: input.now,
			createdAt: input.now,
			updatedAt: input.now,
		})
		.onConflictDoNothing({ target: publicationSyncJob.idempotencyKey })
		.returning();
	if (inserted) return inserted;
	const [existing] = await transaction
		.select()
		.from(publicationSyncJob)
		.where(eq(publicationSyncJob.idempotencyKey, idempotencyKey))
		.limit(1);
	if (!existing) throw new Error("The publication job could not be saved");
	if (
		existing.supersededAt &&
		!existing.processedAt &&
		!existing.deadLetteredAt
	) {
		const [restored] = await transaction
			.update(publicationSyncJob)
			.set({
				supersededAt: null,
				nextAttemptAt: input.now,
				reason: input.reason,
				updatedAt: input.now,
			})
			.where(eq(publicationSyncJob.id, existing.id))
			.returning();
		if (!restored)
			throw new Error("The publication job could not be restored");
		return restored;
	}
	return existing;
}

/**
 * Enqueues every active publication target for a parent record. The caller must
 * already hold the record's item advisory lock and call this inside the same
 * transaction as the canonical change.
 */
export async function enqueuePublicationJobsForItem(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		canonicalRevision: number;
		reason: Extract<
			PublicationJobReason,
			| "record_changed"
			| "file_changed"
			| "crossref_verified"
			| "nightly_reconciliation"
		>;
		now: Date;
		providers?: readonly PublicationProvider[];
		idempotencyDiscriminator?: string;
	},
) {
	const [targets, publishedFiles, managedCrossrefIdentifiers] =
		await Promise.all([
			transaction
				.select()
				.from(publicationTarget)
				.where(
					and(
						eq(publicationTarget.itemKey, input.itemKey),
						isNull(publicationTarget.deactivatedAt),
					),
				),
			transaction
				.select({ revision: itemFilePublication.revision })
				.from(itemFilePublication)
				.where(eq(itemFilePublication.parentItemKey, input.itemKey)),
			transaction
				.select({ lifecycle: publicationIdentifier.lifecycle })
				.from(publicationIdentifier)
				.where(
					and(
						eq(publicationIdentifier.itemKey, input.itemKey),
						eq(publicationIdentifier.registrar, "crossref"),
						eq(publicationIdentifier.environment, "test"),
						eq(publicationIdentifier.role, "primary"),
						eq(publicationIdentifier.ownership, "managed"),
						eq(publicationIdentifier.isCurrent, true),
					),
				),
		]);
	const fileRevision = publishedFiles.length
		? Math.max(...publishedFiles.map(({ revision }) => revision))
		: null;
	const crossrefVerified = managedCrossrefIdentifiers.some(
		({ lifecycle }) => lifecycle === "verified",
	);
	const jobs: Array<typeof publicationSyncJob.$inferSelect> = [];
	for (const target of targets) {
		if (input.providers && !input.providers.includes(target.provider))
			continue;
		if (
			input.reason === "crossref_verified" &&
			(target.provider !== "zenodo" ||
				target.identifierPolicy !== "reuse-crossref")
		) {
			continue;
		}
		await supersedeUnleasedPublicationJobs(transaction, {
			itemKey: input.itemKey,
			provider: target.provider,
			environment: target.environment,
			now: input.now,
		});
		if (
			target.provider === "zenodo" &&
			(fileRevision === null ||
				(target.identifierPolicy === "reuse-crossref" &&
					!crossrefVerified))
		) {
			continue;
		}
		const job = await savePublicationJob(transaction, {
			itemKey: input.itemKey,
			provider: target.provider,
			environment: target.environment,
			identifierPolicy: target.identifierPolicy,
			canonicalRevision: input.canonicalRevision,
			fileRevision: target.provider === "zenodo" ? fileRevision : null,
			idempotencyDiscriminator: input.idempotencyDiscriminator,
			reason: input.reason,
			now: input.now,
		});
		jobs.push(job);
	}
	return jobs;
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

/** Claims one job while holding the same item lock used by admin mutations. */
export async function claimNextPublicationJob(
	database: Database,
	input: {
		provider: PublicationProvider;
		environment: "test" | "sandbox";
		workerId: string;
		leaseSeconds: number;
		claimedAt: Date;
	},
) {
	const leasedTarget = alias(publicationSyncJob, "leasedPublicationTarget");
	const candidates = await database
		.select({
			id: publicationSyncJob.id,
			itemKey: publicationSyncJob.itemKey,
		})
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
				notExists(
					database
						.select({ id: leasedTarget.id })
						.from(leasedTarget)
						.where(
							and(
								eq(
									leasedTarget.itemKey,
									publicationSyncJob.itemKey,
								),
								eq(
									leasedTarget.provider,
									publicationSyncJob.provider,
								),
								eq(
									leasedTarget.environment,
									publicationSyncJob.environment,
								),
								isNull(leasedTarget.processedAt),
								isNull(leasedTarget.deadLetteredAt),
								isNull(leasedTarget.supersededAt),
								isNotNull(leasedTarget.leaseOwner),
								gt(
									leasedTarget.leaseExpiresAt,
									input.claimedAt,
								),
							),
						),
				),
			),
		)
		.orderBy(publicationSyncJob.nextAttemptAt, publicationSyncJob.id)
		.limit(32);
	for (const candidate of candidates) {
		const claimed = await database.transaction(async (transaction) => {
			if (!(await tryLockItemMutation(transaction, candidate.itemKey))) {
				return null;
			}
			const [leasedSibling] = await transaction
				.select({ id: publicationSyncJob.id })
				.from(publicationSyncJob)
				.where(
					and(
						eq(publicationSyncJob.itemKey, candidate.itemKey),
						eq(publicationSyncJob.provider, input.provider),
						eq(publicationSyncJob.environment, input.environment),
						ne(publicationSyncJob.id, candidate.id),
						isNull(publicationSyncJob.processedAt),
						isNull(publicationSyncJob.deadLetteredAt),
						isNull(publicationSyncJob.supersededAt),
						isNotNull(publicationSyncJob.leaseOwner),
						gt(publicationSyncJob.leaseExpiresAt, input.claimedAt),
					),
				)
				.limit(1)
				.for("update");
			if (leasedSibling) return null;
			const [claimed] = await transaction
				.update(publicationSyncJob)
				.set({
					attempts: sql`${publicationSyncJob.attempts} + 1`,
					leaseOwner: input.workerId,
					leaseExpiresAt: new Date(
						input.claimedAt.getTime() + input.leaseSeconds * 1_000,
					),
					updatedAt: input.claimedAt,
				})
				.where(
					and(
						eq(publicationSyncJob.id, candidate.id),
						isNull(publicationSyncJob.processedAt),
						isNull(publicationSyncJob.deadLetteredAt),
						isNull(publicationSyncJob.supersededAt),
						lte(publicationSyncJob.nextAttemptAt, input.claimedAt),
						or(
							isNull(publicationSyncJob.leaseOwner),
							lte(
								publicationSyncJob.leaseExpiresAt,
								input.claimedAt,
							),
						),
					),
				)
				.returning();
			return claimed ?? null;
		});
		if (claimed) return claimed;
	}
	return null;
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
				gt(publicationSyncJob.leaseExpiresAt, input.finishedAt),
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
				gt(publicationSyncJob.leaseExpiresAt, input.deferredAt),
			),
		)
		.returning();
	if (!job) throw new PublicationJobLeaseLostError();
	return job;
}
