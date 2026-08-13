import {
	executeLivePublicationSyncPlan,
	planPublicationSync,
	settleProviderSyncFailure,
	settlePublicationSyncState,
	ZenodoApiClient,
	type ClearZenodoOrphanDraftCleanupInput,
	type ClearZenodoPublishDraftInput,
	type MarkZenodoPublishDraftPublishedInput,
	type ProviderSyncState,
	type ProviderSyncStatePatch,
	type PublicationSyncOperationResult,
	type PublicationSyncPlan,
	type RecordZenodoPublishDraftInput,
	type ZenodoPublishJournalWriter,
	type ZenodoRecordIdentifiers,
	type ZenodoWriter,
} from "@opendeved/doi-sync-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationIdentifier,
	publicationSyncState,
	publicationTarget,
	zenodoPublishJournal,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";

import { resolveBibliographicDoi } from "./bibliographic-doi";
import { createPublicationFileReader } from "./publication-file-adapter";
import {
	assertPublicationJobLease,
	claimNextPublicationJob,
	deferPublicationJob,
	enqueueItemSearchReprojection,
	finishPublicationJob,
	PublicationJobLeaseLostError,
	withPublicationJobHeartbeat,
} from "./queue";
import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
} from "./record-adapter";
import { readPublicationRepositorySnapshot } from "./repository";
import { currentManagedDoi, providerState, targetFor } from "./state-adapter";

type PublicationConfig = Pick<LibraryServerConfig, "identity" | "services">;

function requireConfig(config: PublicationConfig) {
	const zenodo = config.services.publication.zenodo;
	if (!zenodo.enabled || !zenodo.token) {
		throw new Error("Zenodo Sandbox publishing is not fully configured");
	}
	return { ...zenodo, token: zenodo.token };
}

async function buildZenodoPlan(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
) {
	const publicationConfig = config.services.publication;
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		publicationConfig.crossref.environment,
	);
	const record = snapshot.record;
	if (!record) throw new Error("The publication record no longer exists");
	if (record.deleted === 1) {
		throw new Error("Restore this record before publishing it to Zenodo");
	}
	if (record.parentItem) {
		throw new Error("Only parent records can be published to Zenodo");
	}
	const target = targetFor(snapshot, "zenodo", "sandbox");
	if (!target?.identifierPolicy) {
		throw new Error("The record does not have an active Zenodo target");
	}
	const managedCrossrefDoi = currentManagedDoi(
		snapshot,
		"crossref",
		"test",
		"primary",
	);
	const managedZenodoDois = snapshot.identifiers
		.filter(
			(identifier) =>
				identifier.registrar === "zenodo" &&
				identifier.environment === "sandbox" &&
				identifier.ownership === "managed",
		)
		.map((identifier) => identifier.doi);
	const bibliographicDoi = resolveBibliographicDoi(
		{
			DOI: record.DOI,
			extra: record.extra,
			attachments: snapshot.attachments,
		},
		{ ignoredDois: managedZenodoDois },
	);
	if (bibliographicDoi.status === "conflict") {
		throw new Error(
			"This record contains different DOI values. Make them match before publishing it to Zenodo",
		);
	}
	const recordSnapshot = buildPublicationRecordSnapshot({
		record,
		tags: snapshot.tags,
		baseUrl: config.identity.baseUrl,
		license: publicationConfig.zenodo.license,
	});
	const files = buildPublicationFileManifest(snapshot.files);
	const identifiers = buildPublicationIdentifiers({
		bibliographicDoi: bibliographicDoi.doi,
		managedCrossrefDoi,
		zenodoVersionDoi: currentManagedDoi(
			snapshot,
			"zenodo",
			"sandbox",
			"version",
		),
		zenodoConceptDoi: currentManagedDoi(
			snapshot,
			"zenodo",
			"sandbox",
			"concept",
		),
	});
	const previousState = providerState(snapshot, "zenodo", publicationConfig);
	return {
		identifierPolicy: target.identifierPolicy,
		plan: planPublicationSync({
			record: recordSnapshot,
			files,
			identifiers,
			targets: {
				crossref: { enabled: false },
				zenodo: {
					enabled: true,
					environment: "sandbox",
					identifierPolicy: target.identifierPolicy,
				},
			},
			...(previousState ? { state: previousState } : {}),
		}),
		previousState,
		snapshot,
	};
}

