import type { PublicationSettlement } from "./queue";
import { zenodoToken } from "./zenodo-token";
import { loadPublicationRecordExtras, type PublicationExtrasConfig } from "./record-extras";
import type {
	ZenodoIdentifierPolicy,
	ZenodoPublicationEnvironment,
} from "@/db/schema/publication";
import {
	executeLivePublicationSyncPlan,
	planPublicationSync,
	settleProviderSyncFailure,
	settlePublicationSyncState,
	ZenodoApiClient,
	parseZenodoRecordPayload,
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
	type ZenodoRemoteStateVerification,
	type ZenodoWriter,
} from "@opendeved/doi-sync-core";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationIdentifier,
	publicationSyncState,
	publicationTarget,
	zenodoFileCorrectionApproval,
	zenodoPublishJournal,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";

import { resolveBibliographicDoi } from "./bibliographic-doi";
import { fileCorrectionApprovalFromRow } from "./file-correction-approval";
import { createPublicationFileReader } from "./publication-file-adapter";
import {
	assertPublicationJobLease,
	claimNextPublicationJob,
	deferPublicationJob,
	settlePublicationJob,
	type PublicationJobResult,
	enqueueItemSearchReprojection,
	enqueuePublicationJobsForItem,
	finishPublicationJob,
	PublicationJobLeaseLostError,
	withPublicationJobHeartbeat,
} from "./queue";

import { readPublicationRepositorySnapshot } from "./repository";
import { settlePublicationProviderAudit } from "./provider-audit";
import {
	currentManagedDoi,
	DRIFTED_PAYLOAD_HASH,
	providerState,
	targetFor,
	publicationPlanData,
} from "./state-adapter";

type PublicationConfig = PublicationExtrasConfig;
function zenodoEndpoint(config: PublicationConfig) {
	return config.services.publication.zenodo.environment === "production"
		? "https://zenodo.org"
		: "https://sandbox.zenodo.org";
}
const PERMANENT_ZENODO_FAILURES = new Set([
	"ZENODO_FIRST_PUBLICATION_TIME_REQUIRED",
	"ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED",
	"ZENODO_FILE_CORRECTION_WINDOW_CLOSED",
	"ZENODO_EXTERNAL_DOI_CHANGED",
]);

class ZenodoExternalDoiChangedError extends Error {
	override name = "ZENODO_EXTERNAL_DOI_CHANGED";
}

function parseFileCorrectionApprovalId(value: string | undefined) {
	if (!value) return null;
	if (!/^[1-9]\d*$/.test(value)) {
		throw new Error("The Zenodo PDF correction approval ID is invalid");
	}
	const id = Number(value);
	if (!Number.isSafeInteger(id)) {
		throw new Error("The Zenodo PDF correction approval ID is too large");
	}
	return id;
}

export type ZenodoPublicationProvider = ZenodoWriter &
	Pick<ZenodoApiClient, "prepareEmptyDraft"> &
	Partial<Pick<ZenodoApiClient, "verifyPublishedState">>;

/** Zenodo's settings with the token to use now: the configuration's, or the owner's own account's (zenodo-token.ts). */
async function requireConfig(config: PublicationConfig) {
	return { ...config.services.publication.zenodo, token: await zenodoToken(config) };
}

function requireZenodoPlanningRecord(
	snapshot: Awaited<ReturnType<typeof readPublicationRepositorySnapshot>>,
) {
	const record = snapshot.record;
	if (!record) throw new Error("The publication record no longer exists");
	// A withdrawn record is registered again, saying so; any other removed record is restored first.
	if (record.deleted === 1 && !record.withdrawnAt) {
		throw new Error("Restore this record before publishing it to Zenodo");
	}
	if (record.parentItem) {
		throw new Error("Only parent records can be published to Zenodo");
	}
	return record;
}

function managedZenodoDoiValues(
	snapshot: Awaited<ReturnType<typeof readPublicationRepositorySnapshot>>,
	environment: ZenodoPublicationEnvironment,
) {
	return snapshot.identifiers
		.filter(
			(identifier) =>
				identifier.registrar === "zenodo" &&
				identifier.environment === environment &&
				identifier.ownership === "managed",
		)
		.map((identifier) => identifier.doi);
}

