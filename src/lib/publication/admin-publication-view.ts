import "server-only";

import {
	mapCrossrefRecord,
	parseProviderSyncState,
	planPublicationSync,
	type ProviderSyncState,
	type PublicationSyncPlan,
} from "@opendeved/doi-sync-core";
import {
	buildDoiDisplayLinks,
	type DoiDisplayLink,
} from "@opendeved/doi-sync-core/display";

import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import type { PublicationProvider } from "@/db/schema/publication";

import {
	resolveBibliographicDoi,
	type BibliographicDoiResolution,
} from "./bibliographic-doi";
import {
	resolveAdminPublicationProviderState,
	type AdminPublicationProviderState,
} from "./admin-publication-state";
import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
} from "./record-adapter";
import {
	readPublicationRepositorySnapshot,
	type PublicationRepositorySnapshot,
} from "./repository";

type PublicationConfig = LibraryServerConfig["services"]["publication"];
type PublicationEnvironment = "test" | "sandbox";

export type AdminPublicationPlanSummary = {
	status:
		| "unavailable"
		| "skipped"
		| "needs_attention"
		| "waiting_for_file"
		| "noop"
		| "write_required";
	reason: string | null;
	operations: readonly string[];
};

export type AdminPublicationJobSummary = {
	id: number;
	attempts: number;
	nextAttemptAt: string;
	leaseOwner: string | null;
	leaseExpiresAt: string | null;
	processedAt: string | null;
	deadLetteredAt: string | null;
	supersededAt: string | null;
	lastError: string | null;
	receipt: Record<string, unknown> | null;
};

export type AdminPublicationIdentifierSummary = {
	doi: string;
	lifecycle: "reserved" | "verified";
	ownership: "managed" | "external";
	role: "primary" | "version" | "concept";
};

export type AdminPublicationLink = DoiDisplayLink & {
	status: "reserved" | "active";
};

export type AdminPublicationProviderView = {
	provider: PublicationProvider;
	environment: "test" | "sandbox";
	displayState: AdminPublicationProviderState;
	waitingOn: "crossref" | "file" | null;
	blockers: readonly string[];
	capabilities: {
		canActivate: boolean;
		canRetry: boolean;
		actionLabel: string;
		allowedIdentifierPolicies: readonly (
			| "reuse-crossref"
			| "mint-zenodo"
		)[];
	};
	exact: {
		targetActive: boolean;
		target: {
			requestedBy: string;
			requestedAt: string;
		} | null;
		identifierPolicy: "reuse-crossref" | "mint-zenodo" | null;
		plan: AdminPublicationPlanSummary;
		job: AdminPublicationJobSummary | null;
		recentJobs: readonly AdminPublicationJobSummary[];
		identifiers: readonly AdminPublicationIdentifierSummary[];
		pending: boolean;
		journal: boolean;
		failure: {
			failureClass: string;
			summary: string;
			consecutiveCount: number;
		} | null;
	};
	links: readonly AdminPublicationLink[];
};

export type AdminPublicationView = {
	itemKey: string;
	canonicalRevision: number;
	bibliographicDoi: BibliographicDoiResolution;
	doiNamespace: {
		prefix: string;
		suffixNamespace: string;
	} | null;
	providers: {
		crossref: AdminPublicationProviderView;
		zenodo: AdminPublicationProviderView;
	};
};

export class PublicationItemNotFoundError extends Error {
	constructor(itemKey: string) {
		super(`Item ${itemKey} was not found`);
		this.name = "PublicationItemNotFoundError";
	}
}

function iso(value: Date | null) {
	return value?.toISOString() ?? null;
}

function unique(messages: readonly (string | null | undefined)[]) {
	return [...new Set(messages.filter((message): message is string => Boolean(message)))];
}

function targetFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return snapshot.targets.find(
		(target) =>
			target.provider === provider &&
			target.environment === environment &&
			target.deactivatedAt === null,
	);
}

function stateFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return snapshot.states.find(
		(state) =>
			state.provider === provider && state.environment === environment,
	);
}

