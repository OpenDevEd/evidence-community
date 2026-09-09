import { itemIdentity } from "@opendeved/evidence-library-core";
import { itemPublishingChoice } from "@/db/schema/review";
import { loadWorkingItemPayload } from "@/lib/admin/native-item-service";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	publicationIdentifier,
	publicationSyncJob,
	publicationTarget,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";
import { advanceOpenItemDraftBaseRevision } from "@/lib/admin/native-item-service";
import { markItemWritebackDirty } from "@/lib/source-writeback/queue";

import {
	resolveBibliographicDoi,
	type BibliographicDoiInput,
} from "./bibliographic-doi";
import { allocateManagedCrossrefDoi } from "./namespace-repository";
import {
	enqueueItemSearchReprojection,
	publicationJobState,
	savePublicationJob,
	supersedeUnleasedPublicationJobs,
} from "./queue";
import { readPublicationRepositorySnapshot } from "./repository";
import {
	CrossrefActivationConfigurationError,
	CrossrefActivationValidationError,
	CrossrefDoiAlreadyManagedError,
	CrossrefDoiConflictError,
	ExternalCrossrefDoiError,
	PublicationItemNotFoundError,
} from "./errors";

export {
	CrossrefActivationConfigurationError,
	CrossrefActivationValidationError,
	CrossrefDoiAlreadyManagedError,
	CrossrefDoiConflictError,
	ExternalCrossrefDoiError,
	PublicationItemNotFoundError,
} from "./errors";

async function readCurrentCrossrefIdentifier(transaction: DatabaseTransaction, itemKey: string) {
	const [identifier] = await transaction.select().from(publicationIdentifier).where(and(
		eq(publicationIdentifier.itemKey, itemKey),
		eq(publicationIdentifier.registrar, "crossref"),
		eq(publicationIdentifier.environment, "test"),
		eq(publicationIdentifier.role, "primary"),
		eq(publicationIdentifier.isCurrent, true),
	)).limit(1);
	return identifier;
}

type PublicationConfig = Pick<
	LibraryServerConfig,
	"identity" | "services" | "sources"
>;

export type CrossrefActivationReceipt = {
	itemKey: string;
	provider: "crossref";
	environment: "test";
	doi: string;
	lifecycle: "reserved" | "verified";
	canonicalRevision: number;
	job: {
		id: number;
		state: "queued" | "working" | "retrying" | "failed" | "finished";
	};
	indexing: {
		entityType: "item";
		entityKey: string;
		revision: number;
	};
};

export function classifyCrossrefActivationDoi(
	input: BibliographicDoiInput,
	managedDoi: string | null = null,
):
	| { kind: "allocate" }
	| { kind: "reuse"; doi: string; sources: readonly string[] } {
	const resolution = resolveBibliographicDoi(input);
	if (resolution.status === "conflict") {
		throw new CrossrefDoiConflictError(resolution.conflicts);
	}
	if (resolution.status === "none") return { kind: "allocate" };
	if (managedDoi === resolution.doi) {
		return {
			kind: "reuse",
			doi: resolution.doi,
			sources: resolution.sources,
		};
	}
	throw new ExternalCrossrefDoiError(resolution.doi);
}

function requireCrossrefConfig(config: PublicationConfig) {
	const crossref = config.services.publication.crossref;
	if (!crossref.enabled) {
		throw new CrossrefActivationConfigurationError(
			"Crossref test publishing is not configured for this library.",
		);
	}
	if (
		!crossref.loginId ||
		!crossref.depositorName ||
		!crossref.email ||
		!crossref.password ||
		!crossref.registrant ||
		!crossref.prefix ||
		!crossref.suffixNamespace
	) {
		throw new CrossrefActivationConfigurationError(
			"Crossref test publishing is missing required account settings.",
		);
	}
	return {
		...crossref,
		loginId: crossref.loginId,
		depositorName: crossref.depositorName,
		email: crossref.email,
		password: crossref.password,
		registrant: crossref.registrant,
		prefix: crossref.prefix,
		suffixNamespace: crossref.suffixNamespace,
	};
}