function activeFileCorrectionApproval(
	snapshot: Awaited<ReturnType<typeof readPublicationRepositorySnapshot>>,
	environment: ZenodoPublicationEnvironment,
) {
	return snapshot.fileCorrectionApprovals.find(
		(approval) =>
			approval.environment === environment &&
			approval.consumedAt === null &&
			approval.supersededAt === null,
	);
}

function assertArchivedExternalDoiMatches(input: {
	identifierPolicy: ZenodoIdentifierPolicy;
	lockedExternalDoi: string | null;
	bibliographicDoi: string | null;
}) {
	if (input.identifierPolicy !== "reuse-external") return;
	if (
		input.lockedExternalDoi &&
		input.bibliographicDoi === input.lockedExternalDoi
	)
		return;
	throw new ZenodoExternalDoiChangedError(
		`The record DOI no longer matches the DOI selected for Zenodo (${input.lockedExternalDoi ?? "missing"})`,
	);
}

async function buildZenodoPlan(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
	observedAt: Date,
) {
	const publicationConfig = config.services.publication;
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		publicationConfig.crossref.environment,
	);
	const record = requireZenodoPlanningRecord(snapshot);
	const target = targetFor(
		snapshot,
		"zenodo",
		publicationConfig.zenodo.environment,
	);
	if (!target?.identifierPolicy) {
		throw new Error("The record does not have an active Zenodo target");
	}
	const managedCrossrefDoi = currentManagedDoi(
		snapshot,
		"crossref",
		publicationConfig.crossref.environment,
		"primary",
	);
	const managedZenodoDois = managedZenodoDoiValues(
		snapshot,
		publicationConfig.zenodo.environment,
	);
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
	const {
		record: recordSnapshot,
		files,
		identifiers,
	} = publicationPlanData(
		snapshot,
		record,
		config,
		bibliographicDoi.doi,
		managedCrossrefDoi,
		await loadPublicationRecordExtras(database, snapshot, config),
	);
	const previousState = providerState(snapshot, "zenodo", publicationConfig);
	assertArchivedExternalDoiMatches({
		identifierPolicy: target.identifierPolicy,
		lockedExternalDoi: target.lockedExternalDoi,
		bibliographicDoi: bibliographicDoi.doi,
	});
	const correctionApproval = activeFileCorrectionApproval(
		snapshot,
		publicationConfig.zenodo.environment,
	);
	return {
		identifierPolicy: target.identifierPolicy,
		plan: planPublicationSync({
			observedAt,
			record: recordSnapshot,
			files,
			identifiers,
			targets: {
				crossref: { enabled: false },
				zenodo: {
					enabled: true,
					environment: publicationConfig.zenodo.environment,
					identifierPolicy: target.identifierPolicy,
				},
			},
			...(previousState ? { state: previousState } : {}),
			...(correctionApproval
				? {
						zenodoFileChangeApproval:
							fileCorrectionApprovalFromRow(correctionApproval),
					}
				: {}),
		}),
		previousState,
		snapshot,
	};
}