function latestJobFor(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	return (
		snapshot.jobs.find(
			(job) =>
				job.provider === provider &&
				job.environment === environment &&
				job.supersededAt === null,
		) ?? null
	);
}

function identifiersFor(
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

function currentManagedDoi(
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

function providerState(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	config: PublicationConfig,
): ProviderSyncState | undefined {
	const expectedEnvironment = config[provider].environment;
	const row = stateFor(snapshot, provider, expectedEnvironment);
	const failure =
		row?.lastFailureClass && row.lastFailureSummary && row.consecutiveFailures > 0
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
									? { payloadSnapshot: row.pendingPayloadSnapshot }
									: {}),
								...(row.pendingBatchId ? { batchId: row.pendingBatchId } : {}),
								...(row.pendingFilename ? { filename: row.pendingFilename } : {}),
								...(row.pendingSubmittedAt
									? { submittedAt: row.pendingSubmittedAt }
									: {}),
								...(row.pendingReason ? { reason: row.pendingReason } : {}),
							},
						}
					: {}),
			},
			...(failure ? { failure } : {}),
		});
	}

	const journals = snapshot.journals.filter(
		(journal) => journal.provider === "zenodo",
	);
	const journal = journals.length === 1 ? journals[0] : null;
	const target = targetFor(
		snapshot,
		"zenodo",
		config.zenodo.environment,
	);
	if (!row && !journal) return undefined;
	const identifierPolicy = row?.identifierPolicy ?? target?.identifierPolicy;
	if (!identifierPolicy) return undefined;
	return parseProviderSyncState({
		zenodo: {
			environment: config.zenodo.environment,
			identifierPolicy,
			...(row?.lastPayloadHash && row.lastPayloadSnapshot
				? {
						lastSuccess: {
							payloadHash: row.lastPayloadHash,
							payloadSnapshot: row.lastPayloadSnapshot,
							...(row.lastFileManifestHash
								? { fileManifestHash: row.lastFileManifestHash }
								: {}),
							...(row.lastFileManifestSnapshot
								? { fileManifestSnapshot: row.lastFileManifestSnapshot }
								: {}),
						},
					}
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
							...(journal.parentId ? { parentId: journal.parentId } : {}),
							payloadHash: journal.payloadHash,
							...(journal.fileManifestHash
								? { fileManifestHash: journal.fileManifestHash }
								: {}),
							status: journal.status,
						},
					}
				: {}),
		},
		...(failure ? { failure } : {}),
	});
}

function planSummary(
	plan: PublicationSyncPlan | null,
	provider: PublicationProvider,
	unavailableReason = "LOCAL_VALIDATION_FAILED",
): AdminPublicationPlanSummary {
	if (!plan) {
		return { status: "unavailable", reason: unavailableReason, operations: [] };
	}
	return {
		status: plan.status,
		reason: "reason" in plan ? plan.reason : null,
		operations:
			plan.status === "write_required"
				? plan.operations
						.filter((operation) => operation.type.startsWith(provider))
						.map((operation) => operation.type)
				: [],
	};
}

function jobSummary(
	job: PublicationRepositorySnapshot["jobs"][number] | null,
): AdminPublicationJobSummary | null {
	if (!job) return null;
	return {
		id: job.id,
		attempts: job.attempts,
		nextAttemptAt: job.nextAttemptAt.toISOString(),
		leaseOwner: job.leaseOwner,
		leaseExpiresAt: iso(job.leaseExpiresAt),
		processedAt: iso(job.processedAt),
		deadLetteredAt: iso(job.deadLetteredAt),
		supersededAt: iso(job.supersededAt),
		lastError: job.lastError,
		receipt: job.resultReceipt,
	};
}

function identifierSummaries(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
): readonly AdminPublicationIdentifierSummary[] {
	return identifiersFor(snapshot, provider, environment).map((identifier) => ({
		doi: identifier.doi,
		lifecycle: identifier.lifecycle,
		ownership: identifier.ownership,
		role: identifier.role,
	}));
}

