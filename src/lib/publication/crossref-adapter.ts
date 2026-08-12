import {
	CrossrefApiClient,
	executeLivePublicationSyncPlan,
	planPublicationSync,
	settlePublicationSyncState,
	type CrossrefDepositor,
	type ProviderSyncState,
	type ProviderSyncStatePatch,
	type PublicationSyncOperationResult,
} from "@opendeved/doi-sync-core";
import { and, eq, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database } from "@/db/database-schema";
import {
	publicationIdentifier,
	publicationSyncState,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";

import { resolveBibliographicDoi } from "./bibliographic-doi";
import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
} from "./record-adapter";
import { readPublicationRepositorySnapshot } from "./repository";
import { currentManagedDoi, providerState } from "./state-adapter";
import {
	claimPublicationJobs,
	deferPublicationJob,
	enqueueItemSearchReprojection,
	finishPublicationJob,
	PublicationJobLeaseLostError,
} from "./queue";

type PublicationConfig = Pick<LibraryServerConfig, "identity" | "services">;

function requireConfig(config: PublicationConfig) {
	const crossref = config.services.publication.crossref;
	if (
		!crossref.enabled ||
		!crossref.loginId ||
		!crossref.password ||
		!crossref.depositorName ||
		!crossref.email ||
		!crossref.registrant
	) {
		throw new Error("Crossref test publishing is not fully configured");
	}
	return {
		loginId: crossref.loginId,
		password: crossref.password,
		depositorName: crossref.depositorName,
		emailAddress: crossref.email,
		registrant: crossref.registrant,
		batchIdPrefix: "evidence-library",
	};
}

async function buildCrossrefPlan(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
) {
	const publicationConfig = config.services.publication;
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		"test",
	);
	if (!snapshot.record)
		throw new Error("The publication record no longer exists");
	if (snapshot.record.deleted === 1) {
		throw new Error("Restore this record before publishing it to Crossref");
	}
	if (snapshot.record.parentItem) {
		throw new Error("Only parent records can be published to Crossref");
	}
	const managedCrossrefDoi = currentManagedDoi(
		snapshot,
		"crossref",
		"test",
		"primary",
	);
	if (!managedCrossrefDoi) {
		throw new Error("The record does not have a managed Crossref DOI");
	}
	const bibliographicDoi = resolveBibliographicDoi({
		DOI: snapshot.record.DOI,
		extra: snapshot.record.extra,
		attachments: snapshot.attachments,
	});
	if (bibliographicDoi.status === "conflict") {
		throw new Error(
			"This record contains different DOI values. Make them match before publishing it to Crossref",
		);
	}
	if (
		bibliographicDoi.status !== "resolved" ||
		bibliographicDoi.doi !== managedCrossrefDoi
	) {
		throw new Error(
			"The record DOI does not match its reserved Crossref DOI",
		);
	}
	const record = buildPublicationRecordSnapshot({
		record: snapshot.record,
		tags: snapshot.tags,
		baseUrl: config.identity.baseUrl,
		license: publicationConfig.zenodo.license,
	});
	const files = buildPublicationFileManifest(snapshot.files);
	const identifiers = buildPublicationIdentifiers({
		bibliographicDoi: bibliographicDoi.doi,
		managedCrossrefDoi,
	});
	const previousState = providerState(
		snapshot,
		"crossref",
		publicationConfig,
	);
	return {
		plan: planPublicationSync({
			record,
			files,
			identifiers,
			targets: {
				crossref: { enabled: true, environment: "test" },
				zenodo: { enabled: false },
			},
			...(previousState ? { state: previousState } : {}),
		}),
		previousState,
	};
}

async function recordCrossrefPending(
	database: Database,
	input: {
		recordId: string;
		stage: "relation_clear" | "deposit";
		payloadHash: string;
		batchId: string;
		filename: string;
		submittedAt: Date;
		pendingReason: string;
	},
) {
	await database
		.insert(publicationSyncState)
		.values({
			itemKey: input.recordId,
			provider: "crossref",
			environment: "test",
			pendingStage: input.stage,
			pendingPayloadHash: input.payloadHash,
			pendingBatchId: input.batchId,
			pendingFilename: input.filename,
			pendingSubmittedAt: input.submittedAt,
			pendingReason: input.pendingReason,
			updatedAt: input.submittedAt,
		})
		.onConflictDoUpdate({
			target: [
				publicationSyncState.itemKey,
				publicationSyncState.provider,
				publicationSyncState.environment,
			],
			set: {
				pendingStage: input.stage,
				pendingPayloadHash: input.payloadHash,
				pendingPayloadSnapshot: null,
				pendingBatchId: input.batchId,
				pendingFilename: input.filename,
				pendingSubmittedAt: input.submittedAt,
				pendingReason: input.pendingReason,
				updatedAt: input.submittedAt,
			},
		});
}

