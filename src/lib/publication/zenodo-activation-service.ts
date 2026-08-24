import { planPublicationSync } from "@opendeved/doi-sync-core";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationSyncJob,
	publicationSyncState,
	publicationIdentifier,
	publicationTarget,
	type ZenodoIdentifierPolicy,
} from "@/db/schema/publication";

import { resolveBibliographicDoi } from "./bibliographic-doi";
import {
	ZenodoActivationConfigurationError,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
	PublicationItemNotFoundError,
} from "./errors";
import {
	publicationJobIdempotencyKey,
	publicationJobState,
	savePublicationJob,
	supersedeUnleasedPublicationJobs,
} from "./queue";
import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
} from "./record-adapter";
import {
	readPublicationRepositorySnapshot,
	type PublicationRepositorySnapshot,
} from "./repository";

export {
	PublicationItemNotFoundError,
	ZenodoActivationConfigurationError,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "./errors";

type PublicationConfig = Pick<LibraryServerConfig, "identity" | "services">;

export type ZenodoActivationPolicyInput = {
	configuredDefault: ZenodoIdentifierPolicy;
	requestedPolicy?: ZenodoIdentifierPolicy;
	bibliographicDoi: string | null;
	managedCrossref: {
		doi: string;
		lifecycle: "reserved" | "verified";
	} | null;
};

export type ZenodoActivationReceipt = {
	itemKey: string;
	provider: "zenodo";
	environment: "sandbox";
	identifierPolicy: ZenodoIdentifierPolicy;
	canonicalRevision: number;
	fileRevision: number | null;
	state:
		| "waiting_for_crossref"
		| "waiting_for_file"
		| "queued"
		| "working"
		| "retrying"
		| "failed"
		| "published";
	job: {
		id: number;
		state: "queued" | "working" | "retrying" | "failed" | "finished";
	} | null;
};

export function resolveZenodoActivationPolicy(
	input: ZenodoActivationPolicyInput,
): ZenodoIdentifierPolicy {
	// A DOI the record brought with it (not the one Crossref registered here).
	const ownDoi =
		input.bibliographicDoi &&
		input.bibliographicDoi !== input.managedCrossref?.doi
			? input.bibliographicDoi
			: null;
	if (input.requestedPolicy === "reuse-external") {
		if (!ownDoi) {
			throw new ZenodoActivationValidationError(
				input.bibliographicDoi
					? "This record's DOI was registered here through Crossref. Choose \"Use the Crossref DOI\" instead."
					: "Add the record's DOI before archiving it on Zenodo under that DOI.",
				{ DOI: "Enter the DOI this record already has." },
			);
		}
		return "reuse-external";
	}
	if (ownDoi) {
		if (input.requestedPolicy) {
			throw new ZenodoActivationValidationError(
				`This record already has the DOI ${ownDoi}. Zenodo can archive it under that DOI, but cannot assign another one.`,
				{ identifierPolicy: "Choose \"Use the record's existing DOI\"." },
			);
		}
		return "reuse-external";
	}
	const policy = input.requestedPolicy ?? input.configuredDefault;
	if (policy === "reuse-crossref" && !input.managedCrossref) {
		throw new ZenodoActivationValidationError(
			"Activate a Crossref DOI for this record before reusing it on Zenodo.",
			{
				identifierPolicy:
					"Choose a Zenodo DOI or activate Crossref first.",
			},
		);
	}
	return policy;
}

export type DoiResolver = (
	url: string,
) => Promise<{ ok: boolean; status: number }>;

const defaultDoiResolver: DoiResolver = async (url) => {
	const response = await fetch(url, {
		method: "HEAD",
		redirect: "manual",
		signal: AbortSignal.timeout(8_000),
	});
	return {
		ok: response.status >= 200 && response.status < 400,
		status: response.status,
	};
};

/**
 * Zenodo will happily archive under any DOI string. Before reusing a DOI the
 * record brought with it, make sure doi.org knows it, so a typo never ends up
 * as a Zenodo record's DOI.
 */
export async function assertDoiResolves(
	doi: string,
	resolve: DoiResolver = defaultDoiResolver,
): Promise<void> {
	let result: { ok: boolean; status: number };
	try {
		result = await resolve(`https://doi.org/${encodeURIComponent(doi)}`);
	} catch {
		throw new ZenodoActivationValidationError(
			`The DOI ${doi} could not be checked with doi.org right now. Try again in a moment.`,
			{ DOI: "Could not be checked with doi.org." },
		);
	}
	if (!result.ok) {
		throw new ZenodoActivationValidationError(
			`The DOI ${doi} does not resolve at doi.org (status ${result.status}). Check the DOI before archiving under it.`,
			{ DOI: "This DOI does not resolve at doi.org." },
		);
	}
}

function requireZenodoConfig(config: PublicationConfig) {
	const zenodo = config.services.publication.zenodo;
	if (!zenodo.enabled) {
		throw new ZenodoActivationConfigurationError(
			"Zenodo Sandbox publishing is not configured for this library.",
		);
	}
	if (!zenodo.token) {
		throw new ZenodoActivationConfigurationError(
			"Zenodo Sandbox publishing is missing its account token.",
		);
	}
	return { ...zenodo, token: zenodo.token };
}

function activeZenodoJobs(
	jobs: readonly (typeof publicationSyncJob.$inferSelect)[],
) {
	return jobs.filter(
		(job) =>
			job.provider === "zenodo" &&
			job.environment === "sandbox" &&
			job.processedAt === null &&
			job.deadLetteredAt === null &&
			job.supersededAt === null,
	);
}

function receipt(input: {
	itemKey: string;
	identifierPolicy: ZenodoIdentifierPolicy;
	canonicalRevision: number;
	fileRevision: number | null;
	waitingOn: "crossref" | "file" | null;
	job: typeof publicationSyncJob.$inferSelect | null;
	providerRecordExists: boolean;
}): ZenodoActivationReceipt {
	const jobState = input.job ? publicationJobState(input.job) : null;
	const state =
		input.waitingOn === "crossref"
			? "waiting_for_crossref"
			: input.waitingOn === "file"
				? "waiting_for_file"
				: jobState && jobState !== "finished"
					? jobState
					: input.providerRecordExists || jobState === "finished"
						? "published"
						: "queued";
	return {
		itemKey: input.itemKey,
		provider: "zenodo",
		environment: "sandbox",
		identifierPolicy: input.identifierPolicy,
		canonicalRevision: input.canonicalRevision,
		fileRevision: input.fileRevision,
		state,
		job: input.job
			? { id: input.job.id, state: jobState ?? "queued" }
			: null,
	};
}

function zenodoHasStarted(snapshot: PublicationRepositorySnapshot) {
	return (
		snapshot.identifiers.some(
			(identifier) =>
				identifier.registrar === "zenodo" &&
				identifier.environment === "sandbox",
		) ||
		snapshot.states.some(
			(state) =>
				state.provider === "zenodo" &&
				state.environment === "sandbox" &&
				Boolean(state.lastPayloadHash || state.zenodoRecordId),
		) ||
		snapshot.journals.some(
			(journal) =>
				journal.provider === "zenodo" &&
				journal.environment === "sandbox",
		) ||
		snapshot.jobs.some(
			(job) =>
				job.provider === "zenodo" &&
				job.environment === "sandbox" &&
				Boolean(job.processedAt || job.leaseOwner),
		)
	);
}

function requireZenodoActivationRecord(
	snapshot: PublicationRepositorySnapshot,
) {
	const record = snapshot.record;
	if (!record) throw new PublicationItemNotFoundError("unknown");
	if (record.deleted === 1) {
		throw new ZenodoActivationValidationError(
			"Restore this record before publishing it to Zenodo.",
		);
	}
	if (record.parentItem) {
		throw new ZenodoActivationValidationError(
			"Only parent records can be published to Zenodo.",
		);
	}
	return record;
}

function resolveZenodoActivationDoi(
	snapshot: PublicationRepositorySnapshot,
	record: NonNullable<PublicationRepositorySnapshot["record"]>,
) {
	const resolution = resolveBibliographicDoi({
		DOI: record.DOI,
		extra: record.extra,
		attachments: snapshot.attachments,
	});
	if (resolution.status !== "conflict") return resolution;
	throw new ZenodoActivationValidationError(
		"This record contains different DOI values. Make them match first.",
		{
			DOI: resolution.conflicts
				.map(({ source, doi }) => `${source}: ${doi}`)
				.join("; "),
		},
	);
}

function prepareZenodoActivation(input: {
	snapshot: PublicationRepositorySnapshot;
	config: PublicationConfig;
	zenodo: ReturnType<typeof requireZenodoConfig>;
	now: Date;
	requestedPolicy?: ZenodoIdentifierPolicy;
}) {
	const { snapshot } = input;
	const record = requireZenodoActivationRecord(snapshot);

	const managedCrossrefRow = snapshot.identifiers.find(
		(identifier) =>
			identifier.registrar === "crossref" &&
			identifier.environment === "test" &&
			identifier.role === "primary" &&
			identifier.ownership === "managed" &&
			identifier.isCurrent,
	);
	const managedCrossref = managedCrossrefRow
		? {
				doi: managedCrossrefRow.doi,
				lifecycle: managedCrossrefRow.lifecycle,
			}
		: null;
	const bibliographicResolution = resolveZenodoActivationDoi(snapshot, record);
	const policy = resolveZenodoActivationPolicy({
		configuredDefault: input.zenodo.defaultIdentifierPolicy,
		requestedPolicy: input.requestedPolicy,
		bibliographicDoi: bibliographicResolution.doi,
		managedCrossref,
	});

	let publicationRecord;
	let files;
	try {
		publicationRecord = buildPublicationRecordSnapshot({
			record,
			tags: snapshot.tags,
			baseUrl: input.config.identity.baseUrl,
			license: input.zenodo.license,
		});
		files = buildPublicationFileManifest(snapshot.files);
	} catch (error) {
		throw new ZenodoActivationValidationError(
			error instanceof Error
				? error.message
				: "This record is not ready for Zenodo.",
		);
	}
	const validationPlan = planPublicationSync({
		observedAt: input.now,
		record: publicationRecord,
		files,
		identifiers: buildPublicationIdentifiers({
			bibliographicDoi: bibliographicResolution.doi,
			managedCrossrefDoi: managedCrossref?.doi,
		}),
		targets: {
			crossref: { enabled: false },
			zenodo: {
				enabled: true,
				environment: "sandbox",
				identifierPolicy: policy,
			},
		},
	});
	if (validationPlan.status === "needs_attention") {
		throw new ZenodoActivationValidationError(
			"Complete the required Zenodo fields and try again.",
			Object.fromEntries(
				(validationPlan.issues ?? []).map((issue) => [
					issue.path,
					issue.message,
				]),
			),
		);
	}
	const fileRevision =
		files.files.length === 0
			? null
			: Math.max(...files.files.map((file) => file.publicationRevision));
	const waitingOn =
		policy === "reuse-crossref" && managedCrossref?.lifecycle !== "verified"
			? ("crossref" as const)
			: fileRevision === null
				? ("file" as const)
				: null;
	return {
		externalDoi: policy === "reuse-external" ? bibliographicResolution.doi : null,
		fileRevision,
		managedCrossref,
		policy,
		record,
		waitingOn,
	};
}

function assertZenodoPolicyMayChange(
	snapshot: PublicationRepositorySnapshot,
	policy: ZenodoIdentifierPolicy,
) {
	const existingTarget = snapshot.targets.find(
		(target) =>
			target.provider === "zenodo" && target.environment === "sandbox",
	);
	if (
		existingTarget?.identifierPolicy &&
		existingTarget.identifierPolicy !== policy &&
		zenodoHasStarted(snapshot)
	) {
		throw new ZenodoIdentifierPolicyLockedError();
	}
}

async function saveZenodoActivationTarget(
	transaction: DatabaseTransaction,
	input: {
		lockedExternalDoi: string | null;
		itemKey: string;
		policy: ZenodoIdentifierPolicy;
		requestedBy: string;
		now: Date;
	},
) {
	await transaction
		.insert(publicationTarget)
		.values({
			itemKey: input.itemKey,
			provider: "zenodo",
			environment: "sandbox",
			identifierPolicy: input.policy,
			lockedExternalDoi: input.lockedExternalDoi,
			requestedBy: input.requestedBy,
			requestedAt: input.now,
			updatedAt: input.now,
		})
		.onConflictDoUpdate({
			target: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
			set: {
				identifierPolicy: input.policy,
				lockedExternalDoi: input.lockedExternalDoi,
				requestedBy: input.requestedBy,
				deactivatedAt: null,
				updatedAt: input.now,
			},
		});
	await transaction
		.update(publicationSyncState)
		.set({ identifierPolicy: input.policy, updatedAt: input.now })
		.where(
			and(
				eq(publicationSyncState.itemKey, input.itemKey),
				eq(publicationSyncState.provider, "zenodo"),
				eq(publicationSyncState.environment, "sandbox"),
			),
		);
}

async function selectZenodoActivationJob(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		policy: ZenodoIdentifierPolicy;
		canonicalRevision: number;
		fileRevision: number | null;
		waitingOn: "crossref" | "file" | null;
		jobs: PublicationRepositorySnapshot["jobs"];
		now: Date;
	},
) {
	const activeJobs = activeZenodoJobs(input.jobs);
	const leasedJob = activeJobs.find((job) => job.leaseOwner !== null) ?? null;
	if (input.waitingOn && leasedJob) {
		throw new ZenodoActivationValidationError(
			"Zenodo publication is already running. Wait for it to finish, then reload this record.",
		);
	}
	if (input.waitingOn) {
		await supersedeUnleasedPublicationJobs(transaction, {
			itemKey: input.itemKey,
			provider: "zenodo",
			environment: "sandbox",
			now: input.now,
		});
		return null;
	}
	if (leasedJob) return leasedJob;
	if (input.fileRevision === null) {
		throw new Error("A ready Zenodo job must have a published file");
	}
	const nextJob = {
		itemKey: input.itemKey,
		identifierPolicy: input.policy,
		canonicalRevision: input.canonicalRevision,
		fileRevision: input.fileRevision,
		now: input.now,
	};
	const expectedIdempotencyKey = publicationJobIdempotencyKey({
		...nextJob,
		provider: "zenodo",
		environment: "sandbox",
	});
	const matchingJob =
		activeJobs.find(
			(candidate) => candidate.idempotencyKey === expectedIdempotencyKey,
		) ?? null;
	if (matchingJob) return matchingJob;
	await supersedeUnleasedPublicationJobs(transaction, {
		itemKey: input.itemKey,
		provider: "zenodo",
		environment: "sandbox",
		now: input.now,
	});
	return savePublicationJob(transaction, {
		...nextJob,
		provider: "zenodo",
		environment: "sandbox",
		reason: "manual_activation",
	});
}