function planIssues(plan: PublicationSyncPlan | null) {
	if (plan?.status !== "needs_attention") return [];
	if (plan.issues?.length) return plan.issues.map((issue) => issue.message);
	const messages: Record<typeof plan.reason, string> = {
		MISSING_MANAGED_CROSSREF_DOI:
			"Activate and verify the Crossref DOI required by this publication",
		MISSING_ZENODO_PROVIDER_RECORD_ID:
			"The saved Zenodo DOI is missing its Zenodo record ID",
		CROSSREF_VALIDATION_FAILED:
			"The record does not meet Crossref publication requirements",
		ZENODO_VALIDATION_FAILED:
			"The record does not meet Zenodo publication requirements",
		ZENODO_IDENTIFIER_POLICY_IMMUTABLE:
			"The Zenodo DOI policy cannot change after the first publication",
	};
	return [messages[plan.reason]];
}

function environment(
	config: PublicationConfig,
	provider: PublicationProvider,
) {
	return config[provider].environment;
}

function configured(config: PublicationConfig, provider: PublicationProvider) {
	return provider === "crossref"
		? config.crossref.enabled
		: config.zenodo.enabled;
}

function providerFailure(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
) {
	const row = stateFor(snapshot, provider, environment);
	return row?.lastFailureClass && row.lastFailureSummary && row.consecutiveFailures > 0
		? {
				failureClass: row.lastFailureClass,
				summary: row.lastFailureSummary,
				consecutiveCount: row.consecutiveFailures,
			}
		: null;
}

