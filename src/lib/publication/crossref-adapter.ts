import type { PublicationSettlement } from "./queue";
import {
	CrossrefApiClient,
	executeLivePublicationSyncPlan,
	planPublicationSync,
	settlePublicationSyncState,
	type CrossrefDepositor,
	type CrossrefRelation,
	type ProviderSyncState,
	type ProviderSyncStatePatch,
	type PublicationSyncOperationResult,
} from "@opendeved/doi-sync-core";
import { and, eq, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationIdentifier,
	publicationSyncState,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";

import { resolveBibliographicDoi } from "./bibliographic-doi";

import { readPublicationRepositorySnapshot } from "./repository";
import { settlePublicationProviderAudit } from "./provider-audit";
import { currentManagedDoi, providerState, targetFor, publicationPlanData } from "./state-adapter";
import { loadPublicationRecordExtras, type PublicationExtrasConfig } from "./record-extras";
import {
	assertPublicationJobLease,
	claimNextPublicationJob,
	deferPublicationJob,
	settlePublicationJob,
	type PublicationJobResult,
	enqueueItemSearchReprojection,
	enqueuePublicationJobsForItem,
	PublicationJobLeaseLostError,
	withPublicationJobHeartbeat,
} from "./queue";

type PublicationConfig = PublicationExtrasConfig;

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
		throw new Error("Crossref publishing is not fully configured");
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

export async function buildCrossrefPlan(
	database: Database | DatabaseTransaction,
	itemKey: string,
	config: PublicationConfig,
	observedAt = new Date(),
) {
	const publicationConfig = config.services.publication;
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		publicationConfig.crossref.environment,
	);
	if (!snapshot.record)
		throw new Error("The publication record no longer exists");
	// A withdrawn record is registered again, saying so; any other removed record is restored first.
	if (snapshot.record.deleted === 1 && !snapshot.record.withdrawnAt) {
		throw new Error("Restore this record before publishing it to Crossref");
	}
	if (snapshot.record.parentItem) {
		throw new Error("Only parent records can be published to Crossref");
	}
	const managedCrossrefDoi = currentManagedDoi(
		snapshot,
		"crossref",
		publicationConfig.crossref.environment,
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
	const extras = await loadPublicationRecordExtras(database as Database, snapshot, config);
	const { record, files, identifiers } = publicationPlanData(snapshot, snapshot.record, config, bibliographicDoi.doi, managedCrossrefDoi, extras);
	const crossrefState = providerState(
		snapshot,
		"crossref",
		publicationConfig,
	);
	const zenodoState = providerState(snapshot, "zenodo", publicationConfig);
	const zenodoTarget = targetFor(snapshot, "zenodo", publicationConfig.zenodo.environment);
	const includeZenodoRelation =
		zenodoTarget?.identifierPolicy === "mint-zenodo" &&
		Boolean(
			zenodoState?.zenodo?.lastSuccess && zenodoState.zenodo.identifiers,
		);
	const previousState =
		crossrefState || (includeZenodoRelation && zenodoState)
			? {
					...(crossrefState?.crossref
						? { crossref: crossrefState.crossref }
						: {}),
					...(includeZenodoRelation && zenodoState?.zenodo
						? { zenodo: zenodoState.zenodo }
						: {}),
					...(crossrefState?.failure
						? { failure: crossrefState.failure }
						: {}),
				}
			: undefined;
	return {
		plan: planPublicationSync({
			observedAt,
			record,
			files,
			identifiers,
			targets: {
				crossref: { enabled: true, environment: publicationConfig.crossref.environment },
				zenodo: includeZenodoRelation
					? {
							enabled: true,
							environment: publicationConfig.zenodo.environment,
							identifierPolicy: "mint-zenodo",
						}
					: { enabled: false },
			},
			...(previousState ? { state: previousState } : {}),
		}),
		previousState,
	};
}

async function auditCrossrefPublishedState(
	database: Database,
	config: PublicationConfig,
	input: {
		job: NonNullable<Awaited<ReturnType<typeof claimNextPublicationJob>>>;
		workerId: string;
		built: Awaited<ReturnType<typeof buildCrossrefPlan>>;
		provider?: CrossrefDepositor;
		heartbeatIntervalMs?: number;
		signal?: AbortSignal;
		now: () => Date;
	},
) {
	const lastSuccess = input.built.previousState?.crossref?.lastSuccess;
	if (!lastSuccess)
		throw new Error("The Crossref audit job has no saved provider state");
	const plan = input.built.plan;
	if (plan.status !== "noop") {
		return settlePublicationProviderAudit(database, {
			jobId: input.job.id,
			workerId: input.workerId,
			itemKey: input.job.itemKey,
			provider: "crossref",
			environment: config.services.publication.crossref.environment,
			expectedPayloadHash: lastSuccess.payloadHash,
			observation: {
				status: "skipped",
				reason: "The local publication changed before the remote audit started.",
			},
			settledAt: input.now(),
		});
	}
	if (!plan.crossrefRecord) {
		throw new Error("The Crossref audit has no mapped publication record");
	}
	const crossrefSnapshot = plan.snapshots.crossrefPayload;
	const relation =
		crossrefSnapshot &&
		typeof crossrefSnapshot === "object" &&
		!Array.isArray(crossrefSnapshot)
			? (crossrefSnapshot as Record<string, unknown>).relation
			: undefined;
	const expectedRelation =
		relation && typeof relation === "object" && !Array.isArray(relation)
			? (relation as unknown as CrossrefRelation)
			: undefined;
	const verification = await withPublicationJobHeartbeat(
		database,
		{
			jobId: input.job.id,
			workerId: input.workerId,
			leaseSeconds: config.services.publication.worker.leaseSeconds,
			heartbeatIntervalMs: input.heartbeatIntervalMs,
			now: input.now,
			signal: input.signal,
		},
		(signal) => {
			const provider =
				input.provider ??
				new CrossrefApiClient({
					fetch: (url, init) => fetch(url, { ...init, signal }),
					poll: { maxAttempts: 1, delayMs: 0 },
				});
			return provider.verifyPublication({
				environment: config.services.publication.crossref.environment,
				emailAddress: requireConfig(config).emailAddress,
				record: plan.crossrefRecord!,
				...(expectedRelation ? { relation: expectedRelation } : {}),
			});
		},
	);
	return settlePublicationProviderAudit(database, {
		jobId: input.job.id,
		workerId: input.workerId,
		itemKey: input.job.itemKey,
		provider: "crossref",
		environment: config.services.publication.crossref.environment,
		expectedPayloadHash: lastSuccess.payloadHash,
		observation:
			verification.status === "matched"
				? { status: "matched" }
				: {
						status: "drifted",
						metadataReasons: [
							verification.reason ??
								"Crossref metadata does not match the saved deposit.",
						],
						fileReasons: [],
					},
		settledAt: input.now(),
	});
}

async function recordCrossrefPending(
	database: Database,
	input: {
		environment: "test" | "production";
		jobId: number;
		workerId: string;
		recordId: string;
		stage: "relation_clear" | "deposit";
		payloadHash: string;
		batchId: string;
		filename: string;
		submittedAt: Date;
		pendingReason: string;
	},
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.recordId);
		await assertPublicationJobLease(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			observedAt: input.submittedAt,
		});
		await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.recordId,
				provider: "crossref",
				environment: input.environment,
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
	input: PublicationSettlement & {
		environment: "test" | "production";
		verified: boolean;
	},
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		await assertPublicationJobLease(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			observedAt: input.settledAt,
		});
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
				environment: input.environment,
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
						eq(publicationIdentifier.environment, input.environment),
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
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: input.itemKey,
				canonicalRevision: current?.revision ?? input.canonicalRevision,
				reason: "crossref_verified",
				idempotencyDiscriminator: "crossref-verified",
				now: input.settledAt,
				providers: ["zenodo"],
			});
		}
		await settlePublicationJob(transaction, input);
	});
}