async function assertNoIdentifierCollision(
	transaction: DatabaseTransaction,
	itemKey: string,
	dois: readonly string[],
	environment: ZenodoPublicationEnvironment,
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
				eq(publicationIdentifier.environment, environment),
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
		environment: ZenodoPublicationEnvironment;
		itemKey: string;
		identifiers: ZenodoRecordIdentifiers;
		observedAt: Date;
		identifierPolicy: ZenodoIdentifierPolicy;
	},
) {
	const [previousVersion] = await transaction
		.select({ doi: publicationIdentifier.doi })
		.from(publicationIdentifier)
		.where(
			and(
				eq(publicationIdentifier.itemKey, input.itemKey),
				eq(publicationIdentifier.registrar, "zenodo"),
				eq(publicationIdentifier.environment, input.environment),
				eq(publicationIdentifier.role, "version"),
				eq(publicationIdentifier.isCurrent, true),
			),
		)
		.limit(1);
	const previousVersionDoi = previousVersion?.doi;
	// Under reuse-external Zenodo reports the record's own DOI back as its
	// version DOI. That DOI was never minted here, so it is stored as external.
	const versionOwnership =
		input.identifierPolicy === "reuse-external"
			? ("external" as const)
			: ("managed" as const);
	const values = [
		...(input.identifiers.versionDoi
			? [
					{
						role: "version" as const,
						doi: input.identifiers.versionDoi,
						ownership: versionOwnership,
					},
				]
			: []),
		...(input.identifiers.conceptDoi
			? [
					{
						role: "concept" as const,
						doi: input.identifiers.conceptDoi,
						ownership: "managed" as const,
					},
				]
			: []),
	];
	await assertNoIdentifierCollision(
		transaction,
		input.itemKey,
		values.map(({ doi }) => doi),
		input.environment,
	);
	for (const value of values) {
		await transaction
			.update(publicationIdentifier)
			.set({ isCurrent: false, updatedAt: input.observedAt })
			.where(
				and(
					eq(publicationIdentifier.itemKey, input.itemKey),
					eq(publicationIdentifier.registrar, "zenodo"),
					eq(publicationIdentifier.environment, input.environment),
					eq(publicationIdentifier.role, value.role),
					eq(publicationIdentifier.isCurrent, true),
				),
			);
		await transaction
			.insert(publicationIdentifier)
			.values({
				itemKey: input.itemKey,
				registrar: "zenodo",
				environment: input.environment,
				role: value.role,
				doi: value.doi,
				ownership: value.ownership,
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
					ownership: value.ownership,
					lifecycle: "verified",
					isCurrent: true,
					verifiedAt: input.observedAt,
					updatedAt: input.observedAt,
				},
			});
	}
	return Boolean(
		input.identifiers.versionDoi &&
		input.identifiers.versionDoi !== previousVersionDoi,
	);
}