function patchValues(
	patch: ProviderSyncStatePatch,
	previousState: ProviderSyncState | undefined,
	now: Date,
) {
	const crossref = patch.crossref;
	const lastSuccess =
		crossref?.lastSuccess ?? previousState?.crossref?.lastSuccess;
	const pending =
		crossref && "pending" in crossref
			? crossref.pending
			: previousState?.crossref?.pending;
	const failure = "failure" in patch ? patch.failure : previousState?.failure;
	return {
		lastPayloadHash: lastSuccess?.payloadHash ?? null,
		lastPayloadSnapshot:
			(lastSuccess?.payloadSnapshot as
				Record<string, unknown> | undefined) ?? null,
		pendingStage: pending?.stage ?? null,
		pendingPayloadHash: pending?.payloadHash ?? null,
		pendingPayloadSnapshot:
			(pending?.payloadSnapshot as Record<string, unknown> | undefined) ??
			null,
		pendingBatchId: pending?.batchId ?? null,
		pendingFilename: pending?.filename ?? null,
		pendingSubmittedAt: pending?.submittedAt ?? null,
		pendingReason: pending?.reason ?? null,
		lastFailureClass:
			failure?.provider === "crossref" ? failure.failureClass : null,
		lastFailureSummary:
			failure?.provider === "crossref" ? failure.summary : null,
		consecutiveFailures:
			failure?.provider === "crossref" ? failure.consecutiveCount : 0,
		updatedAt: now,
	};
}

async function settleCrossrefState(
	database: Database,
	input: {
		jobId: number;
		workerId: string;
		itemKey: string;
		canonicalRevision: number;
		patch: ProviderSyncStatePatch;
		previousState: ProviderSyncState | undefined;
		settledAt: Date;
		verified: boolean;
		jobResult:
			| { status: "finished"; receipt: Record<string, unknown> }
			| {
					status: "deferred";
					delayMs: number;
					error: string;
					deadLetter: boolean;
			  };
	},
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		const values = patchValues(
			input.patch,
			input.previousState,
			input.settledAt,
		);
		await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.itemKey,
				provider: "crossref",
				environment: "test",
				...values,
			})
			.onConflictDoUpdate({
				target: [
					publicationSyncState.itemKey,
					publicationSyncState.provider,
					publicationSyncState.environment,
				],
				set: values,
			});
		if (input.verified) {
			await transaction
				.update(publicationIdentifier)
				.set({
					lifecycle: "verified",
					verifiedAt: input.settledAt,
					updatedAt: input.settledAt,
				})
				.where(
					and(
						eq(publicationIdentifier.itemKey, input.itemKey),
						eq(publicationIdentifier.registrar, "crossref"),
						eq(publicationIdentifier.environment, "test"),
						eq(publicationIdentifier.role, "primary"),
						eq(publicationIdentifier.ownership, "managed"),
						eq(publicationIdentifier.isCurrent, true),
					),
				);
			const [current] = await transaction
				.select({ revision: item.revision })
				.from(item)
				.where(eq(item.key, input.itemKey))
				.limit(1);
			await enqueueItemSearchReprojection(transaction, {
				itemKey: input.itemKey,
				revision: current?.revision ?? input.canonicalRevision,
				queuedAt: input.settledAt,
			});
		}
		if (input.jobResult.status === "finished") {
			await finishPublicationJob(transaction, {
				jobId: input.jobId,
				workerId: input.workerId,
				finishedAt: input.settledAt,
				receipt: input.jobResult.receipt,
			});
		} else {
			await deferPublicationJob(transaction, {
				jobId: input.jobId,
				workerId: input.workerId,
				deferredAt: input.settledAt,
				delayMs: input.jobResult.delayMs,
				error: input.jobResult.error,
				deadLetter: input.jobResult.deadLetter,
			});
		}
	});
}

async function settleCrossrefWorkerFailure(
	database: Database,
	input: {
		jobId: number;
		workerId: string;
		itemKey: string;
		failedAt: Date;
		delayMs: number;
		error: string;
		deadLetter: boolean;
	},
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.itemKey,
				provider: "crossref",
				environment: "test",
				lastFailureClass: "CROSSREF_WORKER_FAILED",
				lastFailureSummary: input.error,
				consecutiveFailures: 1,
				updatedAt: input.failedAt,
			})
			.onConflictDoUpdate({
				target: [
					publicationSyncState.itemKey,
					publicationSyncState.provider,
					publicationSyncState.environment,
				],
				set: {
					lastFailureClass: "CROSSREF_WORKER_FAILED",
					lastFailureSummary: input.error,
					consecutiveFailures: sql`${publicationSyncState.consecutiveFailures} + 1`,
					updatedAt: input.failedAt,
				},
			});
		await deferPublicationJob(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			deferredAt: input.failedAt,
			delayMs: input.delayMs,
			error: input.error,
			deadLetter: input.deadLetter,
		});
	});
}

function failedResult(results: readonly PublicationSyncOperationResult[]) {
	return results.find(
		(
			result,
		): result is Extract<
			PublicationSyncOperationResult,
			{ status: "failed" }
		> => result.status === "failed",
	);
}

