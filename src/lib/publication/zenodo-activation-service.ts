import { planPublicationSync } from "@opendeved/doi-sync-core";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationSyncJob,
	publicationSyncState,
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
import { publicationJobState } from "./queue";
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
	if (
		input.bibliographicDoi &&
		input.bibliographicDoi !== input.managedCrossref?.doi
	) {
		throw new ZenodoActivationValidationError(
			`This record already uses ${input.bibliographicDoi}. Zenodo cannot assign another DOI in this version.`,
			{ DOI: "Remove the external DOI before publishing this record to Zenodo." },
		);
	}
	const policy = input.requestedPolicy ?? input.configuredDefault;
	if (policy === "reuse-crossref" && !input.managedCrossref) {
		throw new ZenodoActivationValidationError(
			"Activate a Crossref DOI for this record before reusing it on Zenodo.",
			{ identifierPolicy: "Choose a Zenodo DOI or activate Crossref first." },
		);
	}
	return policy;
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
	const state = input.waitingOn === "crossref"
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
				journal.provider === "zenodo" && journal.environment === "sandbox",
		) ||
		snapshot.jobs.some(
			(job) =>
				job.provider === "zenodo" &&
				job.environment === "sandbox" &&
				Boolean(job.processedAt || job.leaseOwner),
		)
	);
}

function zenodoJobIdempotencyKey(input: {
	itemKey: string;
	identifierPolicy: ZenodoIdentifierPolicy;
	canonicalRevision: number;
	fileRevision: number;
}) {
	return [
		"publication",
		"zenodo",
		"sandbox",
		input.itemKey,
		input.identifierPolicy,
		input.canonicalRevision,
		input.fileRevision,
	].join(":");
}

async function supersedeActiveZenodoJobs(
	transaction: DatabaseTransaction,
	itemKey: string,
	now: Date,
) {
	await transaction
		.update(publicationSyncJob)
		.set({ supersededAt: now, updatedAt: now })
		.where(
			and(
				eq(publicationSyncJob.itemKey, itemKey),
				eq(publicationSyncJob.provider, "zenodo"),
				eq(publicationSyncJob.environment, "sandbox"),
				isNull(publicationSyncJob.processedAt),
				isNull(publicationSyncJob.deadLetteredAt),
				isNull(publicationSyncJob.supersededAt),
				isNull(publicationSyncJob.leaseOwner),
			),
		);
}