function createZenodoJournal(
	database: Database,
	job: { id: number; itemKey: string },
	workerId: string,
	environment: ZenodoPublicationEnvironment,
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
				const fileCorrectionApprovalId = parseFileCorrectionApprovalId(
					input.fileCorrectionApproval?.id,
				);
				const createOperation = plan.operations.find(
					(operation) => operation.type === "zenodo_create",
				);
				if (
					createOperation?.draftDepositionId &&
					createOperation.draftDepositionId !== input.depositionId
				) {
					await transaction
						.delete(zenodoPublishJournal)
						.where(
							and(
								eq(
									zenodoPublishJournal.itemKey,
									input.recordId,
								),
								eq(
									zenodoPublishJournal.environment,
									environment,
								),
								eq(
									zenodoPublishJournal.depositionId,
									createOperation.draftDepositionId,
								),
								eq(zenodoPublishJournal.status, "preparing"),
							),
						);
				}
				await transaction
					.insert(zenodoPublishJournal)
					.values({
						environment,
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
						fileCorrectionApprovalId,
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
							fileCorrectionApprovalId,
							status: input.status ?? "preparing",
							publishedRecordId: null,
							identifiers: null,
							orphanDraftCleanupDepositionId: null,
							publishedAt: null,
							updatedAt: input.observedAt,
						},
					});
				await transaction
					.update(publicationSyncState)
					.set({ unpublishedDraftDepositionId: input.depositionId })
					.where(
						and(
							eq(publicationSyncState.itemKey, input.recordId),
							eq(publicationSyncState.provider, "zenodo"),
							eq(publicationSyncState.environment, environment),
							isNotNull(
								publicationSyncState.unpublishedDraftDepositionId,
							),
						),
					);
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
						fileCorrectionApprovalId:
							zenodoPublishJournal.fileCorrectionApprovalId,
					})
					.from(zenodoPublishJournal)
					.where(
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(zenodoPublishJournal.environment, environment),
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
				const [target] = await transaction
					.select({
						identifierPolicy: publicationTarget.identifierPolicy,
					})
					.from(publicationTarget)
					.where(
						and(
							eq(publicationTarget.itemKey, input.recordId),
							eq(publicationTarget.provider, "zenodo"),
							eq(publicationTarget.environment, environment),
						),
					)
					.limit(1);
				if (!target?.identifierPolicy) {
					throw new Error("The Zenodo target has no DOI policy");
				}
				const zenodoVersionChanged = await saveZenodoIdentifiers(
					transaction,
					{
						environment,
						itemKey: input.recordId,
						identifiers: input.identifiers,
						observedAt: input.observedAt,
						identifierPolicy: target.identifierPolicy,
					},
				);
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
							eq(publicationSyncState.environment, environment),
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
						environment: environment,
						identifierPolicy: target.identifierPolicy,
						lastPayloadHash: savedDraft.payloadHash,
						lastPayloadSnapshot: savedDraft.payloadSnapshot,
						lastFileManifestHash,
						lastFileManifestSnapshot,
						unpublishedDraftDepositionId: null,
						zenodoRecordId: input.identifiers.latestRecordId,
						zenodoParentId: input.identifiers.parentId,
						zenodoVersionDoi: input.identifiers.versionDoi ?? null,
						zenodoConceptDoi: input.identifiers.conceptDoi ?? null,
						zenodoFirstPublishedAt: input.identifiers.publishedAt,
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
							unpublishedDraftDepositionId: null,
							zenodoRecordId: input.identifiers.latestRecordId,
							zenodoParentId: input.identifiers.parentId,
							zenodoVersionDoi:
								input.identifiers.versionDoi ?? null,
							zenodoConceptDoi:
								input.identifiers.conceptDoi ?? null,
							zenodoFirstPublishedAt: sql`coalesce(${publicationSyncState.zenodoFirstPublishedAt}, ${input.identifiers.publishedAt})`,
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
							eq(zenodoPublishJournal.environment, environment),
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
				if (savedDraft.fileCorrectionApprovalId !== null) {
					const [consumedApproval] = await transaction
						.update(zenodoFileCorrectionApproval)
						.set({
							consumedAt: input.observedAt,
							updatedAt: input.observedAt,
						})
						.where(
							and(
								eq(
									zenodoFileCorrectionApproval.id,
									savedDraft.fileCorrectionApprovalId,
								),
								eq(
									zenodoFileCorrectionApproval.itemKey,
									input.recordId,
								),
								isNull(zenodoFileCorrectionApproval.consumedAt),
								isNull(
									zenodoFileCorrectionApproval.supersededAt,
								),
							),
						)
						.returning({ id: zenodoFileCorrectionApproval.id });
					if (!consumedApproval) {
						throw new Error(
							"The Zenodo PDF correction approval was already used or replaced",
						);
					}
				}
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
				if (
					zenodoVersionChanged &&
					target.identifierPolicy === "mint-zenodo"
				) {
					await enqueuePublicationJobsForItem(transaction, {
						itemKey: input.recordId,
						canonicalRevision: current.revision,
						reason: "record_changed",
						now: input.observedAt,
						providers: ["crossref"],
						idempotencyDiscriminator: `zenodo-version:${input.identifiers.versionDoi}`,
					});
				}
			}),
		clearZenodoPublishDraft: (input: ClearZenodoPublishDraftInput) =>
			withLease(input.observedAt, async (transaction) => {
				await transaction
					.delete(zenodoPublishJournal)
					.where(
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(zenodoPublishJournal.environment, environment),
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
							eq(publicationSyncState.environment, environment),
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
						and(
							eq(zenodoPublishJournal.itemKey, input.recordId),
							eq(zenodoPublishJournal.environment, environment),
							eq(
								zenodoPublishJournal.orphanDraftCleanupDepositionId,
								input.depositionId,
							),
						),
					);
			}),
	};
}