function isPermanentCrossrefFailure(failureClass: string) {
	return failureClass === "CROSSREF_FAILED";
}

export async function runCrossrefPublicationJobsOnce(
	database: Database,
	config: PublicationConfig,
	options: {
		provider?: CrossrefDepositor;
		workerId?: string;
		now?: () => Date;
	} = {},
) {
	const workerId = options.workerId ?? `crossref-once-${process.pid}`;
	const now = options.now ?? (() => new Date());
	const workerConfig = config.services.publication.worker;
	const claimed = await claimPublicationJobs(database, {
		provider: "crossref",
		environment: "test",
		workerId,
		limit: workerConfig.batchSize,
		leaseSeconds: workerConfig.leaseSeconds,
		claimedAt: now(),
	});
	const outcomes: Array<{ jobId: number; status: string }> = [];
	for (const job of claimed) {
		try {
			const built = await buildCrossrefPlan(
				database,
				job.itemKey,
				config,
			);
			if (
				built.plan.status === "skipped" ||
				built.plan.status === "waiting_for_file"
			) {
				throw new Error(
					"The Crossref target did not produce a runnable plan",
				);
			}
			if (built.plan.status === "needs_attention") {
				const settledAt = now();
				const settlement = settlePublicationSyncState({
					plan: built.plan,
					previousState: built.previousState,
					observedAt: settledAt,
				});
				await settleCrossrefState(database, {
					jobId: job.id,
					workerId,
					itemKey: job.itemKey,
					canonicalRevision: job.canonicalRevision,
					patch: settlement.statePatch,
					previousState: built.previousState,
					settledAt,
					verified: false,
					jobResult: {
						status: "deferred",
						delayMs: 0,
						error: "The record does not meet Crossref publication requirements.",
						deadLetter: true,
					},
				});
				outcomes.push({ jobId: job.id, status: "failed" });
				continue;
			}

			let results: readonly PublicationSyncOperationResult[] = [];
			if (built.plan.status === "write_required") {
				results = await executeLivePublicationSyncPlan({
					plan: built.plan,
					credentials: {},
					providers: {
						crossref: options.provider ?? new CrossrefApiClient(),
					},
					crossref: requireConfig(config),
					crossrefJournal: {
						recordCrossrefPendingDeposit: (pending) =>
							recordCrossrefPending(database, pending),
					},
					now,
				});
			}
			const settledAt = now();
			const settlement = settlePublicationSyncState({
				plan: built.plan,
				previousState: built.previousState,
				operationResults: results,
				observedAt: settledAt,
			});
			const failure = failedResult(results);
			const pending = results.some(
				(result) => result.status === "pending",
			);
			const deadLetter = failure
				? isPermanentCrossrefFailure(failure.failureClass) ||
					job.attempts >= workerConfig.retryLimit
				: false;
			const jobResult = failure
				? {
						status: "deferred" as const,
						delayMs: Math.min(
							60_000 * 2 ** Math.max(job.attempts - 1, 0),
							3_600_000,
						),
						error: failure.failureSummary,
						deadLetter,
					}
				: pending
					? {
							status: "deferred" as const,
							delayMs: 60_000,
							error: "Crossref accepted the deposit and is still verifying it.",
							deadLetter: false,
						}
					: {
							status: "finished" as const,
							receipt: {
								provider: "crossref",
								environment: "test",
								verified: true,
							},
						};
			await settleCrossrefState(database, {
				jobId: job.id,
				workerId,
				itemKey: job.itemKey,
				canonicalRevision: job.canonicalRevision,
				patch: settlement.statePatch,
				previousState: built.previousState,
				settledAt,
				verified: !failure && !pending,
				jobResult,
			});
			if (failure) {
				outcomes.push({
					jobId: job.id,
					status: deadLetter ? "failed" : "retrying",
				});
			} else if (pending) {
				outcomes.push({ jobId: job.id, status: "verifying" });
			} else {
				outcomes.push({ jobId: job.id, status: "succeeded" });
			}
		} catch (error) {
			if (error instanceof PublicationJobLeaseLostError) {
				outcomes.push({ jobId: job.id, status: "lease_lost" });
				continue;
			}
			const failedAt = now();
			const summary =
				error instanceof Error
					? error.message
					: "Crossref worker failed";
			const deadLetter = job.attempts >= workerConfig.retryLimit;
			try {
				await settleCrossrefWorkerFailure(database, {
					jobId: job.id,
					workerId,
					itemKey: job.itemKey,
					failedAt,
					delayMs: 60_000,
					error: summary,
					deadLetter,
				});
			} catch (settlementError) {
				if (settlementError instanceof PublicationJobLeaseLostError) {
					outcomes.push({ jobId: job.id, status: "lease_lost" });
					continue;
				}
				throw settlementError;
			}
			outcomes.push({
				jobId: job.id,
				status: deadLetter ? "failed" : "retrying",
			});
		}
	}
	return outcomes;
}