export function buildAdminPublicationViewFromSnapshot(input: {
	itemKey: string;
	snapshot: PublicationRepositorySnapshot;
	config: Pick<LibraryServerConfig, "identity" | "services">;
	now?: Date;
}): AdminPublicationView {
	const { snapshot } = input;
	const record = snapshot.record;
	if (!record) throw new PublicationItemNotFoundError(input.itemKey);

	const publicationConfig = input.config.services.publication;
	const crossrefEnvironment = publicationConfig.crossref.environment;
	const zenodoEnvironment = publicationConfig.zenodo.environment;
	const crossrefDoi = currentManagedDoi(
		snapshot,
		"crossref",
		crossrefEnvironment,
		"primary",
	);
	const zenodoVersionDoi = currentManagedDoi(
		snapshot,
		"zenodo",
		zenodoEnvironment,
		"version",
	);
	const zenodoConceptDoi = currentManagedDoi(
		snapshot,
		"zenodo",
		zenodoEnvironment,
		"concept",
	);
	const managedZenodoDois = identifiersFor(
		snapshot,
		"zenodo",
		zenodoEnvironment,
	)
		.filter((identifier) => identifier.ownership === "managed")
		.map((identifier) => identifier.doi);
	const bibliographicDoi = resolveBibliographicDoi({
		DOI: record.DOI,
		extra: record.extra,
		attachments: snapshot.attachments,
	}, {
		ignoredDois: managedZenodoDois,
	});
	const identifiers = buildPublicationIdentifiers({
		bibliographicDoi: bibliographicDoi.doi,
		managedCrossrefDoi: crossrefDoi,
		zenodoVersionDoi,
		zenodoConceptDoi,
	});
	let files = buildPublicationFileManifest([]);
	let fileError: string | null = null;
	try {
		files = buildPublicationFileManifest(snapshot.files);
	} catch (error) {
		fileError =
			error instanceof Error && error.message.includes("duplicate filename")
				? "Published files must use different filenames"
				: error instanceof Error
					? `Published files are invalid: ${error.message}`
				: "The published files cannot be prepared for Zenodo";
	}

	let publicationRecord = null;
	let recordError: string | null = null;
	try {
		publicationRecord = buildPublicationRecordSnapshot({
			record,
			tags: snapshot.tags,
			baseUrl: input.config.identity.baseUrl,
			license: publicationConfig.zenodo.license,
		});
	} catch (error) {
		recordError = error instanceof Error ? error.message : "The record is invalid";
	}

	const crossrefTarget = targetFor(
		snapshot,
		"crossref",
		crossrefEnvironment,
	);
	const zenodoTarget = targetFor(snapshot, "zenodo", zenodoEnvironment);
	const crossrefState = stateFor(
		snapshot,
		"crossref",
		crossrefEnvironment,
	);
	const zenodoState = stateFor(snapshot, "zenodo", zenodoEnvironment);
	const managedCrossref = identifiersFor(
		snapshot,
		"crossref",
		crossrefEnvironment,
	).find(
		(identifier) => identifier.role === "primary" && identifier.ownership === "managed",
	);

	const sharedBlockers = unique([
		record.deleted === 1 ? "Restore this record before publishing it" : null,
		record.parentItem ? "Only parent records can be published" : null,
		recordError,
		bibliographicDoi.status === "conflict"
			? "This record contains different DOI values. Make them match before publishing it"
			: null,
	]);
	const namespaceMismatch =
		snapshot.namespace &&
		snapshot.namespace.nextSequence > 1 &&
		(snapshot.namespace.prefix !== publicationConfig.crossref.prefix ||
			snapshot.namespace.suffixNamespace !==
				publicationConfig.crossref.suffixNamespace)
			? "The configured DOI prefix or namespace does not match the namespace already used by this library"
			: null;
	const canonicalManagedMismatch =
		managedCrossref &&
		bibliographicDoi.status === "resolved" &&
		bibliographicDoi.doi !== managedCrossref.doi
			? "The record DOI does not match its reserved Crossref DOI"
			: null;
	const existingBibliographicDoi =
		bibliographicDoi.status === "resolved" &&
		!managedCrossref
			? bibliographicDoi.doi
			: null;
	const crossrefExternalDoi =
		existingBibliographicDoi &&
		publicationConfig.crossref.prefix &&
		!existingBibliographicDoi.startsWith(`${publicationConfig.crossref.prefix}/`)
			? existingBibliographicDoi
			: null;
	let crossrefValidation: readonly string[] = [];
	let zenodoValidation: readonly string[] = [];
	if (publicationRecord && publicationConfig.crossref.prefix) {
		const validationDoi =
			managedCrossref?.doi ??
			(bibliographicDoi.status === "resolved" ? bibliographicDoi.doi : null) ??
			`${publicationConfig.crossref.prefix}/${publicationConfig.crossref.suffixNamespace ?? "preview."}000000`;
		const mapped = mapCrossrefRecord(publicationRecord, validationDoi);
		if (!mapped.ok) {
			crossrefValidation = mapped.issues.map((issue) => issue.message);
		}
	}
	if (publicationRecord) {
		const validationPlan = planPublicationSync({
			record: publicationRecord,
			files,
			identifiers: {},
			targets: {
				crossref: { enabled: false },
				zenodo: {
					enabled: true,
					environment: publicationConfig.zenodo.environment,
					identifierPolicy: "mint-zenodo",
				},
			},
		});
		zenodoValidation = planIssues(validationPlan);
	}
	const crossrefRelationWaiting = Boolean(
		crossrefTarget &&
			zenodoTarget?.identifierPolicy === "mint-zenodo" &&
			zenodoVersionDoi &&
			zenodoValidation.length > 0,
	);

	let crossrefPlan: PublicationSyncPlan | null = null;
	let zenodoPlan: PublicationSyncPlan | null = null;
	const stateErrors: Partial<Record<PublicationProvider, string>> = {};
	let crossrefProviderState: ProviderSyncState | undefined;
	let zenodoProviderState: ProviderSyncState | undefined;
	try {
		crossrefProviderState = providerState(
			snapshot,
			"crossref",
			publicationConfig,
		);
	} catch {
		stateErrors.crossref = "Saved Crossref publication state is invalid";
	}
	try {
		zenodoProviderState = providerState(
			snapshot,
			"zenodo",
			publicationConfig,
		);
	} catch {
		stateErrors.zenodo = "Saved Zenodo publication state is invalid";
	}
	if (publicationRecord) {
		try {
			if (!crossrefRelationWaiting) {
				const state =
					crossrefProviderState || zenodoProviderState
						? {
								...crossrefProviderState,
								...(zenodoProviderState?.zenodo
									? { zenodo: zenodoProviderState.zenodo }
									: {}),
							}
						: undefined;
				crossrefPlan = planPublicationSync({
					record: publicationRecord,
					files,
					identifiers,
					targets: {
						crossref: crossrefTarget
							? {
									enabled: true,
									environment: publicationConfig.crossref.environment,
								}
							: { enabled: false },
						zenodo:
							crossrefTarget &&
							zenodoTarget?.identifierPolicy === "mint-zenodo" &&
							zenodoVersionDoi
								? {
										enabled: true,
										environment:
											publicationConfig.zenodo.environment,
										identifierPolicy: "mint-zenodo",
									}
								: { enabled: false },
					},
					...(state ? { state } : {}),
				});
			}
		} catch (error) {
			stateErrors.crossref =
				error instanceof Error
					? `Crossref publication planning failed: ${error.message}`
					: "Crossref publication planning failed";
		}
		try {
			zenodoPlan = planPublicationSync({
				record: publicationRecord,
				files,
				identifiers,
				targets: {
					crossref: { enabled: false },
					zenodo: zenodoTarget?.identifierPolicy
						? {
								enabled: true,
								environment: publicationConfig.zenodo.environment,
								identifierPolicy: zenodoTarget.identifierPolicy,
							}
						: { enabled: false },
				},
				...(zenodoProviderState ? { state: zenodoProviderState } : {}),
			});
		} catch (error) {
			stateErrors.zenodo =
				error instanceof Error
					? `Zenodo publication planning failed: ${error.message}`
					: "Zenodo publication planning failed";
		}
	}

	const zenodoJournals = snapshot.journals.filter(
		(journal) => journal.provider === "zenodo",
	);
	const crossrefBlockers = unique([
		...sharedBlockers,
		!publicationConfig.crossref.enabled
			? "Crossref test publishing is not configured for this library"
			: null,
		namespaceMismatch,
		canonicalManagedMismatch,
		crossrefExternalDoi
			? `This record already has an external DOI (${crossrefExternalDoi}), so Crossref cannot assign another one`
			: null,
		stateErrors.crossref,
		...crossrefValidation,
		...planIssues(crossrefPlan),
	]);
	const zenodoBlockers = unique([
		...sharedBlockers,
		fileError,
		!publicationConfig.zenodo.enabled
			? "Zenodo Sandbox publishing is not configured for this library"
			: null,
		existingBibliographicDoi
			? `This record already has an external DOI (${existingBibliographicDoi}), so Zenodo publishing is unavailable`
			: null,
		zenodoJournals.length > 1
			? "More than one unfinished Zenodo publication exists for this record"
			: null,
		stateErrors.zenodo,
		...zenodoValidation,
		...planIssues(zenodoPlan),
	]);

	const waitingOn =
		zenodoTarget?.identifierPolicy === "reuse-crossref" &&
		managedCrossref?.lifecycle !== "verified"
			? ("crossref" as const)
			: zenodoTarget && files.files.length === 0 && zenodoJournals.length === 0
				? ("file" as const)
				: null;
	const displayLinks = buildDoiDisplayLinks({
		bibliographicDoi: bibliographicDoi.doi,
		crossrefDoi,
		zenodoVersionDoi,
		zenodoConceptDoi,
		zenodoRecordId: zenodoState?.zenodoRecordId,
		zenodoConceptRecordId: zenodoState?.zenodoParentId,
		zenodoBaseUrl:
			publicationConfig.zenodo.environment === "sandbox"
				? "https://sandbox.zenodo.org"
				: null,
	});

	const providerView = (
		provider: PublicationProvider,
		plan: PublicationSyncPlan | null,
		blockers: readonly string[],
	): AdminPublicationProviderView => {
		const target = provider === "crossref" ? crossrefTarget : zenodoTarget;
		const state = provider === "crossref" ? crossrefState : zenodoState;
		const providerEnvironment = environment(publicationConfig, provider);
		const job = latestJobFor(snapshot, provider, providerEnvironment);
		const planState = planSummary(
			plan,
			provider,
			provider === "crossref" && crossrefRelationWaiting
				? "ZENODO_RELATION_NOT_READY"
				: "LOCAL_VALIDATION_FAILED",
		);
		const providerWaitingOn = provider === "zenodo" ? waitingOn : null;
		const failure = providerFailure(
			snapshot,
			provider,
			providerEnvironment,
		);
		const displayState = resolveAdminPublicationProviderState(
			{
				provider,
				configured: configured(publicationConfig, provider),
				targetActive: Boolean(target),
				blockers,
				plan: planState,
				job,
				pending: provider === "crossref" && Boolean(state?.pendingStage),
				journal: provider === "zenodo" && zenodoJournals.length === 1,
				failure: Boolean(failure),
				waitingOn: providerWaitingOn,
			},
			input.now,
		);
		const allowedIdentifierPolicies =
			provider === "zenodo" && zenodoBlockers.length === 0
				? ([
						...(managedCrossref ? ["reuse-crossref" as const] : []),
						"mint-zenodo" as const,
					] as const)
				: [];

		return {
			provider,
			environment: providerEnvironment,
			displayState,
			waitingOn: providerWaitingOn,
			blockers,
			capabilities: {
				canActivate: !target && blockers.length === 0,
				canRetry: Boolean(target) && displayState === "failed",
				actionLabel:
					provider === "crossref" ? "Activate Crossref DOI" : "Publish to Zenodo",
				allowedIdentifierPolicies,
			},
			exact: {
				targetActive: Boolean(target),
				target: target
					? {
							requestedBy: target.requestedBy,
							requestedAt: target.requestedAt.toISOString(),
						}
					: null,
				identifierPolicy: target?.identifierPolicy ?? null,
				plan: planState,
				job: jobSummary(job),
				recentJobs: snapshot.jobs
					.filter(
						(candidate) =>
							candidate.provider === provider &&
							candidate.environment === providerEnvironment,
					)
					.slice(0, 10)
					.flatMap((candidate) => {
						const summary = jobSummary(candidate);
						return summary ? [summary] : [];
					}),
				identifiers: identifierSummaries(
					snapshot,
					provider,
					providerEnvironment,
				),
				pending: provider === "crossref" && Boolean(state?.pendingStage),
				journal: provider === "zenodo" && zenodoJournals.length === 1,
				failure,
			},
			links: displayLinks.links
				.filter((link) => link.provider === provider)
				.map((link) => {
					const identifier = identifiersFor(
						snapshot,
						provider,
						providerEnvironment,
					).find(
						(row) => row.doi === link.value,
					);
					const status = identifier?.lifecycle === "reserved" ? "reserved" : "active";
					return {
						...link,
						label:
							status === "reserved" ? `Reserved ${link.label}` : link.label,
						status,
					};
				}),
		};
	};

	return {
		itemKey: record.key,
		canonicalRevision: record.revision,
		bibliographicDoi,
		doiNamespace:
			publicationConfig.crossref.prefix &&
			publicationConfig.crossref.suffixNamespace
				? {
						prefix: publicationConfig.crossref.prefix,
						suffixNamespace: publicationConfig.crossref.suffixNamespace,
					}
				: null,
		providers: {
			crossref: providerView("crossref", crossrefPlan, crossrefBlockers),
			zenodo: providerView("zenodo", zenodoPlan, zenodoBlockers),
		},
	};
}

export async function buildAdminPublicationView(
	itemKey: string,
): Promise<AdminPublicationView> {
	const config = await getLibraryConfig();
	const database = await getDatabaseForConfig(config);
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		config.services.publication.crossref.environment,
	);
	return buildAdminPublicationViewFromSnapshot({ itemKey, snapshot, config });
}