export async function activateZenodoPublication(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
	requestedPolicy?: ZenodoIdentifierPolicy,
	requestedBy = "admin-bypass",
	options: { resolveDoi?: DoiResolver } = {},
): Promise<ZenodoActivationReceipt> {
	const zenodo = requireZenodoConfig(config);
	const preflightSnapshot = await readPublicationRepositorySnapshot(
		database,
		itemKey,
		config.services.publication.crossref.environment,
	);
	const preflight = prepareZenodoActivation({
		snapshot: preflightSnapshot,
		config,
		zenodo,
		now: new Date(),
		requestedPolicy,
	});
	if (preflight.externalDoi) {
		await assertDoiResolves(preflight.externalDoi, options.resolveDoi);
	}
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const snapshot = await readPublicationRepositorySnapshot(
			transaction,
			itemKey,
			config.services.publication.crossref.environment,
		);
		const record = snapshot.record;
		if (!record) throw new PublicationItemNotFoundError(itemKey);
		const now = new Date();
		const prepared = prepareZenodoActivation({
			snapshot,
			config,
			zenodo,
			now,
			requestedPolicy,
		});
		const { externalDoi, fileRevision, policy, waitingOn } = prepared;
		if (externalDoi !== preflight.externalDoi) {
			throw new ZenodoActivationValidationError(
				"The record DOI changed while it was being checked. Reload the record and try again.",
				{ DOI: "Reload this record before activating Zenodo." },
			);
		}
		if (externalDoi) {
			const [collision] = await transaction
				.select({ itemKey: publicationIdentifier.itemKey })
				.from(publicationIdentifier)
				.where(
					and(
						eq(publicationIdentifier.doi, externalDoi),
						ne(publicationIdentifier.itemKey, itemKey),
					),
				)
				.limit(1);
			if (collision) {
				throw new ZenodoActivationValidationError(
					`The DOI ${externalDoi} already belongs to record ${collision.itemKey}.`,
					{ DOI: "Use the DOI on only one local record." },
				);
			}
		}
		assertZenodoPolicyMayChange(snapshot, policy);
		await saveZenodoActivationTarget(transaction, {
			lockedExternalDoi: externalDoi,
			itemKey,
			policy,
			requestedBy,
			now,
		});
		const job = await selectZenodoActivationJob(transaction, {
			itemKey,
			policy,
			canonicalRevision: record.revision,
			fileRevision,
			waitingOn,
			jobs: snapshot.jobs,
			now,
		});
		const providerRecordExists = snapshot.states.some(
			(state) =>
				state.provider === "zenodo" &&
				state.environment === "sandbox" &&
				Boolean(state.zenodoRecordId),
		);
		return receipt({
			itemKey,
			identifierPolicy: policy,
			canonicalRevision: record.revision,
			fileRevision,
			waitingOn,
			job,
			providerRecordExists,
		});
	});
}

