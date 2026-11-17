import {
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
	buildPublicationFileManifest,
} from "./record-adapter";
import {
	parseProviderSyncState,
	type ProviderSyncState,
} from "@opendeved/doi-sync-core";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { PublicationProvider } from "@/db/schema/publication";

import { fileCorrectionApprovalFromRow } from "./file-correction-approval";
import type { PublicationRepositorySnapshot } from "./repository";
import type { PublicationRecordExtras } from "./record-extras";

type PublicationConfig = LibraryServerConfig["services"]["publication"];
type PublicationEnvironment = "test" | "sandbox" | "production";

/**
 * Stands in for the payload hash after a drifted audit cleared it. It never matches a real
 * hash, so the planner refreshes the metadata, and the adapters never store it.
 */
export const DRIFTED_PAYLOAD_HASH = "drifted";

/** A drifted audit clears the payload hash but the archived files stay known, so the planner must not treat them as changed. */
function zenodoLastSuccess(
	row: PublicationRepositorySnapshot["states"][number] | undefined,
) {
	if (!row) return undefined;
	const metadata = Boolean(row.lastPayloadHash && row.lastPayloadSnapshot);
	if (!metadata && !row.lastFileManifestHash) return undefined;
	return {
		payloadHash: metadata ? (row.lastPayloadHash as string) : DRIFTED_PAYLOAD_HASH,
		...(metadata ? { payloadSnapshot: row.lastPayloadSnapshot } : {}),
		...(row.lastFileManifestHash
			? { fileManifestHash: row.lastFileManifestHash }
			: {}),
		...(row.lastFileManifestSnapshot
			? { fileManifestSnapshot: row.lastFileManifestSnapshot }
			: {}),
	};
}

export function targetFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return snapshot.targets.find(
		(target) =>
			target.provider === provider &&
			target.environment === environment &&
			target.deactivatedAt === null &&
			target.activatedAt !== null,
	);
}

export function stateFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return snapshot.states.find(
		(state) =>
			state.provider === provider && state.environment === environment,
	);
}

export function identifiersFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return snapshot.identifiers.filter(
		(identifier) =>
			identifier.registrar === provider &&
			identifier.environment === environment,
	);
}

export function currentManagedDoi(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
	role: "primary" | "version" | "concept",
) {
	return identifiersFor(snapshot, provider, environment).find(
		(identifier) =>
			identifier.role === role && identifier.ownership === "managed",
	)?.doi;
}

