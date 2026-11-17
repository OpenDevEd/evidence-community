import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";
import {
	mapCrossrefRecord,
	planPublicationSync,
	type ProviderSyncState,
	type PublicationSyncPlan,
} from "@opendeved/doi-sync-core";
import {
	buildDoiDisplayLinks,
	type DoiDisplayLink,
} from "@opendeved/doi-sync-core/display";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { PublicationProvider } from "@/db/schema/publication";

import {
	resolveBibliographicDoi,
	type BibliographicDoiResolution,
} from "./bibliographic-doi";
import {
	describeAdminPublicationProviderState,
	resolveAdminPublicationProviderState,
	type AdminPublicationProviderStatus,
	type AdminPublicationProviderState,
} from "./admin-publication-state";
import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	inspectPublicationRecordSnapshot,
} from "./record-adapter";
import type { PublicationRepositorySnapshot } from "./repository";
import type { PublicationRecordExtras } from "./record-extras";
import { PublicationItemNotFoundError } from "./errors";
import { describeProviderIssue } from "./provider-issue";
import {
	currentManagedDoi,
	identifiersFor,
	providerState,
	stateFor,
	targetFor,
} from "./state-adapter";

type PublicationConfig = LibraryServerConfig["services"]["publication"];
type PublicationEnvironment = "test" | "sandbox" | "production";

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
	environment: "test" | "sandbox" | "production";
	displayState: AdminPublicationProviderState;
	status: AdminPublicationProviderStatus;
	waitingOn: "crossref" | "file" | null;
	blockers: readonly string[];
	/** A DOI that came with the record from another source, if any. */
	externalDoi: string | null;
	capabilities: {
		canActivate: boolean;
		canRetry: boolean;
		actionLabel: string;
		allowedIdentifierPolicies: readonly ZenodoIdentifierPolicy[];
	};
	exact: {
		targetActive: boolean;
		target: {
			requestedBy: string;
			requestedAt: string;
		} | null;
		identifierPolicy: ZenodoIdentifierPolicy | null;
		plan: AdminPublicationPlanSummary;
		job: AdminPublicationJobSummary | null;
		recentJobs: readonly AdminPublicationJobSummary[];
		identifiers: readonly AdminPublicationIdentifierSummary[];
		pending: boolean;
		pendingSubmission: {
			batchId: string;
			filename: string;
			submittedAt: string;
			reason: string | null;
		} | null;
		journal: boolean;
		failure: {
			failureClass: string;
			summary: string;
			consecutiveCount: number;
		} | null;
	};
	links: readonly AdminPublicationLink[];
};

export type AdminIdentifiersActionId =
	| "register-crossref"
	| "archive-zenodo"
	| "mint-zenodo";

export type AdminIdentifiersReadinessItem = {
	label: string;
	ok: boolean;
	/** Record field to jump to when the item is not ok, when known. */
	field: string | null;
};

export type AdminIdentifiersAction = {
	id: AdminIdentifiersActionId;
	provider: PublicationProvider;
	label: string;
	/** Configured for this library and not already active. */
	available: boolean;
	readiness: readonly AdminIdentifiersReadinessItem[];
	/** Every readiness item is ok. */
	ready: boolean;
};

export type AdminIdentifiersActivity =
	| { state: "none" }
	| {
			state: "active";
			provider: PublicationProvider;
			displayState: AdminPublicationProviderState;
			status: AdminPublicationProviderStatus;
			links: readonly AdminPublicationLink[];
	  };

/**
 * What the editor sees at a glance: does the record have a DOI, where it
 * came from, whether it is archived, and what they could do next. Built
 * from the provider views; nothing here is red until something the editor
 * activated has failed.
 */
export type AdminIdentifiersView = {
	doi: {
		value: string;
		origin: "crossref" | "zenodo" | "source" | "record";
		url: string;
	} | null;
	registration: AdminIdentifiersActivity;
	archive: AdminIdentifiersActivity;
	attention: boolean;
	actions: readonly AdminIdentifiersAction[];
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
	identifiers: AdminIdentifiersView;
};

const readinessFieldHints: ReadonlyArray<[RegExp, string]> = [
	[/\btitle\b/iu, "title"],
	[/abstract|description/iu, "abstractNote"],
	[/\b(author|creator)s?\b/iu, "creators"],
	[/\b(year|date)\b/iu, "date"],
	[/item type/iu, "itemType"],
	[/\blanguage\b/iu, "language"],
	[/\bpublisher\b/iu, "publisher"],
	[/\b(rights|licen[cs]e)\b/iu, "rights"],
];

