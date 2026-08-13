import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { tryLockItemMutation } from "@/db/canonical-mutation-lock";
import type { Database } from "@/db/database-schema";
import {
	publicationSyncRun,
	publicationTarget,
	type PublicationEnvironment,
	type PublicationProvider,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";

import { buildAdminPublicationViewFromSnapshot } from "./admin-publication-view";
import { enqueuePublicationJobsForItem } from "./queue";
import { readPublicationRepositorySnapshot } from "./repository";

type PublicationConfig = Pick<LibraryServerConfig, "identity" | "services">;

type ReconciliationCursor = {
	itemKey: string;
	provider: PublicationProvider;
	environment: PublicationEnvironment;
};

type ReconciliationTarget = ReconciliationCursor;

export type PublicationReconciliationResult =
	| { status: "busy" }
	| {
			status: "succeeded";
			runId: string;
			pages: number;
			scannedTargets: number;
			enqueuedJobs: number;
			skippedTargets: number;
	  };

export class PublicationReconciliationLeaseLostError extends Error {
	constructor() {
		super("The nightly publication scan lease was lost");
		this.name = "PublicationReconciliationLeaseLostError";
	}
}

function validateOptions(input: { pageSize: number; leaseSeconds: number }) {
	if (
		!Number.isSafeInteger(input.pageSize) ||
		input.pageSize < 1 ||
		input.pageSize > 1_000
	) {
		throw new Error("pageSize must be an integer between 1 and 1,000");
	}
	if (
		!Number.isSafeInteger(input.leaseSeconds) ||
		input.leaseSeconds < 30 ||
		input.leaseSeconds > 3_600
	) {
		throw new Error("leaseSeconds must be an integer between 30 and 3,600");
	}
}

function leaseExpiry(now: Date, leaseSeconds: number) {
	return new Date(now.getTime() + leaseSeconds * 1_000);
}

function errorMessage(error: unknown) {
	return (
		error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error)
	).slice(0, 32 * 1_024);
}

async function startRun(
	database: Database,
	input: {
		workerId: string;
		startedAt: Date;
		leaseSeconds: number;
	},
) {
	return database.transaction(async (transaction) => {
		const lock = await transaction.execute<{ locked: boolean }>(sql`
			SELECT pg_try_advisory_xact_lock(
				hashtextextended('publication:nightly-reconciliation', 0)
			) AS locked
		`);
		if (lock.rows[0]?.locked !== true) return null;

		await transaction
			.update(publicationSyncRun)
			.set({
				status: "failed",
				leaseOwner: null,
				leaseExpiresAt: null,
				heartbeatAt: input.startedAt,
				completedAt: input.startedAt,
				failure:
					"PublicationReconciliationLeaseLostError: worker lease expired",
			})
			.where(
				and(
					eq(publicationSyncRun.trigger, "nightly"),
					eq(publicationSyncRun.status, "running"),
					lte(publicationSyncRun.leaseExpiresAt, input.startedAt),
				),
			);
		const [active] = await transaction
			.select({ id: publicationSyncRun.id })
			.from(publicationSyncRun)
			.where(
				and(
					eq(publicationSyncRun.trigger, "nightly"),
					eq(publicationSyncRun.status, "running"),
					gt(publicationSyncRun.leaseExpiresAt, input.startedAt),
				),
			)
			.limit(1);
		if (active) return null;

		const runId = `nightly:${randomUUID()}`;
		await transaction.insert(publicationSyncRun).values({
			id: runId,
			trigger: "nightly",
			status: "running",
			leaseOwner: input.workerId,
			leaseExpiresAt: leaseExpiry(input.startedAt, input.leaseSeconds),
			heartbeatAt: input.startedAt,
			startedAt: input.startedAt,
		});
		return runId;
	});
}

async function heartbeatRun(
	database: Database,
	input: {
		runId: string;
		workerId: string;
		heartbeatAt: Date;
		leaseSeconds: number;
	},
) {
	const [run] = await database
		.update(publicationSyncRun)
		.set({
			heartbeatAt: input.heartbeatAt,
			leaseExpiresAt: leaseExpiry(input.heartbeatAt, input.leaseSeconds),
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.workerId),
				gt(publicationSyncRun.leaseExpiresAt, input.heartbeatAt),
			),
		)
		.returning({ id: publicationSyncRun.id });
	if (!run) throw new PublicationReconciliationLeaseLostError();
}

async function loadTargetPage(
	database: Database,
	input: { cursor: ReconciliationCursor | null; pageSize: number },
) {
	const cursorCondition = input.cursor
		? sql`(
			${publicationTarget.itemKey},
			${publicationTarget.provider},
			${publicationTarget.environment}
		) > (
			${input.cursor.itemKey},
			${input.cursor.provider},
			${input.cursor.environment}
		)`
		: undefined;
	return database
		.select({
			itemKey: publicationTarget.itemKey,
			provider: publicationTarget.provider,
			environment: publicationTarget.environment,
		})
		.from(publicationTarget)
		.innerJoin(item, eq(item.key, publicationTarget.itemKey))
		.where(
			and(
				isNull(publicationTarget.deactivatedAt),
				eq(item.deleted, 0),
				isNull(item.parentItem),
				cursorCondition,
			),
		)
		.orderBy(
			asc(publicationTarget.itemKey),
			asc(publicationTarget.provider),
			asc(publicationTarget.environment),
		)
		.limit(input.pageSize);
}