function zenodoPatchValues(
	patch: ProviderSyncStatePatch,
	previousState: ProviderSyncState | undefined,
	identifierPolicy: ZenodoIdentifierPolicy,
	now: Date,
) {
	const zenodo = patch.zenodo;
	const lastSuccess =
		zenodo?.lastSuccess ?? previousState?.zenodo?.lastSuccess;
	const previousSuccess = previousState?.zenodo?.lastSuccess;
	const identifiers =
		zenodo?.identifiers ?? previousState?.zenodo?.identifiers;
	const firstPublishedAt =
		zenodo?.firstPublishedAt ?? previousState?.zenodo?.firstPublishedAt;
	const orphanDraftCleanup =
		zenodo && "orphanDraftCleanup" in zenodo
			? zenodo.orphanDraftCleanup
			: previousState?.zenodo?.orphanDraftCleanup;
	const savedIdentifierPolicy =
		zenodo?.identifierPolicy ??
		previousState?.zenodo?.identifierPolicy ??
		identifierPolicy;
	return {
		identifierPolicy: savedIdentifierPolicy,
		lastPayloadHash:
			lastSuccess?.payloadHash === DRIFTED_PAYLOAD_HASH
				? null
				: (lastSuccess?.payloadHash ?? null),
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
		unpublishedDraftDepositionId: identifiers
			? null
			: (previousState?.zenodo?.unpublishedDraft?.depositionId ?? null),
		zenodoRecordId: identifiers?.latestRecordId ?? null,
		zenodoParentId: identifiers?.parentId ?? null,
		zenodoVersionDoi: identifiers?.versionDoi ?? null,
		zenodoConceptDoi: identifiers?.conceptDoi ?? null,
		zenodoFirstPublishedAt: firstPublishedAt ?? null,
		orphanDraftDepositionId: orphanDraftCleanup?.depositionId ?? null,
		...zenodoFailureValues(patch, previousState, now),
	};
}

/** Only the failure columns; a settlement without Zenodo results leaves the published state alone. */
function zenodoFailureValues(
	patch: ProviderSyncStatePatch,
	previousState: ProviderSyncState | undefined,
	now: Date,
) {
	const failure = "failure" in patch ? patch.failure : previousState?.failure;
	return {
		lastFailureClass:
			failure?.provider === "zenodo" ? failure.failureClass : null,
		lastFailureSummary:
			failure?.provider === "zenodo" ? failure.summary : null,
		consecutiveFailures:
			failure?.provider === "zenodo" ? failure.consecutiveCount : 0,
		updatedAt: now,
	};
}

async function auditZenodoPublishedState(
	database: Database,
	config: PublicationConfig,
	input: {
		job: NonNullable<Awaited<ReturnType<typeof claimNextPublicationJob>>>;
		workerId: string;
		built: Awaited<ReturnType<typeof buildZenodoPlan>>;
		provider?: ZenodoPublicationProvider;
		heartbeatIntervalMs?: number;
		signal?: AbortSignal;
		now: () => Date;
	},
) {
	const lastSuccess = input.built.previousState?.zenodo?.lastSuccess;
	const identifiers = input.built.previousState?.zenodo?.identifiers;
	if (
		!lastSuccess?.payloadSnapshot ||
		!lastSuccess.fileManifestHash ||
		!identifiers
	) {
		throw new Error("The Zenodo audit job has no saved published state");
	}
	if (input.built.plan.status !== "noop") {
		return settlePublicationProviderAudit(database, {
			jobId: input.job.id,
			workerId: input.workerId,
			itemKey: input.job.itemKey,
			provider: "zenodo",
			environment: config.services.publication.zenodo.environment,
			expectedPayloadHash: lastSuccess.payloadHash,
			expectedFileManifestHash: lastSuccess.fileManifestHash,
			observation: {
				status: "skipped",
				reason: "The local publication changed before the remote audit started.",
			},
			settledAt: input.now(),
		});
	}

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
		async (signal): Promise<ZenodoRemoteStateVerification> => {
			const provider =
				input.provider ??
				new ZenodoApiClient({
					endpoint: zenodoEndpoint(config),
					fetch: (url, init) => fetch(url, { ...init, signal }),
				});
			if (!provider.verifyPublishedState) {
				throw new Error(
					"The Zenodo provider cannot verify published state",
				);
			}
			return provider.verifyPublishedState({
				token: (await requireConfig(config)).token,
				recordId: identifiers.latestRecordId,
				expectedPayload: parseZenodoRecordPayload(
					lastSuccess.payloadSnapshot,
				),
				files: input.built.snapshot.files.map((file) => ({
					filename: file.filename,
					size: file.sizeBytes,
					md5: file.md5,
				})),
			});
		},
	);
	if (verification.status === "missing") {
		throw new Error("The published Zenodo record no longer exists");
	}
	return settlePublicationProviderAudit(database, {
		jobId: input.job.id,
		workerId: input.workerId,
		itemKey: input.job.itemKey,
		provider: "zenodo",
		environment: config.services.publication.zenodo.environment,
		expectedPayloadHash: lastSuccess.payloadHash,
		expectedFileManifestHash: lastSuccess.fileManifestHash,
		observation: verification,
		settledAt: input.now(),
	});
}

