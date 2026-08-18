import {
	itemIdentity,
	itemSourceLink,
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
	"dirtyFields" | "lastAcknowledgedRemoteVersion"
>;

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

function statusJson(
	state: AdminSourceWritebackStatus["state"],
	sourceKey: string | null,
	job: WritebackJobRow | null,
): AdminSourceWritebackStatus {
	return {
		attempts: job?.attempts ?? 0,
		canonicalRevision: job?.canonicalRevision ?? null,
		error: job?.lastError ?? null,
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