async function reconcileTarget(
	database: Database,
	config: PublicationConfig,
	target: ReconciliationTarget,
	runId: string,
	now: Date,
) {
	return database.transaction(async (transaction) => {
		if (!(await tryLockItemMutation(transaction, target.itemKey))) return 0;
		const [currentTarget] = await transaction
			.select({ revision: item.revision })
			.from(publicationTarget)
			.innerJoin(item, eq(item.key, publicationTarget.itemKey))
			.where(
				and(
					eq(publicationTarget.itemKey, target.itemKey),
					eq(publicationTarget.provider, target.provider),
					eq(publicationTarget.environment, target.environment),
					isNull(publicationTarget.deactivatedAt),
					eq(item.deleted, 0),
					isNull(item.parentItem),
				),
			)
			.limit(1);
		if (!currentTarget) return 0;

		const snapshot = await readPublicationRepositorySnapshot(
			transaction,
			target.itemKey,
			config.services.publication.crossref.environment,
		);
		const view = buildAdminPublicationViewFromSnapshot({
			itemKey: target.itemKey,
			snapshot,
			config,
			now,
		});
		if (view.providers[target.provider].displayState !== "repair_pending") {
			return 0;
		}
		const jobs = await enqueuePublicationJobsForItem(transaction, {
			itemKey: target.itemKey,
			canonicalRevision: currentTarget.revision,
			reason: "nightly_reconciliation",
			now,
			providers: [target.provider],
			idempotencyDiscriminator: runId,
		});
		return jobs.length;
	});
}

async function completeRun(
	database: Database,
	input: {
		runId: string;
		workerId: string;
		completedAt: Date;
		result: Record<string, number>;
	},
) {
	const [run] = await database
		.update(publicationSyncRun)
		.set({
			status: "succeeded",
			leaseOwner: null,
			leaseExpiresAt: null,
			heartbeatAt: input.completedAt,
			completedAt: input.completedAt,
			result: input.result,
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.workerId),
				gt(publicationSyncRun.leaseExpiresAt, input.completedAt),
			),
		)
		.returning({ id: publicationSyncRun.id });
	if (!run) throw new PublicationReconciliationLeaseLostError();
}

async function failRun(
	database: Database,
	input: {
		runId: string;
		workerId: string;
		failedAt: Date;
		error: unknown;
	},
) {
	await database
		.update(publicationSyncRun)
		.set({
			status: "failed",
			leaseOwner: null,
			leaseExpiresAt: null,
			heartbeatAt: input.failedAt,
			completedAt: input.failedAt,
			failure: errorMessage(input.error),
		})
		.where(
			and(
				eq(publicationSyncRun.id, input.runId),
				eq(publicationSyncRun.status, "running"),
				eq(publicationSyncRun.leaseOwner, input.workerId),
			),
		);
}

export async function runNightlyPublicationReconciliation(
	database: Database,
	config: PublicationConfig,
	options: {
		workerId: string;
		pageSize?: number;
		leaseSeconds?: number;
		now?: () => Date;
	},
): Promise<PublicationReconciliationResult> {
	const pageSize = options.pageSize ?? 100;
	const leaseSeconds = options.leaseSeconds ?? 300;
	validateOptions({ pageSize, leaseSeconds });
	const workerId = options.workerId.trim();
	if (!workerId || workerId.length > 255) {
		throw new Error("workerId must contain 1-255 characters");
	}
	const now = options.now ?? (() => new Date());
	const startedAt = now();
	const runId = await startRun(database, {
		workerId,
		startedAt,
		leaseSeconds,
	});
	if (!runId) return { status: "busy" };

	let cursor: ReconciliationCursor | null = null;
	let pages = 0;
	let scannedTargets = 0;
	let enqueuedJobs = 0;
	try {
		while (true) {
			const page = await loadTargetPage(database, { cursor, pageSize });
			if (page.length === 0) break;
			pages += 1;
			for (const target of page) {
				enqueuedJobs += await reconcileTarget(
					database,
					config,
					target,
					runId,
					now(),
				);
				scannedTargets += 1;
				await heartbeatRun(database, {
					runId,
					workerId,
					heartbeatAt: now(),
					leaseSeconds,
				});
			}
			const last = page.at(-1)!;
			cursor = {
				itemKey: last.itemKey,
				provider: last.provider,
				environment: last.environment,
			};
			if (page.length < pageSize) break;
		}
		const result = {
			pages,
			scannedTargets,
			enqueuedJobs,
			skippedTargets: scannedTargets - enqueuedJobs,
		};
		await completeRun(database, {
			runId,
			workerId,
			completedAt: now(),
			result,
		});
		return { status: "succeeded", runId, ...result };
	} catch (error) {
		await failRun(database, {
			runId,
			workerId,
			failedAt: now(),
			error,
		});
		throw error;
	}
}