async function settleZenodoState(
	database: Database,
	input: PublicationSettlement & {
		environment: ZenodoPublicationEnvironment;
		identifierPolicy: ZenodoIdentifierPolicy;
	},
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, input.itemKey);
		await assertPublicationJobLease(transaction, {
			jobId: input.jobId,
			workerId: input.workerId,
			observedAt: input.settledAt,
		});
		const published = input.patch.zenodo
			? zenodoPatchValues(
					input.patch,
					input.previousState,
					input.identifierPolicy,
					input.settledAt,
				)
			: null;
		const values =
			published ??
			zenodoFailureValues(input.patch, input.previousState, input.settledAt);
		await transaction
			.insert(publicationSyncState)
			.values({
				itemKey: input.itemKey,
				provider: "zenodo",
				environment: input.environment,
				identifierPolicy: input.identifierPolicy,
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
		if (
			published?.zenodoRecordId &&
			published.zenodoParentId &&
			published.zenodoFirstPublishedAt
		) {
			await saveZenodoIdentifiers(transaction, {
				environment: input.environment,
				itemKey: input.itemKey,
				identifierPolicy: input.identifierPolicy,
				identifiers: {
					latestRecordId: published.zenodoRecordId,
					parentId: published.zenodoParentId,
					...(published.zenodoVersionDoi
						? { versionDoi: published.zenodoVersionDoi }
						: {}),
					...(published.zenodoConceptDoi
						? { conceptDoi: published.zenodoConceptDoi }
						: {}),
					publishedAt: published.zenodoFirstPublishedAt,
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
		await settlePublicationJob(transaction, input);
	});
}

function zenodoDraftWaitReason(
	snapshot: Awaited<ReturnType<typeof readPublicationRepositorySnapshot>>,
	identifierPolicy: ZenodoIdentifierPolicy,
	crossrefEnvironment: "test" | "production",
) {
	return identifierPolicy === "reuse-crossref" &&
		!snapshot.identifiers.some(
			(identifier) =>
				identifier.registrar === "crossref" &&
				identifier.environment === crossrefEnvironment &&
				identifier.isCurrent &&
				identifier.ownership === "managed" &&
				identifier.lifecycle === "verified",
		)
		? "crossref"
		: snapshot.files.length === 0
			? "file"
			: null;
}

function hasZenodoDraft(
	snapshot: Awaited<ReturnType<typeof readPublicationRepositorySnapshot>>,
	state: typeof publicationSyncState.$inferSelect | undefined,
	environment: ZenodoPublicationEnvironment,
) {
	return Boolean(
		state?.zenodoRecordId ||
		state?.unpublishedDraftDepositionId ||
		snapshot.journals.some(
			(journal) => journal.environment === environment,
		),
	);
}

async function prepareWaitingZenodoDraft(
	database: Database,
	config: PublicationConfig,
	input: {
		job: { id: number; itemKey: string };
		workerId: string;
		provider: ZenodoPublicationProvider;
		now: () => Date;
	},
) {
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		input.job.itemKey,
		config.services.publication.crossref.environment,
	);
	requireZenodoPlanningRecord(snapshot);
	const target = targetFor(
		snapshot,
		"zenodo",
		config.services.publication.zenodo.environment,
	);
	if (!target?.identifierPolicy)
		throw new Error("The record does not have an active Zenodo target");
	const waitingOn = zenodoDraftWaitReason(
		snapshot,
		target.identifierPolicy,
		config.services.publication.crossref.environment,
	);
	const state = snapshot.states.find(
		(state) =>
			state.provider === "zenodo" &&
			state.environment ===
				config.services.publication.zenodo.environment,
	);
	if (
		!hasZenodoDraft(
			snapshot,
			state,
			config.services.publication.zenodo.environment,
		)
	) {
		if (!waitingOn) {
			// Validation belongs to publication, but must not prevent saving the archive draft.
			try {
				const built = await buildZenodoPlan(
					database,
					input.job.itemKey,
					config,
					input.now(),
				);
				if (built.plan.status !== "needs_attention") return null;
			} catch {
				// The normal planning pass below records the validation failure after draft creation.
			}
		}
		await input.provider.prepareEmptyDraft({
			token: (await requireConfig(config)).token,
			onPreparedDraft: async (draft) => {
				await database.transaction(async (transaction) => {
					await lockItemMutation(transaction, input.job.itemKey);
					await assertPublicationJobLease(transaction, {
						jobId: input.job.id,
						workerId: input.workerId,
						observedAt: input.now(),
					});
					await transaction
						.insert(publicationSyncState)
						.values({
							itemKey: input.job.itemKey,
							provider: "zenodo",
							environment:
								config.services.publication.zenodo.environment,
							identifierPolicy: target.identifierPolicy,
							unpublishedDraftDepositionId: draft.depositionId,
							updatedAt: input.now(),
						})
						.onConflictDoUpdate({
							target: [
								publicationSyncState.itemKey,
								publicationSyncState.provider,
								publicationSyncState.environment,
							],
							set: {
								unpublishedDraftDepositionId:
									draft.depositionId,
								updatedAt: input.now(),
							},
						});
				});
			},
		});
	}
	return waitingOn;
}

export async function runZenodoPublicationJobsOnce(
	database: Database,
	config: PublicationConfig,
	storage: EvidenceFileStorage,
	options: {
		heartbeatIntervalMs?: number;
		provider?: ZenodoPublicationProvider;
		signal?: AbortSignal;
		workerId?: string;
		now?: () => Date;
	} = {},
) {
	const zenodo = await requireConfig(config);
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
			environment: zenodo.environment,
			workerId,
			leaseSeconds: workerConfig.leaseSeconds,
			claimedAt: now(),
		});
		if (!job) break;
		try {
			if (job.reason !== "provider_audit") {
				const waiting = await withPublicationJobHeartbeat(
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
						prepareWaitingZenodoDraft(database, config, {
							job,
							workerId,
							now,
							provider:
								options.provider ??
								new ZenodoApiClient({
									endpoint: zenodoEndpoint(config),
									fetch: (url, init) =>
										fetch(url, { ...init, signal }),
								}),
						}),
				);
				if (waiting) {
					await database.transaction(async (transaction) => {
						await lockItemMutation(transaction, job.itemKey);
						await finishPublicationJob(transaction, {
							jobId: job.id,
							workerId,
							finishedAt: now(),
							receipt: { status: "waiting", waitingOn: waiting },
						});
						await transaction.update(publicationSyncState).set({
							lastFailureClass: null,
							lastFailureSummary: null,
							consecutiveFailures: 0,
							updatedAt: now(),
						}).where(and(
							eq(publicationSyncState.itemKey, job.itemKey),
							eq(publicationSyncState.provider, "zenodo"),
							eq(publicationSyncState.environment, config.services.publication.zenodo.environment),
						));
					});
					outcomes.push({ jobId: job.id, status: "waiting" });
					continue;
				}
			}
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
				() => buildZenodoPlan(database, job.itemKey, config, now()),
			);
			if (job.reason === "provider_audit") {
				const audit = await auditZenodoPublishedState(
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
					// The token is read for each deposit: an owner's own account's (zenodo-token.ts) may end during a long batch.
					async (signal) =>
						executeLivePublicationSyncPlan({
							plan: runnablePlan,
							credentials: { zenodoToken: await zenodoToken(config) },
							providers: {
								zenodo:
									options.provider ??
									new ZenodoApiClient({
										endpoint: zenodoEndpoint(config),
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
								zenodo.environment,
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
					PERMANENT_ZENODO_FAILURES.has(failure.failureClass) ||
					failure.consecutiveCount >= workerConfig.retryLimit
				: false;
			await settleZenodoState(database, {
				environment: zenodo.environment,
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
									environment: zenodo.environment,
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
					config.services.publication.crossref.environment,
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
						eq(publicationTarget.environment, zenodo.environment),
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
			const deadLetter =
				PERMANENT_ZENODO_FAILURES.has(
					error instanceof Error ? error.name : "UNKNOWN_ERROR",
				) || count >= workerConfig.retryLimit;
			try {
				await settleZenodoState(database, {
					environment: zenodo.environment,
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