function readinessFromBlockers(
	blockers: readonly string[],
): AdminIdentifiersReadinessItem[] {
	if (blockers.length === 0) {
		return [{ label: "Record details", ok: true, field: null }];
	}
	return blockers.map((label) => ({
		label,
		ok: false,
		field: readinessFieldHints.find(([test]) => test.test(label))?.[1] ?? null,
	}));
}

type IdentifiersViewInput = {
	crossref: AdminPublicationProviderView;
	zenodo: AdminPublicationProviderView;
	crossrefDoi: string | null;
	zenodoVersionDoi: string | null;
	externalDoi: string | null;
	configured: { crossref: boolean; zenodo: boolean };
};

type IdentifierDoi = NonNullable<AdminIdentifiersView["doi"]>;

function identifierDoi(input: IdentifiersViewInput): IdentifierDoi | null {
	const urlFor = (doi: string) =>
		buildDoiDisplayLinks({
			bibliographicDoi: doi,
			crossrefDoi: null,
			zenodoVersionDoi: null,
			zenodoConceptDoi: null,
			zenodoRecordId: null,
			zenodoConceptRecordId: null,
			zenodoBaseUrl: null,
		}).bibliographicDoi!.url;
	if (input.crossrefDoi) {
		return {
			value: input.crossrefDoi,
			origin: "crossref",
			url: urlFor(input.crossrefDoi),
		};
	}
	if (input.zenodoVersionDoi) {
		return {
			value: input.zenodoVersionDoi,
			origin: "zenodo",
			url: urlFor(input.zenodoVersionDoi),
		};
	}
	if (!input.externalDoi) return null;
	return {
		value: input.externalDoi,
		origin: "record",
		url: urlFor(input.externalDoi),
	};
}

function identifierActivity(
	view: AdminPublicationProviderView,
): AdminIdentifiersActivity {
	if (!view.exact.targetActive) return { state: "none" };
	return {
		state: "active",
		provider: view.provider,
		displayState: view.displayState,
		status: view.status,
		links: view.links,
	};
}

function identifierAction(
	input: IdentifiersViewInput,
	id: AdminIdentifiersActionId,
	view: AdminPublicationProviderView,
	label: string,
): AdminIdentifiersAction {
	const readiness = readinessFromBlockers(view.blockers);
	return {
		id,
		provider: view.provider,
		label,
		available: input.configured[view.provider],
		readiness,
		ready: readiness.every((item) => item.ok),
	};
}

function identifierActions(
	input: IdentifiersViewInput,
	doi: IdentifierDoi | null,
) {
	const actions: AdminIdentifiersAction[] = [];
	const hasOutsideDoi = doi !== null && doi.origin !== "crossref";
	if (!input.crossref.exact.targetActive && !hasOutsideDoi) {
		actions.push(
			identifierAction(
				input,
				"register-crossref",
				input.crossref,
				"Register a DOI with Crossref",
			),
		);
	}
	if (!input.zenodo.exact.targetActive) {
		if (hasOutsideDoi || doi?.origin === "crossref") {
			actions.push(
				identifierAction(
					input,
					"archive-zenodo",
					input.zenodo,
					"Archive on Zenodo",
				),
			);
		} else {
			actions.push(
				identifierAction(
					input,
					"mint-zenodo",
					input.zenodo,
					"Archive on Zenodo and get its DOI",
				),
			);
		}
	}
	return actions;
}

function buildIdentifiersView(input: IdentifiersViewInput): AdminIdentifiersView {
	const doi = identifierDoi(input);
	return {
		doi,
		registration: identifierActivity(input.crossref),
		archive: identifierActivity(input.zenodo),
		attention:
			input.crossref.displayState === "failed" ||
			input.zenodo.displayState === "failed",
		actions: identifierActions(input, doi),
	};
}

function iso(value: Date | null) {
	return value?.toISOString() ?? null;
}

