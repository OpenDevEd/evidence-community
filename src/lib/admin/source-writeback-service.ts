import {
	itemIdentity,
	itemSourceLink,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { lockItemMutation } from "@/db/canonical-mutation-lock";
import { item } from "@/db/schema/tables/item";
import {
	findWritebackTarget,
	resolveItemWritebackTargets,
	type SourceWritebackConfiguration,
	type SourceWritebackReason,
} from "@/lib/source-writeback/policy";
import {
	cascadeChildWritebackLinks,
	enqueueFullWritebackForSources,
	ensureItemWritebackLinks,
} from "@/lib/source-writeback/queue";
import type {
	SourceWritebackAdapterRegistry,
} from "@/lib/source-writeback/adapter";
import type { SourceCredentialResolver } from "@/lib/source-ingestion/credentials";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";

import { ItemNotFoundError } from "./native-item-service";

import type { AdminSourceWritebackStatus } from "./source-writeback-contract";

type WritebackJobRow = Pick<
	typeof sourceWritebackJob.$inferSelect,
	| "attempts"
	| "canonicalRevision"
	| "createdAt"
	| "deadLetteredAt"
	| "id"
	| "lastError"
	| "leaseExpiresAt"
	| "leaseOwner"
	| "nextAttemptAt"
	| "processedAt"
>;

type WritebackLinkRow = Pick<
	typeof itemSourceLink.$inferSelect,
	"conflictRemoteVersion" | "dirtyFields" | "lastAcknowledgedRemoteVersion"
>;

export type AdminSourceWritebackAction = "load-remote" | "retry" | "send-local";

/** The actions an admin may take in a given writeback state. */
export function adminSourceWritebackActions(
	state: AdminSourceWritebackStatus["state"],
): AdminSourceWritebackAction[] {
	if (state === "conflict") return ["send-local", "load-remote"];
	if (state === "failed") return ["retry"];
	return [];
}

export class AdminSourceWritebackRetryError extends Error {
	constructor(
		message: string,
		readonly kind: "not-failed" | "unavailable",
	) {
		super(message);
		this.name = "AdminSourceWritebackRetryError";
	}
}

function policyState(
	reason: SourceWritebackReason,
): AdminSourceWritebackStatus["state"] | null {
	if (reason === "source-disabled") return "disabled";
	if (reason === "source-paused") return "paused";
	if (reason === "source-removed") return "removed";
	if (reason === "unsupported-provider") return "unsupported";
	if (reason === "item-locked" || reason === "not-linked") return "locked";
	return null;
}

export function resolveAdminSourceWritebackState(
	job: WritebackJobRow | null,
	link: WritebackLinkRow | null,
	now = new Date(),
): AdminSourceWritebackStatus["state"] {
	if (link?.conflictRemoteVersion) return "conflict";
	if (job?.deadLetteredAt) return "failed";
	if (
		job?.leaseOwner &&
		job.leaseExpiresAt &&
		job.leaseExpiresAt.getTime() > now.getTime()
	) {
		return "sending";
	}
	if (job && !job.processedAt) {
		return job.attempts > 0 || job.lastError ? "retrying" : "queued";
	}
	if (
		link?.dirtyFields.length === 0 &&
		link.lastAcknowledgedRemoteVersion !== null
	) {
		return "synced";
	}
	return "idle";
}

const KEY_COLLISION_ERROR_NAMES = [
	"SourceWritebackTargetKeyCollisionError",
	"ZoteroWritebackKeyCollisionError",
];

/**
 * Turns a stored worker error into words an admin can act on. A key collision
 * means the source already has a different item with this record's key; the
 * only way forward is to delete that item at the source and retry.
 */
export function describeAdminWritebackError(
	error: string | null,
	{ itemKey, sourceLabel }: { itemKey: string; sourceLabel: string },
) {
	if (!error) return null;
	const name = error.split(":", 1)[0] ?? "";
	if (KEY_COLLISION_ERROR_NAMES.includes(name)) {
		return `${sourceLabel} already has a different item with key ${itemKey}. Delete that item in ${sourceLabel}, then retry.`;
	}
	return error;
}

function statusJson(
	state: AdminSourceWritebackStatus["state"],
	sourceKey: string | null,
	job: WritebackJobRow | null,
	describe: (error: string | null) => string | null = (error) => error,
): AdminSourceWritebackStatus {
	return {
		attempts: job?.attempts ?? 0,
		canonicalRevision: job?.canonicalRevision ?? null,
		error: describe(job?.lastError ?? null),
		jobId: job?.id ?? null,
		nextAttemptAt: job?.nextAttemptAt.toISOString() ?? null,
		processedAt: job?.processedAt?.toISOString() ?? null,
		sourceKey,
		state,
	};
}

export async function getAdminSourceWritebackStatus(
	database: Database,
	itemKey: string,
	sourceKey: string,
	config: SourceWritebackConfiguration,
	now = new Date(),
) {
	const targets = await resolveItemWritebackTargets(database, itemKey, config);
	const target = findWritebackTarget(targets, sourceKey);
	if (!target) return statusJson("locked", sourceKey, null);
	const blockedState = policyState(target.reason);

	const [links, jobs] = await Promise.all([
		database
			.select({
				conflictRemoteVersion: itemSourceLink.conflictRemoteVersion,
				dirtyFields: itemSourceLink.dirtyFields,
				lastAcknowledgedRemoteVersion:
					itemSourceLink.lastAcknowledgedRemoteVersion,
			})
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, sourceKey),
				),
			)
			.limit(1),
		database
			.select({
				attempts: sourceWritebackJob.attempts,
				canonicalRevision: sourceWritebackJob.canonicalRevision,
				createdAt: sourceWritebackJob.createdAt,
				deadLetteredAt: sourceWritebackJob.deadLetteredAt,
				id: sourceWritebackJob.id,
				lastError: sourceWritebackJob.lastError,
				leaseExpiresAt: sourceWritebackJob.leaseExpiresAt,
				leaseOwner: sourceWritebackJob.leaseOwner,
				nextAttemptAt: sourceWritebackJob.nextAttemptAt,
				processedAt: sourceWritebackJob.processedAt,
			})
			.from(sourceWritebackJob)
			.where(
				and(
					eq(sourceWritebackJob.itemKey, itemKey),
					eq(sourceWritebackJob.sourceConnectionKey, sourceKey),
					eq(sourceWritebackJob.superseded, false),
				),
			)
			.orderBy(desc(sourceWritebackJob.id))
			.limit(1),
	]);
	const job = jobs[0] ?? null;
	const link = links[0] ?? null;
	return statusJson(
		blockedState ?? resolveAdminSourceWritebackState(job, link, now),
		sourceKey,
		job,
		(error) =>
			describeAdminWritebackError(error, {
				itemKey,
				sourceLabel: target.sourceLabel,
			}),
	);
}