async function assertNoIdentifierCollision(
	transaction: DatabaseTransaction,
	itemKey: string,
	dois: readonly string[],
) {
	if (dois.length === 0) return;
	for (const doi of [...dois].sort()) {
		await transaction.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended('publication:zenodo-doi:' || ${doi}, 0))`,
		);
	}
	const collisions = await transaction
		.select({
			doi: publicationIdentifier.doi,
			itemKey: publicationIdentifier.itemKey,
		})
		.from(publicationIdentifier)
		.where(
			and(
				eq(publicationIdentifier.registrar, "zenodo"),
				eq(publicationIdentifier.environment, "sandbox"),
				inArray(publicationIdentifier.doi, [...dois]),
			),
		);
	const collision = collisions.find((row) => row.itemKey !== itemKey);
	if (collision) {
		throw new Error(
			`Zenodo DOI ${collision.doi} is already managed by record ${collision.itemKey}`,
		);
	}
}

async function saveZenodoIdentifiers(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		identifiers: ZenodoRecordIdentifiers;
		observedAt: Date;
	},
) {
	const values = [
		...(input.identifiers.versionDoi
			? [{ role: "version" as const, doi: input.identifiers.versionDoi }]
			: []),
		...(input.identifiers.conceptDoi
			? [{ role: "concept" as const, doi: input.identifiers.conceptDoi }]
			: []),
	];
	await assertNoIdentifierCollision(
		transaction,
		input.itemKey,
		values.map(({ doi }) => doi),
	);
	for (const value of values) {
		await transaction
			.update(publicationIdentifier)
			.set({ isCurrent: false, updatedAt: input.observedAt })
			.where(
				and(
					eq(publicationIdentifier.itemKey, input.itemKey),
					eq(publicationIdentifier.registrar, "zenodo"),
					eq(publicationIdentifier.environment, "sandbox"),
					eq(publicationIdentifier.role, value.role),
					eq(publicationIdentifier.isCurrent, true),
				),
			);
		await transaction
			.insert(publicationIdentifier)
			.values({
				itemKey: input.itemKey,
				registrar: "zenodo",
				environment: "sandbox",
				role: value.role,
				doi: value.doi,
				ownership: "managed",
				lifecycle: "verified",
				isCurrent: true,
				reservedAt: input.observedAt,
				verifiedAt: input.observedAt,
				createdAt: input.observedAt,
				updatedAt: input.observedAt,
			})
			.onConflictDoUpdate({
				target: [
					publicationIdentifier.registrar,
					publicationIdentifier.environment,
					publicationIdentifier.doi,
				],
				set: {
					itemKey: input.itemKey,
					role: value.role,
					ownership: "managed",
					lifecycle: "verified",
					isCurrent: true,
					verifiedAt: input.observedAt,
					updatedAt: input.observedAt,
				},
			});
	}
}

function createZenodoJournal(
	database: Database,
	job: { id: number; itemKey: string },
	workerId: string,
	plan: Extract<PublicationSyncPlan, { status: "write_required" }>,
): ZenodoPublishJournalWriter {
	const withLease = async (
		observedAt: Date,
		operation: (transaction: DatabaseTransaction) => Promise<void>,
	) => {
		await database.transaction(async (transaction) => {
			await lockItemMutation(transaction, job.itemKey);
			await assertPublicationJobLease(transaction, {
				jobId: job.id,
				workerId,
				observedAt,
			});
			await operation(transaction);
		});
		void observedAt;
	};
	return {
		recordZenodoPublishDraft: (input: RecordZenodoPublishDraftInput) =>
			withLease(input.observedAt, async (transaction) => {
				await transaction
					.insert(zenodoPublishJournal)
					.values({
						itemKey: input.recordId,
						operationType: input.operationType,
						payloadHash: input.zenodoPayloadHash,
						payloadSnapshot: plan.snapshots.zenodoPayload as Record<
							string,
							unknown
						>,
						fileManifestHash: input.fileManifestHash ?? null,
						fileManifestSnapshot: input.fileManifestHash
							? (plan.snapshots.fileManifest as Record<
									string,
									unknown
								>)
							: null,
						depositionId: input.depositionId,
						draftRecordId: input.draftRecordId,
						parentId: input.parentId ?? null,
						status: input.status ?? "preparing",
						createdAt: input.observedAt,
						updatedAt: input.observedAt,
					})
					.onConflictDoUpdate({
						target: [
							zenodoPublishJournal.environment,
							zenodoPublishJournal.depositionId,
						],
						set: {
							operationType: input.operationType,
							payloadHash: input.zenodoPayloadHash,
							payloadSnapshot: plan.snapshots
								.zenodoPayload as Record<string, unknown>,
							fileManifestHash: input.fileManifestHash ?? null,
							fileManifestSnapshot: input.fileManifestHash
								? (plan.snapshots.fileManifest as Record<
										string,
										unknown
									>)
								: null,
							draftRecordId: input.draftRecordId,
							parentId: input.parentId ?? null,
							status: input.status ?? "preparing",
							updatedAt: input.observedAt,
						},
					});
			}),
		markZenodoPublishDraftPublished: (
			input: MarkZenodoPublishDraftPublishedInput,
		) =>
			withLease(input.observedAt, async (transaction) => {
				const [savedDraft] = await transaction
					.select({
						payloadHash: zenodoPublishJournal.payloadHash,
						payloadSnapshot: zenodoPublishJournal.payloadSnapshot,
						fileManifestHash: zenodoPublishJournal.fileManifestHash,
						fileManifestSnapshot:
							zenodoPublishJournal.fileManifestSnapshot,
					})
					.from(zenodoPublishJournal)
					.where(
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(
								zenodoPublishJournal.depositionId,
								input.depositionId,
							),
						),
					)
					.limit(1);
				if (!savedDraft)
					throw new Error(
						"The prepared Zenodo draft was not journaled",
					);
				await saveZenodoIdentifiers(transaction, {
					itemKey: input.recordId,
					identifiers: input.identifiers,
					observedAt: input.observedAt,
				});
				const [target] = await transaction
					.select({
						identifierPolicy: publicationTarget.identifierPolicy,
					})
					.from(publicationTarget)
					.where(
						and(
							eq(publicationTarget.itemKey, input.recordId),
							eq(publicationTarget.provider, "zenodo"),
							eq(publicationTarget.environment, "sandbox"),
						),
					)
					.limit(1);
				if (!target?.identifierPolicy) {
					throw new Error("The Zenodo target has no DOI policy");
				}
				const [existingState] = await transaction
					.select({
						lastFileManifestHash:
							publicationSyncState.lastFileManifestHash,
						lastFileManifestSnapshot:
							publicationSyncState.lastFileManifestSnapshot,
					})
					.from(publicationSyncState)
					.where(
						and(
							eq(publicationSyncState.itemKey, input.recordId),
							eq(publicationSyncState.provider, "zenodo"),
							eq(publicationSyncState.environment, "sandbox"),
						),
					)
					.limit(1);
				const lastFileManifestHash =
					savedDraft.fileManifestHash ??
					existingState?.lastFileManifestHash ??
					null;
				const lastFileManifestSnapshot =
					savedDraft.fileManifestSnapshot ??
					existingState?.lastFileManifestSnapshot ??
					null;
				await transaction
					.insert(publicationSyncState)
					.values({
						itemKey: input.recordId,
						provider: "zenodo",
						environment: "sandbox",
						identifierPolicy: target.identifierPolicy,
						lastPayloadHash: savedDraft.payloadHash,
						lastPayloadSnapshot: savedDraft.payloadSnapshot,
						lastFileManifestHash,
						lastFileManifestSnapshot,
						zenodoRecordId: input.identifiers.latestRecordId,
						zenodoParentId: input.identifiers.parentId,
						zenodoVersionDoi: input.identifiers.versionDoi ?? null,
						zenodoConceptDoi: input.identifiers.conceptDoi ?? null,
						orphanDraftDepositionId:
							input.orphanDraftCleanup?.depositionId ?? null,
						updatedAt: input.observedAt,
					})
					.onConflictDoUpdate({
						target: [
							publicationSyncState.itemKey,
							publicationSyncState.provider,
							publicationSyncState.environment,
						],
						set: {
							identifierPolicy: target.identifierPolicy,
							lastPayloadHash: savedDraft.payloadHash,
							lastPayloadSnapshot: savedDraft.payloadSnapshot,
							lastFileManifestHash,
							lastFileManifestSnapshot,
							zenodoRecordId: input.identifiers.latestRecordId,
							zenodoParentId: input.identifiers.parentId,
							zenodoVersionDoi:
								input.identifiers.versionDoi ?? null,
							zenodoConceptDoi:
								input.identifiers.conceptDoi ?? null,
							orphanDraftDepositionId:
								input.orphanDraftCleanup?.depositionId ?? null,
							updatedAt: input.observedAt,
						},
					});
				const [journal] = await transaction
					.update(zenodoPublishJournal)
					.set({
						status: "published",
						publishedRecordId: input.publishedRecordId,
						identifiers: input.identifiers as unknown as Record<
							string,
							unknown
						>,
						orphanDraftCleanupDepositionId:
							input.orphanDraftCleanup?.depositionId ?? null,
						publishedAt: input.observedAt,
						updatedAt: input.observedAt,
					})
					.where(
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(
								zenodoPublishJournal.depositionId,
								input.depositionId,
							),
						),
					)
					.returning({ id: zenodoPublishJournal.id });
				if (!journal)
					throw new Error(
						"The prepared Zenodo draft was not journaled",
					);
				const [current] = await transaction
					.select({ revision: item.revision })
					.from(item)
					.where(eq(item.key, input.recordId))
					.limit(1);
				if (!current)
					throw new Error("The published record no longer exists");
				await enqueueItemSearchReprojection(transaction, {
					itemKey: input.recordId,
					revision: current.revision,
					queuedAt: input.observedAt,
				});
			}),
		clearZenodoPublishDraft: (input: ClearZenodoPublishDraftInput) =>
			withLease(input.observedAt, async (transaction) => {
				await transaction
					.delete(zenodoPublishJournal)
					.where(
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(
								zenodoPublishJournal.depositionId,
								input.depositionId,
							),
						),
					);
			}),
		clearZenodoOrphanDraftCleanup: (
			input: ClearZenodoOrphanDraftCleanupInput,
		) =>
			withLease(input.observedAt, async (transaction) => {
				await transaction
					.update(publicationSyncState)
					.set({
						orphanDraftDepositionId: null,
						updatedAt: input.observedAt,
					})
					.where(
						and(
							eq(publicationSyncState.itemKey, input.recordId),
							eq(publicationSyncState.provider, "zenodo"),
							eq(publicationSyncState.environment, "sandbox"),
							eq(
								publicationSyncState.orphanDraftDepositionId,
								input.depositionId,
							),
						),
					);
				await transaction
					.update(zenodoPublishJournal)
					.set({
						orphanDraftCleanupDepositionId: null,
						updatedAt: input.observedAt,
					})
					.where(
						eq(
							zenodoPublishJournal.orphanDraftCleanupDepositionId,
							input.depositionId,
						),
					);
			}),
	};
}

function zenodoPatchValues(
	patch: ProviderSyncStatePatch,
	previousState: ProviderSyncState | undefined,
	identifierPolicy: "reuse-crossref" | "mint-zenodo",
	now: Date,
) {
	const zenodo = patch.zenodo;
	const lastSuccess =
		zenodo?.lastSuccess ?? previousState?.zenodo?.lastSuccess;
	const previousSuccess = previousState?.zenodo?.lastSuccess;
	const identifiers =
		zenodo?.identifiers ?? previousState?.zenodo?.identifiers;
	const orphanDraftCleanup =
		zenodo && "orphanDraftCleanup" in zenodo
			? zenodo.orphanDraftCleanup
			: previousState?.zenodo?.orphanDraftCleanup;
	const failure = "failure" in patch ? patch.failure : previousState?.failure;
	const savedIdentifierPolicy =
		zenodo?.identifierPolicy ??
		previousState?.zenodo?.identifierPolicy ??
		identifierPolicy;
	return {
		identifierPolicy: savedIdentifierPolicy,
		lastPayloadHash: lastSuccess?.payloadHash ?? null,
		lastPayloadSnapshot:
			(lastSuccess?.payloadSnapshot as
				Record<string, unknown> | undefined) ??
			(lastSuccess?.payloadHash === previousSuccess?.payloadHash
				? (previousSuccess?.payloadSnapshot as
						Record<string, unknown> | undefined)
				: undefined) ??
			null,
		lastFileManifestHash: lastSuccess?.fileManifestHash ?? null,
		lastFileManifestSnapshot:
			(lastSuccess?.fileManifestSnapshot as
				Record<string, unknown> | undefined) ??
			(lastSuccess?.fileManifestHash === previousSuccess?.fileManifestHash
				? (previousSuccess?.fileManifestSnapshot as
						Record<string, unknown> | undefined)
				: undefined) ??
			null,
		zenodoRecordId: identifiers?.latestRecordId ?? null,
		zenodoParentId: identifiers?.parentId ?? null,
		zenodoVersionDoi: identifiers?.versionDoi ?? null,
		zenodoConceptDoi: identifiers?.conceptDoi ?? null,
		orphanDraftDepositionId: orphanDraftCleanup?.depositionId ?? null,
		lastFailureClass:
			failure?.provider === "zenodo" ? failure.failureClass : null,
		lastFailureSummary:
			failure?.provider === "zenodo" ? failure.summary : null,
		consecutiveFailures:
			failure?.provider === "zenodo" ? failure.consecutiveCount : 0,
		updatedAt: now,
	};
}

async function settleZenodoState(
	database: Database,
	input: {
		jobId: number;
		workerId: string;
		itemKey: string;
		canonicalRevision: number;
		patch: ProviderSyncStatePatch;
		previousState: ProviderSyncState | undefined;
		identifierPolicy: "reuse-crossref" | "mint-zenodo";
		settledAt: Date;
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
		await assertPublicationJobLease(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			observedAt: input.settledAt,
		});
		const values = zenodoPatchValues(
			input.patch,
			input.previousState,
			input.identifierPolicy,
			input.settledAt,
		);
		await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.itemKey,
				provider: "zenodo",
				environment: "sandbox",
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
		if (values.zenodoRecordId && values.zenodoParentId) {
			await saveZenodoIdentifiers(transaction, {
				itemKey: input.itemKey,
				identifiers: {
					latestRecordId: values.zenodoRecordId,
					parentId: values.zenodoParentId,
					...(values.zenodoVersionDoi
						? { versionDoi: values.zenodoVersionDoi }
						: {}),
					...(values.zenodoConceptDoi
						? { conceptDoi: values.zenodoConceptDoi }
						: {}),
					links: {},
				},
				observedAt: input.settledAt,
			});
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

export async function runZenodoPublicationJobsOnce(
	database: Database,
	config: PublicationConfig,
	storage: EvidenceFileStorage,
	options: {
		heartbeatIntervalMs?: number;
		provider?: ZenodoWriter;
		signal?: AbortSignal;
		workerId?: string;
		now?: () => Date;
	} = {},
) {
	const zenodo = requireConfig(config);
	const workerId = options.workerId ?? `zenodo-once-${process.pid}`;
	const now = options.now ?? (() => new Date());
	const workerConfig = config.services.publication.worker;
	const outcomes: Array<{ jobId: number; status: string }> = [];
	for (
		let processed = 0;
		processed < workerConfig.batchSize;
		processed += 1
	) {
		const job = await claimNextPublicationJob(database, {
			provider: "zenodo",
			environment: "sandbox",
			workerId,
			leaseSeconds: workerConfig.leaseSeconds,
			claimedAt: now(),
		});
		if (!job) break;
		try {
			const built = await buildZenodoPlan(database, job.itemKey, config);
			if (
				built.plan.status === "skipped" ||
				built.plan.status === "waiting_for_file"
			) {
				throw new Error(
					"The Zenodo target did not produce a runnable plan",
				);
			}
			let results: readonly PublicationSyncOperationResult[] = [];
			if (built.plan.status === "write_required") {
				const runnablePlan = built.plan;
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
							plan: runnablePlan,
							credentials: { zenodoToken: zenodo.token },
							providers: {
								zenodo:
									options.provider ??
									new ZenodoApiClient({
										fetch: (url, init) =>
											fetch(url, { ...init, signal }),
									}),
							},
							fileReader: createPublicationFileReader(
								storage,
								built.snapshot.files,
							),
							zenodoJournal: createZenodoJournal(
								database,
								job,
								workerId,
								runnablePlan,
							),
							now,
						}),
				);
			}
			const settledAt = now();
			const durableState = providerState(
				await readPublicationRepositorySnapshot(
					database,
					job.itemKey,
					config.services.publication.crossref.environment,
				),
				"zenodo",
				config.services.publication,
			);
			const settlement = settlePublicationSyncState({
				plan: built.plan,
				previousState: durableState ?? built.previousState,
				operationResults: results,
				observedAt: settledAt,
			});
			const operationFailure = results.find(
				(result) => result.status === "failed",
			);
			const cleanupFailure = results.find(
				(result) =>
					result.status === "succeeded" &&
					result.zenodoOrphanDraftCleanup?.status === "failed",
			);
			const stateFailure =
				settlement.statePatch.failure?.provider === "zenodo"
					? settlement.statePatch.failure
					: null;
			const failure =
				operationFailure?.status === "failed"
					? {
							failureClass: operationFailure.failureClass,
							summary: operationFailure.failureSummary,
							consecutiveCount:
								stateFailure?.consecutiveCount ?? 1,
						}
					: cleanupFailure?.status === "succeeded"
						? {
								failureClass:
									cleanupFailure.zenodoOrphanDraftCleanup
										?.failureClass ??
									"ZENODO_ORPHAN_DRAFT_CLEANUP_FAILED",
								summary:
									cleanupFailure.zenodoOrphanDraftCleanup
										?.failureSummary ??
									"Zenodo orphaned draft cleanup failed",
								consecutiveCount:
									stateFailure?.consecutiveCount ?? 1,
							}
						: stateFailure;
			const recoveryOnly =
				built.plan.status === "write_required" &&
				built.plan.operations.length > 0 &&
				built.plan.operations.every(
					(operation) =>
						operation.type === "zenodo_discard_preparing_draft" ||
						operation.type === "zenodo_cleanup_orphan_draft",
				);
			const deadLetter = failure
				? built.plan.status === "needs_attention" ||
					failure.consecutiveCount >= workerConfig.retryLimit
				: false;
			await settleZenodoState(database, {
				jobId: job.id,
				workerId,
				itemKey: job.itemKey,
				canonicalRevision: job.canonicalRevision,
				patch: settlement.statePatch,
				previousState: durableState ?? built.previousState,
				identifierPolicy: built.identifierPolicy,
				settledAt,
				jobResult: failure
					? {
							status: "deferred",
							delayMs: Math.min(
								60_000 *
									2 **
										Math.max(
											failure.consecutiveCount - 1,
											0,
										),
								3_600_000,
							),
							error: failure.summary,
							deadLetter,
						}
					: recoveryOnly
						? {
								status: "deferred",
								delayMs: 0,
								error: "Recovered saved Zenodo work. Publication will continue on the next run.",
								deadLetter: false,
							}
						: {
								status: "finished",
								receipt: {
									provider: "zenodo",
									environment: "sandbox",
									published: true,
								},
							},
			});
			outcomes.push({
				jobId: job.id,
				status: failure
					? deadLetter
						? "failed"
						: "retrying"
					: recoveryOnly
						? "recovered"
						: "succeeded",
			});
		} catch (error) {
			if (error instanceof PublicationJobLeaseLostError) {
				outcomes.push({ jobId: job.id, status: "lease-lost" });
				continue;
			}
			const failedAt = now();
			const previousState = providerState(
				await readPublicationRepositorySnapshot(
					database,
					job.itemKey,
					"test",
				),
				"zenodo",
				config.services.publication,
			);
			const [target] = await database
				.select({
					identifierPolicy: publicationTarget.identifierPolicy,
				})
				.from(publicationTarget)
				.where(
					and(
						eq(publicationTarget.itemKey, job.itemKey),
						eq(publicationTarget.provider, "zenodo"),
						eq(publicationTarget.environment, "sandbox"),
					),
				)
				.limit(1);
			if (!target?.identifierPolicy) {
				await deferPublicationJob(database, {
					jobId: job.id,
					workerId,
					deferredAt: failedAt,
					delayMs: 0,
					error: "The Zenodo target is missing its DOI policy.",
					deadLetter: true,
				});
				outcomes.push({ jobId: job.id, status: "failed" });
				continue;
			}
			const patch = settleProviderSyncFailure({
				previousState,
				provider: "zenodo",
				failureClass:
					error instanceof Error ? error.name : "UNKNOWN_ERROR",
				failureSummary:
					error instanceof Error ? error.message : String(error),
			});
			const count = patch.failure?.consecutiveCount ?? 1;
			const deadLetter = count >= workerConfig.retryLimit;
			try {
				await settleZenodoState(database, {
					jobId: job.id,
					workerId,
					itemKey: job.itemKey,
					canonicalRevision: job.canonicalRevision,
					patch,
					previousState,
					identifierPolicy: target.identifierPolicy,
					settledAt: failedAt,
					jobResult: {
						status: "deferred",
						delayMs: Math.min(
							60_000 * 2 ** Math.max(count - 1, 0),
							3_600_000,
						),
						error:
							error instanceof Error
								? error.message
								: String(error),
						deadLetter,
					},
				});
				outcomes.push({
					jobId: job.id,
					status: deadLetter ? "failed" : "retrying",
				});
			} catch (settlementError) {
				if (settlementError instanceof PublicationJobLeaseLostError) {
					outcomes.push({ jobId: job.id, status: "lease-lost" });
					continue;
				}
				throw settlementError;
			}
		}
	}
	return outcomes;
}