async function saveZenodoJob(
	transaction: DatabaseTransaction,
	input: {
		itemKey: string;
		identifierPolicy: ZenodoIdentifierPolicy;
		canonicalRevision: number;
		fileRevision: number;
		now: Date;
	},
) {
	const idempotencyKey = zenodoJobIdempotencyKey(input);
	const [inserted] = await transaction
		.insert(publicationSyncJob)
		.values({
			itemKey: input.itemKey,
			provider: "zenodo",
			environment: "sandbox",
			canonicalRevision: input.canonicalRevision,
			fileRevision: input.fileRevision,
			reason: "manual_activation",
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
	if (!existing) throw new Error("The Zenodo publication job could not be saved");
	if (existing.supersededAt && !existing.processedAt && !existing.deadLetteredAt) {
		const [restored] = await transaction
			.update(publicationSyncJob)
			.set({ supersededAt: null, nextAttemptAt: input.now, updatedAt: input.now })
			.where(eq(publicationSyncJob.id, existing.id))
			.returning();
		if (!restored) throw new Error("The Zenodo publication job could not be restored");
		return restored;
	}
	return existing;
}

function prepareZenodoActivation(input: {
	snapshot: PublicationRepositorySnapshot;
	config: PublicationConfig;
	zenodo: ReturnType<typeof requireZenodoConfig>;
	requestedPolicy?: ZenodoIdentifierPolicy;
}) {
	const { snapshot } = input;
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
	const bibliographicResolution = resolveBibliographicDoi({
		DOI: record.DOI,
		extra: record.extra,
		attachments: snapshot.attachments,
	});
	if (bibliographicResolution.status === "conflict") {
		throw new ZenodoActivationValidationError(
			"This record contains different DOI values. Make them match first.",
			{
				DOI: bibliographicResolution.conflicts
					.map(({ source, doi }) => `${source}: ${doi}`)
					.join("; "),
			},
		);
	}
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
		fileRevision,
		managedCrossref,
		policy,
		record,
		waitingOn,
	};
}

export async function activateZenodoPublication(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
	requestedPolicy?: ZenodoIdentifierPolicy,
	requestedBy = "admin-bypass",
): Promise<ZenodoActivationReceipt> {
	const zenodo = requireZenodoConfig(config);
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const snapshot = await readPublicationRepositorySnapshot(
			transaction,
			itemKey,
			config.services.publication.crossref.environment,
		);
		const record = snapshot.record;
		if (!record) throw new PublicationItemNotFoundError(itemKey);
		const prepared = prepareZenodoActivation({
			snapshot,
			config,
			zenodo,
			requestedPolicy,
		});
		const { fileRevision, policy, waitingOn } = prepared;

		const existingTarget = snapshot.targets.find(
			(target) =>
				target.provider === "zenodo" &&
				target.environment === "sandbox",
		);
		if (
			existingTarget?.identifierPolicy &&
			existingTarget.identifierPolicy !== policy &&
			zenodoHasStarted(snapshot)
		) {
			throw new ZenodoIdentifierPolicyLockedError();
		}

		const now = new Date();
		await transaction
			.insert(publicationTarget)
			.values({
				itemKey,
				provider: "zenodo",
				environment: "sandbox",
				identifierPolicy: policy,
				requestedBy,
				requestedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					publicationTarget.itemKey,
					publicationTarget.provider,
					publicationTarget.environment,
				],
				set: {
					identifierPolicy: policy,
					requestedBy,
					deactivatedAt: null,
					updatedAt: now,
				},
			});
		await transaction
			.update(publicationSyncState)
			.set({ identifierPolicy: policy, updatedAt: now })
			.where(
				and(
					eq(publicationSyncState.itemKey, itemKey),
					eq(publicationSyncState.provider, "zenodo"),
					eq(publicationSyncState.environment, "sandbox"),
				),
			);

		const activeJobs = activeZenodoJobs(snapshot.jobs);
		const leasedJob = activeJobs.find((job) => job.leaseOwner !== null) ?? null;
		if (waitingOn && leasedJob) {
			throw new ZenodoActivationValidationError(
				"Zenodo publication is already running. Wait for it to finish, then reload this record.",
			);
		}

		let job: typeof publicationSyncJob.$inferSelect | null = null;
		if (waitingOn) {
			await supersedeActiveZenodoJobs(transaction, itemKey, now);
		} else if (leasedJob) {
			job = leasedJob;
		} else {
			if (fileRevision === null) {
				throw new Error("A ready Zenodo job must have a published file");
			}
			const nextJob = {
				itemKey,
				identifierPolicy: policy,
				canonicalRevision: record.revision,
				fileRevision,
				now,
			};
			const expectedIdempotencyKey = zenodoJobIdempotencyKey(nextJob);
			job =
				activeJobs.find(
					(candidate) => candidate.idempotencyKey === expectedIdempotencyKey,
				) ?? null;
			if (!job) {
				await supersedeActiveZenodoJobs(transaction, itemKey, now);
				job = await saveZenodoJob(transaction, nextJob);
			}
		}
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
		const prepared = prepareZenodoActivation({
			snapshot,
			config,
			zenodo,
			requestedPolicy: target.identifierPolicy,
		});
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
			.orderBy(desc(publicationSyncJob.createdAt), desc(publicationSyncJob.id))
			.limit(1)
			.for("update");
		if (!job?.deadLetteredAt) {
			throw new ZenodoActivationValidationError(
				"This Zenodo publication does not have a failed job to retry.",
			);
		}
		const now = new Date();
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
			retried = await saveZenodoJob(transaction, {
				itemKey,
				identifierPolicy: target.identifierPolicy,
				canonicalRevision: prepared.record.revision,
				fileRevision: prepared.fileRevision,
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