export async function retryAdminSourceWriteback(
	database: Database,
	itemKey: string,
	sourceKey: string,
	config: SourceWritebackConfiguration,
	requeuedAt = new Date(),
) {
	const current = await getAdminSourceWritebackStatus(
		database,
		itemKey,
		sourceKey,
		config,
		requeuedAt,
	);
	if (["disabled", "locked", "paused", "removed", "unsupported"].includes(current.state)) {
		throw new AdminSourceWritebackRetryError(
			"Writeback is not available for this record right now.",
			"unavailable",
		);
	}
	if (current.state !== "failed" || current.jobId === null) {
		throw new AdminSourceWritebackRetryError(
			"This writeback job has not failed and does not need a manual retry.",
			"not-failed",
		);
	}

	const [requeued] = await database
		.update(sourceWritebackJob)
		.set({
			attempts: 0,
			deadLetteredAt: null,
			lastError: null,
			leaseExpiresAt: null,
			leaseOwner: null,
			nextAttemptAt: requeuedAt,
		})
		.where(
			and(
				eq(sourceWritebackJob.id, current.jobId),
				eq(sourceWritebackJob.itemKey, itemKey),
				isNotNull(sourceWritebackJob.deadLetteredAt),
			),
		)
		.returning({ id: sourceWritebackJob.id });
	if (!requeued) {
		throw new AdminSourceWritebackRetryError(
			"The failed writeback job changed before it could be retried. Refresh and try again.",
			"not-failed",
		);
	}
	return getAdminSourceWritebackStatus(
		database,
		itemKey,
		sourceKey,
		config,
		requeuedAt,
	);
}

export class ItemWritebackSourcesChildError extends Error {
	constructor(itemKey: string) {
		super(
			`Attachments and notes follow their parent record: ${itemKey}`,
		);
		this.name = "ItemWritebackSourcesChildError";
	}
}

/**
 * Changes which sources a record writes to, without publishing. Children
 * follow. A published record is sent to every newly chosen source at once;
 * a draft waits for its first publish. Unchecked sources keep their link and
 * remote copy; their pending jobs are superseded by the worker.
 */
export async function setAdminItemWritebackSources(
	database: Database,
	itemKey: string,
	sourceKeys: readonly string[],
	config: SourceWritebackConfiguration,
	now = new Date(),
) {
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [identity] = await transaction
			.select({ key: itemIdentity.key })
			.from(itemIdentity)
			.where(eq(itemIdentity.key, itemKey))
			.limit(1);
		if (!identity) throw new ItemNotFoundError(itemKey);
		const [published] = await transaction
			.select({ parentItem: item.parentItem })
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1);
		if (published?.parentItem) {
			throw new ItemWritebackSourcesChildError(itemKey);
		}
		const selection = await ensureItemWritebackLinks(transaction, {
			configuration: config,
			itemKey,
			sourceKeys,
		});
		const children = await cascadeChildWritebackLinks(transaction, itemKey);
		await enqueueFullWritebackForSources(transaction, {
			itemKey,
			sourceKeys: selection.newlyEnabled,
			updatedAt: now,
		});
		for (const child of children) {
			await enqueueFullWritebackForSources(transaction, {
				itemKey: child.itemKey,
				sourceKeys: child.newlyEnabled,
				updatedAt: now,
			});
		}
	});
	return resolveItemWritebackTargets(database, itemKey, config);
}