function receipt(input: {
	itemKey: string;
	doi: string;
	lifecycle: "reserved" | "verified";
	canonicalRevision: number;
	job: typeof publicationSyncJob.$inferSelect;
}): CrossrefActivationReceipt {
	return {
		itemKey: input.itemKey,
		provider: "crossref",
		environment: "test",
		doi: input.doi,
		lifecycle: input.lifecycle,
		canonicalRevision: input.canonicalRevision,
		job: { id: input.job.id, state: publicationJobState(input.job) },
		indexing: {
			entityType: "item",
			entityKey: input.itemKey,
			revision: input.canonicalRevision,
		},
	};
}

export async function activateCrossrefPublication(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
	requestedBy = "admin-bypass",
): Promise<CrossrefActivationReceipt> {
	return database.transaction((transaction) =>
		activateCrossrefPublicationInTransaction(
			transaction,
			itemKey,
			config,
			requestedBy,
		),
	);
}

/** Saves activation and its job alongside the approved public records. No provider calls. */
export async function activateCrossrefPublicationInTransaction(
	transaction: DatabaseTransaction,
	itemKey: string,
	config: PublicationConfig,
	requestedBy: string,
): Promise<CrossrefActivationReceipt> {
	const crossref = requireCrossrefConfig(config);
	await lockItemMutation(transaction, itemKey);
	const snapshot = await readPublicationRepositorySnapshot(
		transaction,
		itemKey,
		"test",
	);
	const record = snapshot.record;
	if (!record) throw new PublicationItemNotFoundError(itemKey);
	const managedIdentifier = snapshot.identifiers.find(
		(candidate) =>
			candidate.registrar === "crossref" &&
			candidate.environment === "test" &&
			candidate.role === "primary" &&
			candidate.ownership === "managed",
	);

	const existingTarget = snapshot.targets.find(
		(target) =>
			target.provider === "crossref" &&
			target.environment === "test" &&
			target.deactivatedAt === null &&
			target.activatedAt !== null,
	);
	if (existingTarget) {
		const job = snapshot.jobs.find(
			(candidate) =>
				candidate.provider === "crossref" &&
				candidate.environment === "test" &&
				candidate.supersededAt === null,
		);
		if (!managedIdentifier || !job) {
			throw new Error("The saved Crossref activation is incomplete");
		}
		return receipt({
			itemKey,
			doi: managedIdentifier.doi,
			lifecycle: managedIdentifier.lifecycle,
			canonicalRevision: job.canonicalRevision,
			job,
		});
	}

	if (record.deleted === 1) {
		throw new CrossrefActivationValidationError(
			"Restore this record before publishing it.",
		);
	}
	if (record.parentItem) {
		throw new CrossrefActivationValidationError(
			"Only parent records can receive a Crossref DOI.",
		);
	}

	const classification = classifyCrossrefActivationDoi(
		{
			DOI: record.DOI,
			extra: record.extra,
			attachments: snapshot.attachments,
		},
		managedIdentifier?.doi ?? null,
	);
	const doi =
		managedIdentifier?.doi ??
		(classification.kind === "reuse"
			? classification.doi
			: await allocateManagedCrossrefDoi(transaction, {
					environment: "test",
					prefix: crossref.prefix,
					suffixNamespace: crossref.suffixNamespace,
				}));
	await transaction.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended('publication:crossref-doi:' || ${doi}, 0))`,
	);
	const [existingIdentifier] = await transaction
		.select({ itemKey: publicationIdentifier.itemKey })
		.from(publicationIdentifier)
		.where(
			and(
				eq(publicationIdentifier.registrar, "crossref"),
				eq(publicationIdentifier.environment, "test"),
				eq(publicationIdentifier.doi, doi),
			),
		)
		.limit(1);
	if (existingIdentifier && existingIdentifier.itemKey !== itemKey) {
		throw new CrossrefDoiAlreadyManagedError(
			doi,
			existingIdentifier.itemKey,
		);
	}

	const now = new Date();
	const doiChanged = record.DOI !== doi;
	const nextRevision = record.revision + (doiChanged ? 1 : 0);
	await transaction
		.insert(publicationTarget)
		.values({
			itemKey,
			provider: "crossref",
			environment: "test",
			identifierPolicy: null,
			requestedBy,
			requestedAt: now,
			updatedAt: now,
			activatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
			set: {
				activatedAt: now,
				deactivatedAt: null,
				requestedBy,
				updatedAt: now,
			},
		});
	const identifier =
		managedIdentifier ??
		(
			await transaction
				.insert(publicationIdentifier)
				.values({
					itemKey,
					registrar: "crossref",
					environment: "test",
					role: "primary",
					doi,
					ownership: "managed",
					lifecycle: "reserved",
					reservedAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
		)[0];
	if (doiChanged) {
		await transaction
			.update(item)
			.set({
				DOI: doi,
				revision: nextRevision,
				dateModified: now,
				updatedAt: now,
			})
			.where(eq(item.key, itemKey));
		await advanceOpenItemDraftBaseRevision(
			transaction,
			itemKey,
			record.revision,
			nextRevision,
		);
		await markItemWritebackDirty(transaction, {
			canonicalRevision: nextRevision,
			dirtyFields: ["DOI"],
			itemKey,
			updatedAt: now,
		});
	}
	await enqueueItemSearchReprojection(transaction, {
		itemKey,
		revision: nextRevision,
		queuedAt: now,
	});
	await supersedeUnleasedPublicationJobs(transaction, {
		itemKey,
		provider: "crossref",
		environment: "test",
		now,
	});
	const job = await savePublicationJob(transaction, {
		itemKey,
		provider: "crossref",
		environment: "test",
		identifierPolicy: null,
		canonicalRevision: nextRevision,
		fileRevision: null,
		reason: "manual_activation",
		now,
	});
	if (!identifier || !job) {
		throw new Error("Crossref activation could not be saved");
	}

	return receipt({
		itemKey,
		doi: identifier.doi,
		lifecycle: identifier.lifecycle,
		canonicalRevision: nextRevision,
		job,
	});
}

export async function retryCrossrefPublication(
	database: Database,
	itemKey: string,
): Promise<CrossrefActivationReceipt> {
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [job] = await transaction
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, itemKey),
					eq(publicationSyncJob.provider, "crossref"),
					eq(publicationSyncJob.environment, "test"),
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
			throw new CrossrefActivationValidationError(
				"This Crossref publication does not have a failed job to retry.",
			);
		}
		const now = new Date();
		const [retried] = await transaction
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
		const identifier = await readCurrentCrossrefIdentifier(transaction, itemKey);
		if (!retried || !identifier) {
			throw new Error("The Crossref retry could not be saved");
		}
		return receipt({
			itemKey,
			doi: identifier.doi,
			lifecycle: identifier.lifecycle,
			canonicalRevision: retried.canonicalRevision,
			job: retried,
		});
	});
}

/** Allocate an identifier without publishing metadata or enabling provider jobs. */
export async function reserveCrossrefDoi(
	database: Database,
	itemKey: string,
	config: PublicationConfig,
	requestedBy: string,
) {
	const crossref = requireCrossrefConfig(config);
	return database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [identity] = await transaction
			.select()
			.from(itemIdentity)
			.where(eq(itemIdentity.key, itemKey));
		if (!identity) throw new PublicationItemNotFoundError(itemKey);
		if (identity.kind !== "created")
			throw new CrossrefActivationValidationError(
				"Only created items can reserve a DOI.",
			);
		const [choice] = await transaction
			.select()
			.from(itemPublishingChoice)
			.where(eq(itemPublishingChoice.itemKey, itemKey));
		if (choice?.choice.route !== "crossref-zenodo")
			throw new CrossrefActivationValidationError(
				"Choose Crossref + Zenodo before reserving a DOI.",
			);
		const payload = await loadWorkingItemPayload(transaction, itemKey);
		if (!payload.itemType || payload.parentItem)
			throw new CrossrefActivationValidationError(
				"Reserve a DOI on the parent item.",
			);
		const existing = await readCurrentCrossrefIdentifier(transaction, itemKey);
		if (existing)
			return { doi: existing.doi, lifecycle: existing.lifecycle };
		classifyCrossrefActivationDoi({
			DOI: typeof payload.DOI === "string" ? payload.DOI : null,
			extra: typeof payload.extra === "string" ? payload.extra : null,
		});
		const doi = await allocateManagedCrossrefDoi(transaction, {
			environment: "test",
			prefix: crossref.prefix,
			suffixNamespace: crossref.suffixNamespace,
		});
		await transaction
			.insert(publicationTarget)
			.values({
				itemKey,
				provider: "crossref",
				environment: "test",
				requestedBy,
				activatedAt: null,
			});
		await transaction
			.insert(publicationIdentifier)
			.values({
				itemKey,
				registrar: "crossref",
				environment: "test",
				role: "primary",
				doi,
				ownership: "managed",
				lifecycle: "reserved",
			});
		return { doi, lifecycle: "reserved" as const };
	});
}