function unique(messages: readonly (string | null | undefined)[]) {
	return [
		...new Set(
			messages.filter((message): message is string => Boolean(message)),
		),
	];
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

function planSummary(
	plan: PublicationSyncPlan | null,
	provider: PublicationProvider,
	unavailableReason = "LOCAL_VALIDATION_FAILED",
): AdminPublicationPlanSummary {
	if (!plan) {
		return {
			status: "unavailable",
			reason: unavailableReason,
			operations: [],
		};
	}
	return {
		status: plan.status,
		reason: "reason" in plan ? plan.reason : null,
		operations:
			plan.status === "write_required"
				? plan.operations
						.filter((operation) =>
							operation.type.startsWith(provider),
						)
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
		lastError: describeJobError(job.lastError),
		receipt: job.resultReceipt,
	};
}

function identifierSummaries(
	snapshot: PublicationRepositorySnapshot,
	provider: PublicationProvider,
	environment: PublicationEnvironment,
): readonly AdminPublicationIdentifierSummary[] {
	return identifiersFor(snapshot, provider, environment).map(
		(identifier) => ({
			doi: identifier.doi,
			lifecycle: identifier.lifecycle,
			ownership: identifier.ownership,
			role: identifier.role,
		}),
	);
}

type NeedsAttentionReason = Extract<PublicationSyncPlan, { status: "needs_attention" }>["reason"];

const PLAN_REASON_MESSAGES: Record<NeedsAttentionReason, string> = {
		MISSING_MANAGED_CROSSREF_DOI:
			"Activate and verify the Crossref DOI required by this publication",
		MISSING_EXTERNAL_DOI:
			"Add the record's DOI before archiving it on Zenodo under that DOI",
		MISSING_ZENODO_PROVIDER_RECORD_ID:
			"The saved Zenodo DOI is missing its Zenodo record ID",
		CROSSREF_VALIDATION_FAILED:
			"The record does not meet Crossref publication requirements",
		ZENODO_VALIDATION_FAILED:
			"The record does not meet Zenodo publication requirements",
		ZENODO_IDENTIFIER_POLICY_IMMUTABLE:
			"The Zenodo DOI policy cannot change after the first publication",
		ZENODO_FIRST_PUBLICATION_TIME_REQUIRED:
			"Zenodo did not return the publication date needed to safely replace this PDF",
		ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED:
			"Approve this exact PDF as a minor correction before publishing it",
		ZENODO_FILE_CORRECTION_WINDOW_CLOSED:
			"The allowed time for this Zenodo PDF correction has ended",
};

function planIssues(
	plan: PublicationSyncPlan | null,
	provider: "Crossref" | "Zenodo",
	itemType: string,
) {
	if (plan?.status !== "needs_attention") return [];
	if (plan.issues?.length)
		return plan.issues.map(
			(issue) => describeProviderIssue(provider, issue, itemType).text,
		);
	return [PLAN_REASON_MESSAGES[plan.reason]];
}

/** The worker stores "Record is unsafe to sync: <reason>" for a plan that needed attention; show the reason's message instead. */
function describeJobError(error: string | null) {
	const reason = error?.match(/^Record is unsafe to sync: (\w+)$/)?.[1];
	return reason && reason in PLAN_REASON_MESSAGES ? PLAN_REASON_MESSAGES[reason as NeedsAttentionReason] : error;
}

function environment(config: PublicationConfig, provider: PublicationProvider) {
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
	return row?.lastFailureClass &&
		row.lastFailureSummary &&
		row.consecutiveFailures > 0
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
	/**
	 * What the deposit carries beyond the record's row, so the view compares the payload the worker would send. An
	 * error when it couldn't be read: the record then shows that as what blocks it, as its deposit would wait.
	 */
	extras: PublicationRecordExtras | Error;
	now?: Date;
}): AdminPublicationView {
	const { snapshot } = input;
	const observedAt = input.now ?? new Date();
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
	const bibliographicDoi = resolveBibliographicDoi(
		{
			DOI: record.DOI,
			extra: record.extra,
			attachments: snapshot.attachments,
		},
		{
			ignoredDois: managedZenodoDois,
		},
	);
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
			error instanceof Error &&
			error.message.includes("duplicate filename")
				? "Published files must use different filenames"
				: error instanceof Error
					? `Published files are invalid: ${error.message}`
					: "The published files cannot be prepared for Zenodo";
	}

	let publicationRecord = null;
	let validationRecord = null;
	let recordErrors: readonly string[] = [];
	try {
		if (input.extras instanceof Error) throw input.extras;
		const inspected = inspectPublicationRecordSnapshot({
			record,
			tags: snapshot.tags,
			baseUrl: input.config.identity.baseUrl,
			extras: input.extras,
		});
		validationRecord = inspected.record;
		recordErrors = inspected.issues;
		if (inspected.issues.length === 0) publicationRecord = inspected.record;
	} catch (error) {
		recordErrors = [
			error instanceof Error ? error.message : "The record is invalid",
		];
	}

	const crossrefTarget = targetFor(snapshot, "crossref", crossrefEnvironment);
	const zenodoTarget = targetFor(snapshot, "zenodo", zenodoEnvironment);
	const crossrefState = stateFor(snapshot, "crossref", crossrefEnvironment);
	const zenodoState = stateFor(snapshot, "zenodo", zenodoEnvironment);
	const managedCrossref = identifiersFor(
		snapshot,
		"crossref",
		crossrefEnvironment,
	).find(
		(identifier) =>
			identifier.role === "primary" && identifier.ownership === "managed",
	);

	const sharedBlockers = unique([
		record.deleted === 1
			? "Restore this record before publishing it"
			: null,
		record.parentItem ? "Only parent records can be published" : null,
		...recordErrors,
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
			? "The configured DOI prefix or namespace does not match the namespace already used by this community"
			: null;
	const canonicalManagedMismatch =
		managedCrossref &&
		bibliographicDoi.status === "resolved" &&
		bibliographicDoi.doi !== managedCrossref.doi
			? "The record DOI does not match its reserved Crossref DOI"
			: null;
	const existingBibliographicDoi =
		bibliographicDoi.status === "resolved" && !managedCrossref
			? bibliographicDoi.doi
			: null;
	const archivedExternalDoi =
		zenodoTarget?.identifierPolicy === "reuse-external"
			? (zenodoState?.zenodoVersionDoi ?? null)
			: null;
	const archivedDoiMismatch =
		archivedExternalDoi && existingBibliographicDoi !== archivedExternalDoi
			? `The record DOI no longer matches the DOI archived on Zenodo (${archivedExternalDoi})`
			: null;
	let crossrefValidation: readonly string[] = [];
	let zenodoValidation: readonly string[] = [];
	if (validationRecord && publicationConfig.crossref.prefix) {
		const validationDoi =
			managedCrossref?.doi ??
			(bibliographicDoi.status === "resolved"
				? bibliographicDoi.doi
				: null) ??
			`${publicationConfig.crossref.prefix}/${publicationConfig.crossref.suffixNamespace ?? "preview."}validation`;
		const mapped = mapCrossrefRecord(validationRecord, validationDoi);
		if (!mapped.ok) {
			crossrefValidation = mapped.issues.map(
				(issue) =>
					describeProviderIssue("Crossref", issue, validationRecord.itemType)
						.text,
			);
		}
	}
	if (validationRecord) {
		const validationPlan = planPublicationSync({
			observedAt,
			record: validationRecord,
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
		zenodoValidation = planIssues(
			validationPlan,
			"Zenodo",
			validationRecord.itemType,
		);
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
					observedAt,
					record: publicationRecord,
					files,
					identifiers,
					targets: {
						crossref: crossrefTarget
							? {
									enabled: true,
									environment:
										publicationConfig.crossref.environment,
								}
							: { enabled: false },
						zenodo:
							crossrefTarget &&
							zenodoTarget?.identifierPolicy === "mint-zenodo" &&
							zenodoVersionDoi
								? {
										enabled: true,
										environment:
											publicationConfig.zenodo
												.environment,
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
				observedAt,
				record: publicationRecord,
				files,
				identifiers,
				targets: {
					crossref: { enabled: false },
					zenodo: zenodoTarget?.identifierPolicy
						? {
								enabled: true,
								environment:
									publicationConfig.zenodo.environment,
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
		(journal) => journal.provider === "zenodo" && journal.environment === publicationConfig.zenodo.environment,
	);
	const crossrefBlockers = unique([
		...sharedBlockers,
		!publicationConfig.crossref.enabled
			? "Crossref publishing is not configured for this community"
			: null,
		namespaceMismatch,
		canonicalManagedMismatch,
		stateErrors.crossref,
		...crossrefValidation,
		...planIssues(crossrefPlan, "Crossref", validationRecord?.itemType ?? ""),
	]);
	const preparingFirstDraft = Boolean(zenodoTarget && files.files.length === 0 && zenodoJournals.length === 0 && !zenodoVersionDoi && !zenodoState?.zenodoRecordId);
	const zenodoBlockers = unique([
		...sharedBlockers,
		fileError,
		archivedDoiMismatch,
		!publicationConfig.zenodo.enabled
			? "Zenodo publishing is not configured for this community"
			: null,
		zenodoJournals.length > 1
			? "More than one unfinished Zenodo publication exists for this record"
			: null,
		stateErrors.zenodo,
		...(preparingFirstDraft ? [] : zenodoValidation),
		...(preparingFirstDraft ? [] : planIssues(zenodoPlan, "Zenodo", validationRecord?.itemType ?? "")),
	]);

	const waitingOn =
		zenodoTarget?.identifierPolicy === "reuse-crossref" &&
		managedCrossref?.lifecycle !== "verified"
			? ("crossref" as const)
			: zenodoTarget &&
				  files.files.length === 0 &&
				  zenodoJournals.length === 0
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
		const planState: AdminPublicationPlanSummary = provider === "zenodo" && preparingFirstDraft
            ? {status: "waiting_for_file", reason: "WAITING_FOR_APPROVED_FILE", operations: []}
            : planSummary(
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
		const resolvedDisplayState = resolveAdminPublicationProviderState(
			{
				provider,
				configured: configured(publicationConfig, provider),
				targetActive: Boolean(target),
				blockers,
				plan: planState,
				job,
				pending:
					provider === "crossref" && Boolean(state?.pendingStage),
				journal: provider === "zenodo" && zenodoJournals.length === 1,
				failure: Boolean(failure),
				waitingOn: providerWaitingOn,
				externalDoi: existingBibliographicDoi,
			},
			input.now,
		);
		const displayState = failure ? "failed" : resolvedDisplayState;
		const allowedIdentifierPolicies: ZenodoIdentifierPolicy[] =
			provider !== "zenodo" || zenodoBlockers.length > 0
				? []
				: existingBibliographicDoi
					? ["reuse-external"]
					: [
							...(managedCrossref ? (["reuse-crossref"] as const) : []),
							"mint-zenodo",
						];
		const pendingSubmission =
			provider === "crossref" &&
			state?.pendingBatchId &&
			state.pendingFilename &&
			state.pendingSubmittedAt
				? {
						batchId: state.pendingBatchId,
						filename: state.pendingFilename,
						submittedAt: state.pendingSubmittedAt.toISOString(),
						reason: state.pendingReason,
					}
				: null;

		return {
			provider,
			environment: providerEnvironment,
			displayState,
			status: describeAdminPublicationProviderState({
				provider,
				state: displayState,
				waitingOn: providerWaitingOn,
				firstBlocker: blockers[0] ?? null,
				externalDoi: existingBibliographicDoi,
			}),
			waitingOn: providerWaitingOn,
			// Crossref has nothing to fix when another registrar owns the DOI.
			blockers:
				provider === "crossref" && displayState === "external"
					? []
					: blockers,
			externalDoi: existingBibliographicDoi,
			capabilities: {
				canActivate:
					!target && blockers.length === 0 && displayState !== "external",
				canRetry: Boolean(target && job?.deadLetteredAt) && displayState === "failed" && planState.status !== "needs_attention",
				actionLabel:
					provider === "crossref"
						? "Activate Crossref DOI"
						: "Publish to Zenodo",
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
				pending:
					provider === "crossref" && Boolean(state?.pendingStage),
				pendingSubmission,
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
					).find((row) => row.doi === link.value);
					const status =
						identifier?.lifecycle === "reserved"
							? "reserved"
							: "active";
					return {
						...link,
						label:
							status === "reserved"
								? `Reserved ${link.label}`
								: link.label,
						status,
					};
				}),
		};
	};

	const crossrefView = providerView("crossref", crossrefPlan, crossrefBlockers);
	const zenodoView = providerView("zenodo", zenodoPlan, zenodoBlockers);
	return {
		itemKey: record.key,
		canonicalRevision: record.revision,
		bibliographicDoi,
		doiNamespace:
			publicationConfig.crossref.prefix &&
			publicationConfig.crossref.suffixNamespace
				? {
						prefix: publicationConfig.crossref.prefix,
						suffixNamespace:
							publicationConfig.crossref.suffixNamespace,
					}
				: null,
		providers: { crossref: crossrefView, zenodo: zenodoView },
		identifiers: buildIdentifiersView({
			crossref: crossrefView,
			zenodo: zenodoView,
			crossrefDoi: crossrefDoi ?? null,
			zenodoVersionDoi: zenodoVersionDoi ?? null,
			externalDoi: existingBibliographicDoi,
			configured: {
				crossref: configured(publicationConfig, "crossref"),
				zenodo: configured(publicationConfig, "zenodo"),
			},
		}),
	};
}