async function settleCrossrefWorkerFailure(
	database: Database,
	input: {
		environment: "test" | "production";
		jobId: number;
		workerId: string;
		itemKey: string;
		failedAt: Date;
		delayMs: number;
		error: string;
		retryLimit: number;
	},
) {
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		const [state] = await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.itemKey,
				provider: "crossref",
				environment: input.environment,
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
			})
			.returning({
				consecutiveFailures: publicationSyncState.consecutiveFailures,
			});
		const deadLetter =
			(state?.consecutiveFailures ?? 1) >= input.retryLimit;
		await deferPublicationJob(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			deferredAt: input.failedAt,
			delayMs: input.delayMs,
			error: input.error,
			deadLetter,
		});
		return deadLetter;
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
	return (
		failureClass === "CROSSREF_FAILED" ||
		failureClass === "CROSSREF_PENDING_STALE"
	);
}

const CROSSREF_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export async function runCrossrefPublicationJobsOnce(
	database: Database,
	config: PublicationConfig,
	options: {
		heartbeatIntervalMs?: number;
		provider?: CrossrefDepositor;
		signal?: AbortSignal;
		workerId?: string;
		now?: () => Date;
	} = {},
) {
	const workerId = options.workerId ?? `crossref-once-${process.pid}`;
	const now = options.now ?? (() => new Date());
	const workerConfig = config.services.publication.worker;
	const outcomes: Array<{ jobId: number; status: string }> = [];
	for (
		let processed = 0;
		processed < workerConfig.batchSize;
		processed += 1
	) {
		const job = await claimNextPublicationJob(database, {
			provider: "crossref",
			environment: config.services.publication.crossref.environment,
			workerId,
			leaseSeconds: workerConfig.leaseSeconds,
			claimedAt: now(),
		});
		if (!job) break;
		try {
			const built = await withPublicationJobHeartbeat(
				database,
				{
					jobId: job.id,
					workerId,
					leaseSeconds: workerConfig.leaseSeconds,
					heartbeatIntervalMs: options.heartbeatIntervalMs,
					now,
					signal: options.signal,
				},
				// Planning reads what the deposit carries from OpenAlex and the topic catalog, which can outlast a lease.
				() => buildCrossrefPlan(database, job.itemKey, config, now()),
			);
			if (job.reason === "provider_audit") {
				const audit = await auditCrossrefPublishedState(
					database,
					config,
					{
						job,
						workerId,
						built,
						...(options.provider
							? { provider: options.provider }
							: {}),
						...(options.heartbeatIntervalMs
							? {
									heartbeatIntervalMs:
										options.heartbeatIntervalMs,
								}
							: {}),
						...(options.signal ? { signal: options.signal } : {}),
						now,
					},
				);
				outcomes.push({
					jobId: job.id,
					status: audit.status === "drifted" ? "drifted" : "audited",
				});
				continue;
			}
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
					environment: config.services.publication.crossref.environment,
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

			const crossrefPlan =
				built.plan.status === "write_required"
					? {
							...built.plan,
							operations: built.plan.operations.filter(
								(operation) =>
									operation.type.startsWith("crossref_"),
							),
						}
					: built.plan;
			let results: readonly PublicationSyncOperationResult[] = [];
			if (crossrefPlan.status === "write_required") {
				results = await withPublicationJobHeartbeat(
					database,
					{
						jobId: job.id,
						workerId,
						leaseSeconds: workerConfig.leaseSeconds,
						heartbeatIntervalMs: options.heartbeatIntervalMs,
						now,
						signal: options.signal,
					},
					(signal) =>
						executeLivePublicationSyncPlan({
							plan: crossrefPlan,
							credentials: {},
							providers: {
								crossref:
									options.provider ??
									new CrossrefApiClient({
										fetch: (url, init) =>
											fetch(url, { ...init, signal }),
									}),
							},
							crossref: requireConfig(config),
							crossrefJournal: {
								recordCrossrefPendingDeposit: (pending) =>
									recordCrossrefPending(database, {
										...pending,
										jobId: job.id,
										workerId,
									}),
							},
							now,
						}),
				);
			}
			const settledAt = now();
			const settlement = settlePublicationSyncState({
				plan: crossrefPlan,
				previousState: built.previousState,
				operationResults: results,
				observedAt: settledAt,
				crossrefPendingMaxAgeMs: CROSSREF_PENDING_MAX_AGE_MS,
			});
			const operationFailure = failedResult(results);
			const stateFailure =
				settlement.statePatch.failure?.provider === "crossref"
					? settlement.statePatch.failure
					: null;
			const failure = operationFailure
				? {
						failureClass: operationFailure.failureClass,
						summary: operationFailure.failureSummary,
						consecutiveCount: stateFailure?.consecutiveCount ?? 1,
					}
				: stateFailure
					? {
							failureClass: stateFailure.failureClass,
							summary: stateFailure.summary,
							consecutiveCount: stateFailure.consecutiveCount,
						}
					: null;
			const pending = results.some(
				(result) => result.status === "pending",
			);
			const deadLetter = failure
				? isPermanentCrossrefFailure(failure.failureClass) ||
					failure.consecutiveCount >= workerConfig.retryLimit
				: false;
			const jobResult = failure
				? {
						status: "deferred" as const,
						delayMs: Math.min(
							60_000 *
								2 ** Math.max(failure.consecutiveCount - 1, 0),
							3_600_000,
						),
						error: failure.summary,
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
								environment: config.services.publication.crossref.environment,
								verified: true,
							},
						};
			await settleCrossrefState(database, {
				environment: config.services.publication.crossref.environment,
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
			try {
				const deadLetter = await settleCrossrefWorkerFailure(database, {
					environment: config.services.publication.crossref.environment,
					jobId: job.id,
					workerId,
					itemKey: job.itemKey,
					failedAt,
					delayMs: 60_000,
					error: summary,
					retryLimit: workerConfig.retryLimit,
				});
				outcomes.push({
					jobId: job.id,
					status: deadLetter ? "failed" : "retrying",
				});
			} catch (settlementError) {
				if (settlementError instanceof PublicationJobLeaseLostError) {
					outcomes.push({ jobId: job.id, status: "lease_lost" });
					continue;
				}
				throw settlementError;
			}
		}
	}
	return outcomes;
}