export type AdminWritebackConflictChoice = "load-remote" | "send-local";

export class AdminSourceWritebackConflictError extends Error {
	constructor(
		message: string,
		readonly kind: "not-in-conflict" | "remote-missing",
	) {
		super(message);
		this.name = "AdminSourceWritebackConflictError";
	}
}

/**
 * Resolves a conflict the worker found when a paused source was turned back
 * on. `send-local` accepts the source's current version as seen and sends
 * this record over it. `load-remote` imports the source's copy over this
 * record, including fields edited here, and marks the link synced.
 */
export async function resolveAdminSourceWritebackConflict(
	database: Database,
	itemKey: string,
	sourceKey: string,
	choice: AdminWritebackConflictChoice,
	config: SourceWritebackConfiguration,
	runtime: {
		credentialResolver: SourceCredentialResolver;
		registry: SourceWritebackAdapterRegistry;
		signal?: AbortSignal;
	},
	now = new Date(),
) {
	const [current] = await database
		.select({ connection: sourceConnection, link: itemSourceLink })
		.from(itemSourceLink)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, itemSourceLink.sourceConnectionKey),
		)
		.where(
			and(
				eq(itemSourceLink.itemKey, itemKey),
				eq(itemSourceLink.sourceConnectionKey, sourceKey),
			),
		)
		.limit(1);
	if (!current?.link.conflictRemoteVersion) {
		throw new AdminSourceWritebackConflictError(
			"This record has no source conflict to resolve. Refresh and try again.",
			"not-in-conflict",
		);
	}

	if (choice === "send-local") {
		await database.transaction(async (transaction) => {
			await lockItemMutation(transaction, itemKey);
			const [link] = await transaction
				.select({ conflictRemoteVersion: itemSourceLink.conflictRemoteVersion })
				.from(itemSourceLink)
				.where(
					and(
						eq(itemSourceLink.itemKey, itemKey),
						eq(itemSourceLink.sourceConnectionKey, sourceKey),
					),
				)
				.for("update");
			if (!link?.conflictRemoteVersion) {
				throw new AdminSourceWritebackConflictError(
					"This record has no source conflict to resolve. Refresh and try again.",
					"not-in-conflict",
				);
			}
			await transaction
				.update(itemSourceLink)
				.set({
					conflictRemoteVersion: null,
					lastAcknowledgedRemoteVersion: link.conflictRemoteVersion,
					remoteCheckRequired: false,
					remoteVersion: link.conflictRemoteVersion,
					updatedAt: now,
				})
				.where(
					and(
						eq(itemSourceLink.itemKey, itemKey),
						eq(itemSourceLink.sourceConnectionKey, sourceKey),
					),
				);
			await enqueueFullWritebackForSources(transaction, {
				itemKey,
				sourceKeys: [sourceKey],
				updatedAt: now,
			});
		});
		return getAdminSourceWritebackStatus(database, itemKey, sourceKey, config, now);
	}

	const adapter = runtime.registry.get(current.connection.provider);
	const remote = await adapter.readRecord(
		{
			entity: "item",
			sourceConnection: current.connection,
			sourceRecordKey: current.link.sourceRecordKey,
		},
		{
			credentialResolver: runtime.credentialResolver,
			signal: runtime.signal ?? new AbortController().signal,
		},
	);
	if (!remote) {
		throw new AdminSourceWritebackConflictError(
			"The source no longer has this record. Choose “Send this record” to create it again.",
			"remote-missing",
		);
	}
	// The source wins: forget local edits on this link so the import is not
	// masked, then import the source's copy through the normal writer.
	await database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		await transaction
			.update(itemSourceLink)
			.set({
				conflictRemoteVersion: null,
				dirtyFields: [],
				remoteCheckRequired: false,
				updatedAt: now,
			})
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, sourceKey),
				),
			);
	});
	await writeSourceIngestionBatch(database, {
		collections: [],
		expectedCursor: current.connection.syncCursor,
		fetchedAt: now,
		items: [remote.record],
		mappingProfileVersion: remote.mappingProfileVersion,
		nextCursor: current.connection.syncCursor,
		sourceConnectionKey: sourceKey,
	});
	return getAdminSourceWritebackStatus(database, itemKey, sourceKey, config, now);
}