export function providerState(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	config: PublicationConfig,
): ProviderSyncState | undefined {
	const expectedEnvironment = config[provider].environment;
	const row = stateFor(snapshot, provider, expectedEnvironment);
	const failure =
		row?.lastFailureClass &&
		row.lastFailureSummary &&
		row.consecutiveFailures > 0
			? {
					provider,
					failureClass: row.lastFailureClass,
					summary: row.lastFailureSummary,
					consecutiveCount: row.consecutiveFailures,
				}
			: undefined;
	if (provider === "crossref") {
		if (!row) return undefined;
		return parseProviderSyncState({
			crossref: {
				environment: config.crossref.environment,
				...(row.lastPayloadHash && row.lastPayloadSnapshot
					? {
							lastSuccess: {
								payloadHash: row.lastPayloadHash,
								payloadSnapshot: row.lastPayloadSnapshot,
							},
						}
					: {}),
				...(row.pendingStage && row.pendingPayloadHash
					? {
							pending: {
								stage: row.pendingStage,
								payloadHash: row.pendingPayloadHash,
								...(row.pendingPayloadSnapshot
									? {
											payloadSnapshot:
												row.pendingPayloadSnapshot,
										}
									: {}),
								...(row.pendingBatchId
									? { batchId: row.pendingBatchId }
									: {}),
								...(row.pendingFilename
									? { filename: row.pendingFilename }
									: {}),
								...(row.pendingSubmittedAt
									? { submittedAt: row.pendingSubmittedAt }
									: {}),
								...(row.pendingReason
									? { reason: row.pendingReason }
									: {}),
							},
						}
					: {}),
			},
			...(failure ? { failure } : {}),
		});
	}

	const journals = snapshot.journals.filter(
		(journal) =>
			journal.provider === "zenodo" &&
			journal.environment === config.zenodo.environment,
	);
	const journal = journals.length === 1 ? journals[0] : null;
	const journalApproval = journal?.fileCorrectionApprovalId
		? snapshot.fileCorrectionApprovals.find(
				(approval) => approval.id === journal.fileCorrectionApprovalId,
			)
		: null;
	const target = targetFor(snapshot, "zenodo", config.zenodo.environment);
	if (!row && !journal) return undefined;
	const identifierPolicy = row?.identifierPolicy ?? target?.identifierPolicy;
	if (!identifierPolicy) return undefined;
	return parseProviderSyncState({
		zenodo: {
			environment: config.zenodo.environment,
			identifierPolicy,
			...(row?.unpublishedDraftDepositionId
				? {
						unpublishedDraft: {
							depositionId: row.unpublishedDraftDepositionId,
						},
					}
				: {}),
			...(row?.zenodoFirstPublishedAt
				? { firstPublishedAt: row.zenodoFirstPublishedAt }
				: {}),
			...(snapshot.fileCorrectionApprovals.some(
				(approval) =>
					approval.consumedAt !== null ||
					approval.supersededAt !== null,
			)
				? {
						consumedFileCorrectionApprovalIds:
							snapshot.fileCorrectionApprovals
								.filter(
									(approval) =>
										approval.consumedAt !== null ||
										approval.supersededAt !== null,
								)
								.map((approval) => String(approval.id)),
					}
				: {}),
			...(zenodoLastSuccess(row)
				? { lastSuccess: zenodoLastSuccess(row) }
				: {}),
			...(row?.zenodoRecordId && row.zenodoParentId
				? {
						identifiers: {
							latestRecordId: row.zenodoRecordId,
							parentId: row.zenodoParentId,
							...(row.zenodoVersionDoi
								? { versionDoi: row.zenodoVersionDoi }
								: {}),
							...(row.zenodoConceptDoi
								? { conceptDoi: row.zenodoConceptDoi }
								: {}),
						},
					}
				: {}),
			...(row?.orphanDraftDepositionId
				? {
						orphanDraftCleanup: {
							depositionId: row.orphanDraftDepositionId,
						},
					}
				: {}),
			...(journal
				? {
						journal: {
							operationType: journal.operationType,
							depositionId: journal.depositionId,
							draftRecordId: journal.draftRecordId,
							...(journal.parentId
								? { parentId: journal.parentId }
								: {}),
							payloadHash: journal.payloadHash,
							...(journal.fileManifestHash
								? { fileManifestHash: journal.fileManifestHash }
								: {}),
							status: journal.status,
							...(journalApproval
								? {
										fileCorrectionApproval:
											fileCorrectionApprovalFromRow(
												journalApproval,
											),
									}
								: {}),
						},
					}
				: {}),
		},
		...(failure ? { failure } : {}),
	});
}

export function publicationPlanData(
	snapshot: PublicationRepositorySnapshot,
	record: NonNullable<PublicationRepositorySnapshot["record"]>,
	config: Pick<LibraryServerConfig, "identity" | "services">,
	bibliographicDoi: string | null,
	managedCrossrefDoi: string | undefined,
	extras?: PublicationRecordExtras,
) {
	return {
		record: buildPublicationRecordSnapshot({
			record,
			tags: snapshot.tags,
			baseUrl: config.identity.baseUrl,
			// A record whose DOI went out before records had their own licence keeps the library's until one is picked.
			libraryLicense: currentManagedDoi(snapshot, "zenodo", config.services.publication.zenodo.environment, "concept") ? config.services.publication.zenodo.license : null,
			...(extras ? { extras } : {}),
		}),
		files: buildPublicationFileManifest(snapshot.files),
		identifiers: buildPublicationIdentifiers({
			bibliographicDoi,
			managedCrossrefDoi,
			zenodoVersionDoi: currentManagedDoi(
				snapshot,
				"zenodo",
				config.services.publication.zenodo.environment,
				"version",
			),
			zenodoConceptDoi: currentManagedDoi(
				snapshot,
				"zenodo",
				config.services.publication.zenodo.environment,
				"concept",
			),
		}),
	};
}