export async function retryZenodoPublication(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
): Promise<ZenodoActivationReceipt> {
	const zenodo = requireZenodoConfig(config);
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const snapshot = await readPublicationRepositorySnapshot(
			transaction,
			itemKey,
			config.services.publication.crossref.environment,
		);
		if (!snapshot.record) throw new PublicationItemNotFoundError(itemKey);
		const target = snapshot.targets.find(
			(candidate) =>
				candidate.provider === "zenodo" &&
				candidate.environment === "sandbox" &&
				candidate.deactivatedAt === null,
		);
		if (!target?.identifierPolicy) {
			throw new Error("The saved Zenodo activation is incomplete");
		}
		const now = new Date();
		const prepared = prepareZenodoActivation({
			snapshot,
			config,
			zenodo,
			now,
			requestedPolicy: target.identifierPolicy,
		});
		if (
			target.identifierPolicy === "reuse-external" &&
			prepared.externalDoi !== target.lockedExternalDoi
		) {
			throw new ZenodoActivationValidationError(
				"The record DOI no longer matches the DOI selected for Zenodo.",
				{ DOI: "Deactivate Zenodo before changing this DOI." },
			);
		}
		if (prepared.waitingOn) {
			throw new ZenodoActivationValidationError(
				prepared.waitingOn === "file"
					? "Publish a PDF before retrying Zenodo."
					: "Wait for the Crossref DOI to become active before retrying Zenodo.",
			);
		}
		const [job] = await transaction
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, itemKey),
					eq(publicationSyncJob.provider, "zenodo"),
					eq(publicationSyncJob.environment, "sandbox"),
					isNull(publicationSyncJob.supersededAt),
				),
			)
			.orderBy(
				desc(publicationSyncJob.createdAt),
				desc(publicationSyncJob.id),
			)
			.limit(1)
			.for("update");
		if (!job?.deadLetteredAt) {
			throw new ZenodoActivationValidationError(
				"This Zenodo publication does not have a failed job to retry.",
			);
		}
		if (prepared.fileRevision === null) {
			throw new Error("A ready Zenodo retry must have a published file");
		}
		let retried: typeof publicationSyncJob.$inferSelect | undefined;
		if (
			job.canonicalRevision === prepared.record.revision &&
			job.fileRevision === prepared.fileRevision
		) {
			[retried] = await transaction
				.update(publicationSyncJob)
				.set({
					deadLetteredAt: null,
					lastError: null,
					leaseOwner: null,
					leaseExpiresAt: null,
					nextAttemptAt: now,
					reason: "manual_retry",
					updatedAt: now,
				})
				.where(eq(publicationSyncJob.id, job.id))
				.returning();
		} else {
			retried = await savePublicationJob(transaction, {
				itemKey,
				provider: "zenodo",
				environment: "sandbox",
				identifierPolicy: target.identifierPolicy,
				canonicalRevision: prepared.record.revision,
				fileRevision: prepared.fileRevision,
				reason: "manual_retry",
				now,
			});
		}
		if (!retried) throw new Error("The Zenodo retry could not be saved");
		const providerRecordExists = snapshot.states.some(
			(state) =>
				state.provider === "zenodo" &&
				state.environment === "sandbox" &&
				Boolean(state.zenodoRecordId),
		);
		return receipt({
			itemKey,
			identifierPolicy: target.identifierPolicy,
			canonicalRevision: retried.canonicalRevision,
			fileRevision: retried.fileRevision,
			waitingOn: null,
			job: retried,
			providerRecordExists,
		});
	});
}
