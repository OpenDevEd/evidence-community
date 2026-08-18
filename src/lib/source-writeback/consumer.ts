import { setTimeout as delay } from "node:timers/promises";

import {
	collectionSourceLink,
	collectionSourceSnapshot,
	itemSourceLink,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import {
	and,
	asc,
	eq,
	gt,
	isNotNull,
	isNull,
	lte,
	ne,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/database-schema";
import {
	lockCollectionMutation,
	lockItemMutation,
} from "@/db/canonical-mutation-lock";
import { sourceSnapshot } from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { publishedAdminItemPayload } from "@/lib/admin/item-draft-patch";
import {
	relatedRemoteUris,
	relationsForWriteback,
} from "@/lib/source-writeback/related-links";
import type { SourceCredentialResolver } from "@/lib/source-ingestion/credentials";

import {
	type SourceWritebackAdapterRegistry,
	type SourceWritebackRequest,
	type SourceWritebackResult,
} from "./adapter";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 15;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 60 * 60 * 1_000;
const MAX_ERROR_LENGTH = 32 * 1_024;
export const DEFAULT_SOURCE_WRITEBACK_MAX_JOBS = 10_000;
export const MAX_SOURCE_WRITEBACK_JOBS = 1_000_000;

type SourceWritebackJobRow = typeof sourceWritebackJob.$inferSelect;
type ClaimedJob =
	| (Omit<SourceWritebackJobRow, "collectionKey" | "itemKey"> & {
			collectionKey: null;
			itemKey: string;
	  })
	| (Omit<SourceWritebackJobRow, "collectionKey" | "itemKey"> & {
			collectionKey: string;
			itemKey: null;
	  });

export type SourceWritebackConsumerOptions = {
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	heartbeatIntervalMs?: number;
	leaseDurationMs?: number;
	maxAttempts?: number;
	now?: () => Date;
	registry: SourceWritebackAdapterRegistry;
	retryBaseMs?: number;
	retryMaxMs?: number;
	signal?: AbortSignal;
	// Omitting the source policy disables all writeback.
	sourceWritebackEnabled?: (
		sourceConnectionKey: string,
	) => boolean | Promise<boolean>;
	workerId: string;
};

export function validateSourceWritebackWorkerId(value: string) {
	const workerId = value.trim();
	if (!workerId || workerId.length > 255) {
		throw new Error("workerId must contain 1-255 characters");
	}
	return workerId;
}

export function validateSourceWritebackMaxJobs(value: number) {
	if (
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > MAX_SOURCE_WRITEBACK_JOBS
	) {
		throw new Error(
			`maxJobs must be an integer between 1 and ${MAX_SOURCE_WRITEBACK_JOBS}`,
		);
	}
	return value;
}

export type SourceWritebackProcessResult = {
	collectionKey?: string;
	itemKey?: string;
	jobId?: number;
	operation?: "upsert" | "delete";
	status:
		| "dead-lettered"
		| "deferred"
		| "idle"
		| "lease-lost"
		| "processed"
		| "retrying"
		| "superseded";
};

export class SourceWritebackLeaseLostError extends Error {
	constructor(jobId: number) {
		super(`Source writeback lease was lost for job ${jobId}`);
		this.name = "SourceWritebackLeaseLostError";
	}
}

export class SourceWritebackAbortError extends Error {
	constructor() {
		super("Source writeback processing was aborted");
		this.name = "SourceWritebackAbortError";
	}
}

export class SourceWritebackParentUnavailableError extends Error {
	constructor(itemKey: string, parentItemKey: string) {
		super(
			`Parent ${parentItemKey} has no viable writeback queued for child ${itemKey}`,
		);
		this.name = "SourceWritebackParentUnavailableError";
	}
}

export class SourceWritebackCollectionParentUnavailableError extends Error {
	constructor(collectionKey: string, parentCollectionKey: string) {
		super(
			`Parent collection ${parentCollectionKey} has no viable writeback queued for child collection ${collectionKey}`,
		);
		this.name = "SourceWritebackCollectionParentUnavailableError";
	}
}

function validateOptions(options: SourceWritebackConsumerOptions) {
	const workerId = validateSourceWritebackWorkerId(options.workerId);
	const leaseDurationMs =
		options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
	const heartbeatIntervalMs =
		options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
	const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
	if (
		!Number.isSafeInteger(leaseDurationMs) ||
		leaseDurationMs < 1_000 ||
		leaseDurationMs > 60 * 60 * 1_000
	) {
		throw new Error(
			"leaseDurationMs must be an integer between 1,000 and 3,600,000",
		);
	}
	if (
		!Number.isSafeInteger(heartbeatIntervalMs) ||
		heartbeatIntervalMs < 100 ||
		heartbeatIntervalMs >= leaseDurationMs
	) {
		throw new Error(
			"heartbeatIntervalMs must be an integer of at least 100 and less than leaseDurationMs",
		);
	}
	if (
		!Number.isSafeInteger(maxAttempts) ||
		maxAttempts < 1 ||
		maxAttempts > 100
	) {
		throw new Error("maxAttempts must be an integer between 1 and 100");
	}
	if (
		!Number.isSafeInteger(retryBaseMs) ||
		retryBaseMs < 100 ||
		!Number.isSafeInteger(retryMaxMs) ||
		retryMaxMs < retryBaseMs
	) {
		throw new Error(
			"retry delays must be safe integers and retryMaxMs must be at least retryBaseMs",
		);
	}
	return {
		heartbeatIntervalMs,
		leaseDurationMs,
		maxAttempts,
		retryBaseMs,
		retryMaxMs,
		workerId,
	};
}

function currentTime(options: SourceWritebackConsumerOptions) {
	return (options.now ?? (() => new Date()))();
}

function leaseExpiry(value: Date, leaseDurationMs: number) {
	return new Date(value.getTime() + leaseDurationMs);
}

function errorMessage(error: unknown) {
	return (
		error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error)
	).slice(0, MAX_ERROR_LENGTH);
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new SourceWritebackAbortError();
}

function isClaimedJob(job: SourceWritebackJobRow): job is ClaimedJob {
	return (
		(typeof job.itemKey === "string" && job.collectionKey === null) ||
		(typeof job.collectionKey === "string" && job.itemKey === null)
	);
}

function jobEntity(job: ClaimedJob) {
	return job.itemKey !== null
		? ({ entity: "item", key: job.itemKey } as const)
		: ({ entity: "collection", key: job.collectionKey! } as const);
}

async function claimJob(
	options: SourceWritebackConsumerOptions,
	leaseDurationMs: number,
	workerId: string,
) {
	throwIfAborted(options.signal);
	const claimedAt = currentTime(options);
	return options.database.transaction(async (transaction) => {
		const leasedLink = alias(sourceWritebackJob, "leasedWritebackLink");
		const [candidate] = await transaction
			.select()
			.from(sourceWritebackJob)
			.where(
				and(
					isNull(sourceWritebackJob.processedAt),
					isNull(sourceWritebackJob.deadLetteredAt),
					lte(sourceWritebackJob.nextAttemptAt, claimedAt),
					or(
						isNull(sourceWritebackJob.leaseExpiresAt),
						lte(sourceWritebackJob.leaseExpiresAt, claimedAt),
					),
					notExists(
						transaction
							.select({ id: leasedLink.id })
							.from(leasedLink)
							.where(
								and(
									sql`${leasedLink.itemKey} IS NOT DISTINCT FROM ${sourceWritebackJob.itemKey}`,
									sql`${leasedLink.collectionKey} IS NOT DISTINCT FROM ${sourceWritebackJob.collectionKey}`,
									eq(
										leasedLink.sourceConnectionKey,
										sourceWritebackJob.sourceConnectionKey,
									),
									isNull(leasedLink.processedAt),
									isNull(leasedLink.deadLetteredAt),
									isNotNull(leasedLink.leaseOwner),
									gt(leasedLink.leaseExpiresAt, claimedAt),
								),
							),
					),
					sql<boolean>`pg_try_advisory_xact_lock(hashtextextended(
						'source-writeback:' || ${sourceWritebackJob.sourceConnectionKey} || ':' ||
						CASE WHEN ${sourceWritebackJob.itemKey} IS NULL THEN 'collection:' || ${sourceWritebackJob.collectionKey}
						ELSE 'item:' || ${sourceWritebackJob.itemKey} END,
						0
					))`,
				),
			)
			.orderBy(asc(sourceWritebackJob.id))
			.for("update", { skipLocked: true })
			.limit(1);
		if (!candidate) return null;
		if (!isClaimedJob(candidate)) {
			throw new Error("Claimed writeback job violates the entity XOR");
		}

		// The candidate query and the advisory lock can observe different
		// READ COMMITTED snapshots. Re-check after acquiring the stream lock so
		// a lease committed during the candidate scan cannot overlap this job.
		const [activeLease] = await transaction
			.select({ id: sourceWritebackJob.id })
			.from(sourceWritebackJob)
			.where(
				and(
					ne(sourceWritebackJob.id, candidate.id),
					sql`${sourceWritebackJob.itemKey} IS NOT DISTINCT FROM ${candidate.itemKey}`,
					sql`${sourceWritebackJob.collectionKey} IS NOT DISTINCT FROM ${candidate.collectionKey}`,
					eq(
						sourceWritebackJob.sourceConnectionKey,
						candidate.sourceConnectionKey,
					),
					isNull(sourceWritebackJob.processedAt),
					isNull(sourceWritebackJob.deadLetteredAt),
					isNotNull(sourceWritebackJob.leaseOwner),
					gt(sourceWritebackJob.leaseExpiresAt, claimedAt),
				),
			)
			.limit(1);
		if (activeLease) return null;

		const [claimed] = await transaction
			.update(sourceWritebackJob)
			.set({
				leaseExpiresAt: leaseExpiry(claimedAt, leaseDurationMs),
				leaseOwner: workerId,
			})
			.where(eq(sourceWritebackJob.id, candidate.id))
			.returning();
		if (!claimed || !isClaimedJob(claimed)) {
			throw new Error(
				"Claimed writeback job changed entity while leasing",
			);
		}
		return claimed;
	});
}

async function releaseJob(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	workerId: string,
) {
	await options.database
		.update(sourceWritebackJob)
		.set({ leaseExpiresAt: null, leaseOwner: null })
		.where(
			and(
				eq(sourceWritebackJob.id, job.id),
				eq(sourceWritebackJob.leaseOwner, workerId),
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		);
}

async function heartbeatJob(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	leaseDurationMs: number,
	workerId: string,
) {
	const heartbeatAt = currentTime(options);
	const [updated] = await options.database
		.update(sourceWritebackJob)
		.set({ leaseExpiresAt: leaseExpiry(heartbeatAt, leaseDurationMs) })
		.where(
			and(
				eq(sourceWritebackJob.id, job.id),
				eq(sourceWritebackJob.leaseOwner, workerId),
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		)
		.returning({ id: sourceWritebackJob.id });
	if (!updated) throw new SourceWritebackLeaseLostError(job.id);
}

async function heartbeatLoop(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	heartbeatIntervalMs: number,
	leaseDurationMs: number,
	workerId: string,
	signal: AbortSignal,
	onFailure: (error: unknown) => void,
) {
	while (!signal.aborted) {
		try {
			await delay(heartbeatIntervalMs, undefined, { signal });
		} catch (error) {
			if (signal.aborted) return;
			onFailure(error);
			return;
		}
		try {
			await heartbeatJob(options, job, leaseDurationMs, workerId);
		} catch (error) {
			onFailure(error);
			return;
		}
	}
}

async function markSuperseded(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	workerId: string,
) {
	const [updated] = await options.database
		.update(sourceWritebackJob)
		.set({
			leaseExpiresAt: null,
			leaseOwner: null,
			processedAt: currentTime(options),
			superseded: true,
		})
		.where(
			and(
				eq(sourceWritebackJob.id, job.id),
				eq(sourceWritebackJob.leaseOwner, workerId),
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		)
		.returning({ id: sourceWritebackJob.id });
	if (!updated) throw new SourceWritebackLeaseLostError(job.id);
}

async function loadItemRequest(
	options: SourceWritebackConsumerOptions,
	job: Extract<ClaimedJob, { itemKey: string }>,
) {
	const sourceWritebackEnabled = options.sourceWritebackEnabled
		? await options.sourceWritebackEnabled(job.sourceConnectionKey)
		: false;
	return options.database.transaction(async (transaction) => {
		await lockItemMutation(transaction, job.itemKey);
		const [state] = await transaction
			.select({
				connection: sourceConnection,
				item,
				link: itemSourceLink,
			})
			.from(itemSourceLink)
			.innerJoin(
				sourceConnection,
				eq(sourceConnection.key, itemSourceLink.sourceConnectionKey),
			)
			.innerJoin(item, eq(item.key, itemSourceLink.itemKey))
			.where(
				and(
					eq(itemSourceLink.itemKey, job.itemKey),
					eq(
						itemSourceLink.sourceConnectionKey,
						job.sourceConnectionKey,
					),
				),
			)
			.limit(1);
		if (!state) return null;
		if (
			!state.link.writebackEnabled ||
			state.connection.status === "removed" ||
			(job.operation === "upsert" && state.item.deleted === 1) ||
			(job.operation === "delete" && state.item.deleted === 0)
		) {
			return { disposition: "supersede" as const, request: null, state };
		}
		if (state.connection.status === "paused") {
			return {
				deferDelay: "long" as const,
				deferReason: "Source connection is paused",
				disposition: "defer" as const,
				request: null,
				state,
			};
		}
		if (!options.registry.has(state.connection.provider)) {
			return {
				deferDelay: "long" as const,
				deferReason: `Writeback is not supported for provider ${state.connection.provider}`,
				disposition: "defer" as const,
				request: null,
				state,
			};
		}
		if (!sourceWritebackEnabled) {
			return {
				deferDelay: "long" as const,
				deferReason: "Writeback is disabled for this source",
				disposition: "defer" as const,
				request: null,
				state,
			};
		}

		const [tagRows, collectionRows] = await Promise.all([
			transaction
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, job.itemKey))
				.orderBy(itemToTag.tagName),
			transaction
				.select({ sourceRecordKey: collection.sourceRecordKey })
				.from(itemToCollection)
				.innerJoin(
					collection,
					eq(collection.key, itemToCollection.collectionKey),
				)
				.where(
					and(
						eq(itemToCollection.itemKey, job.itemKey),
						eq(
							collection.sourceConnectionKey,
							job.sourceConnectionKey,
						),
						eq(collection.deleted, 0),
					),
				)
				.orderBy(collection.sourceRecordKey),
		]);
		let parentSourceRecordKey: string | null = null;
		if (state.item.parentItem) {
			const [parentLink] = await transaction
				.select({
					remoteDeleted: itemSourceLink.remoteDeleted,
					remoteVersion: itemSourceLink.remoteVersion,
					sourceRecordKey: itemSourceLink.sourceRecordKey,
				})
				.from(itemSourceLink)
				.where(
					and(
						eq(itemSourceLink.itemKey, state.item.parentItem),
						eq(
							itemSourceLink.sourceConnectionKey,
							job.sourceConnectionKey,
						),
					),
				)
				.limit(1);
			if (!parentLink) {
				return {
					deferDelay: "long" as const,
					deferReason: `Parent ${state.item.parentItem} is not linked to this source yet`,
					disposition: "defer" as const,
					request: null,
					state,
				};
			}
			if (parentLink.remoteDeleted || parentLink.remoteVersion === null) {
				const [pendingParentJob] = await transaction
					.select({ id: sourceWritebackJob.id })
					.from(sourceWritebackJob)
					.where(
						and(
							eq(
								sourceWritebackJob.itemKey,
								state.item.parentItem,
							),
							eq(
								sourceWritebackJob.sourceConnectionKey,
								job.sourceConnectionKey,
							),
							eq(sourceWritebackJob.operation, "upsert"),
							isNull(sourceWritebackJob.processedAt),
							isNull(sourceWritebackJob.deadLetteredAt),
						),
					)
					.limit(1);
				if (!pendingParentJob) {
					throw new SourceWritebackParentUnavailableError(
						job.itemKey,
						state.item.parentItem,
					);
				}
				return {
					deferDelay: "short" as const,
					deferReason: `Parent ${state.item.parentItem} writeback is pending`,
					disposition: "defer" as const,
					request: null,
					state,
				};
			}
			parentSourceRecordKey = parentLink.sourceRecordKey;
		}

		const payload = publishedAdminItemPayload(state.item, {
			collectionKeys: collectionRows.map(
				({ sourceRecordKey }) => sourceRecordKey,
			),
			tags: tagRows.map(({ name }) => name),
		});
		if (parentSourceRecordKey) payload.parentItem = parentSourceRecordKey;
		// The link table, not the record's JSON, decides which items are "related" in the source.
		const relations = relationsForWriteback(
			state.item.relations as Record<string, unknown> | null,
			await relatedRemoteUris(transaction, {
				connection: state.connection,
				itemKey: job.itemKey,
				sourceConnectionKey: job.sourceConnectionKey,
			}),
		);
		if (Object.keys(relations).length > 0 || payload.relations !== undefined) {
			payload.relations = relations;
		}

		const request: SourceWritebackRequest = {
			dirtyFields: job.dirtyFields,
			entity: "item",
			idempotencyKey: job.idempotencyKey,
			itemKey: job.itemKey,
			operation: job.operation,
			payload,
			remoteDeleted: state.link.remoteDeleted,
			remoteVersion: state.link.remoteVersion,
			sourceConnection: state.connection,
			sourceRecordKey: state.link.sourceRecordKey,
		};
		return { disposition: "write" as const, request, state };
	});
}

async function loadCollectionRequest(
	options: SourceWritebackConsumerOptions,
	job: Extract<ClaimedJob, { collectionKey: string }>,
) {
	const sourceWritebackEnabled = options.sourceWritebackEnabled
		? await options.sourceWritebackEnabled(job.sourceConnectionKey)
		: false;
	return options.database.transaction(async (transaction) => {
		await lockCollectionMutation(transaction, job.collectionKey);
		const [state] = await transaction
			.select({
				collection,
				connection: sourceConnection,
				link: collectionSourceLink,
			})
			.from(collectionSourceLink)
			.innerJoin(
				sourceConnection,
				eq(
					sourceConnection.key,
					collectionSourceLink.sourceConnectionKey,
				),
			)
			.innerJoin(
				collection,
				eq(collection.key, collectionSourceLink.collectionKey),
			)
			.where(
				and(
					eq(collectionSourceLink.collectionKey, job.collectionKey),
					eq(
						collectionSourceLink.sourceConnectionKey,
						job.sourceConnectionKey,
					),
				),
			)
			.limit(1);
		if (!state) return null;
		if (
			!state.link.writebackEnabled ||
			state.connection.status === "removed" ||
			(job.operation === "upsert" && state.collection.deleted === 1) ||
			(job.operation === "delete" && state.collection.deleted === 0)
		) {
			return { disposition: "supersede" as const, request: null, state };
		}
		if (state.connection.status === "paused") {
			return {
				deferDelay: "long" as const,
				deferReason: "Source connection is paused",
				disposition: "defer" as const,
				request: null,
				state,
			};
		}
		if (!options.registry.has(state.connection.provider)) {
			return {
				deferDelay: "long" as const,
				deferReason: `Writeback is not supported for provider ${state.connection.provider}`,
				disposition: "defer" as const,
				request: null,
				state,
			};
		}
		if (!sourceWritebackEnabled) {
			return {
				deferDelay: "long" as const,
				deferReason: "Writeback is disabled for this source",
				disposition: "defer" as const,
				request: null,
				state,
			};
		}

		let parentSourceRecordKey: string | null = null;
		if (job.operation === "upsert" && state.collection.parentCollection) {
			const [parentLink] = await transaction
				.select({
					remoteDeleted: collectionSourceLink.remoteDeleted,
					remoteVersion: collectionSourceLink.remoteVersion,
					sourceRecordKey: collectionSourceLink.sourceRecordKey,
				})
				.from(collectionSourceLink)
				.where(
					and(
						eq(
							collectionSourceLink.collectionKey,
							state.collection.parentCollection,
						),
						eq(
							collectionSourceLink.sourceConnectionKey,
							job.sourceConnectionKey,
						),
					),
				)
				.limit(1);
			if (!parentLink) {
				return {
					deferDelay: "long" as const,
					deferReason: `Parent collection ${state.collection.parentCollection} is not linked to this source yet`,
					disposition: "defer" as const,
					request: null,
					state,
				};
			}
			if (parentLink.remoteDeleted || parentLink.remoteVersion === null) {
				const [pendingParentJob] = await transaction
					.select({ id: sourceWritebackJob.id })
					.from(sourceWritebackJob)
					.where(
						and(
							eq(
								sourceWritebackJob.collectionKey,
								state.collection.parentCollection,
							),
							eq(
								sourceWritebackJob.sourceConnectionKey,
								job.sourceConnectionKey,
							),
							eq(sourceWritebackJob.operation, "upsert"),
							isNull(sourceWritebackJob.processedAt),
							isNull(sourceWritebackJob.deadLetteredAt),
						),
					)
					.limit(1);
				if (!pendingParentJob) {
					throw new SourceWritebackCollectionParentUnavailableError(
						job.collectionKey,
						state.collection.parentCollection,
					);
				}
				return {
					deferDelay: "short" as const,
					deferReason: `Parent collection ${state.collection.parentCollection} writeback is pending`,
					disposition: "defer" as const,
					request: null,
					state,
				};
			}
			parentSourceRecordKey = parentLink.sourceRecordKey;
		}

		const request: SourceWritebackRequest = {
			collectionKey: job.collectionKey,
			dirtyFields: job.dirtyFields,
			entity: "collection",
			idempotencyKey: job.idempotencyKey,
			operation: job.operation,
			payload: {
				name: state.collection.name ?? "",
				parentCollection: parentSourceRecordKey ?? false,
				relations: state.collection.relations ?? {},
			},
			remoteDeleted: state.link.remoteDeleted,
			remoteVersion: state.link.remoteVersion,
			sourceConnection: state.connection,
			sourceRecordKey: state.link.sourceRecordKey,
		};
		return { disposition: "write" as const, request, state };
	});
}

async function loadRequest(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
) {
	if (job.itemKey !== null) return loadItemRequest(options, job);
	return loadCollectionRequest(options, job);
}

async function deferJob(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	workerId: string,
	delayMs: number,
	reason: string,
) {
	const deferredAt = currentTime(options);
	const [updated] = await options.database
		.update(sourceWritebackJob)
		.set({
			lastError: reason.slice(0, MAX_ERROR_LENGTH),
			leaseExpiresAt: null,
			leaseOwner: null,
			nextAttemptAt: new Date(deferredAt.getTime() + delayMs),
		})
		.where(
			and(
				eq(sourceWritebackJob.id, job.id),
				eq(sourceWritebackJob.leaseOwner, workerId),
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		)
		.returning({ id: sourceWritebackJob.id });
	if (!updated) throw new SourceWritebackLeaseLostError(job.id);
}

function validateResult(result: SourceWritebackResult) {
	if (!result.sourceRecordKey || result.sourceRecordKey.length > 512) {
		throw new Error(
			"Writeback adapter returned an invalid source record key",
		);
	}
	if (result.remoteVersion !== null && result.remoteVersion.length > 255) {
		throw new Error("Writeback adapter returned an invalid remote version");
	}
	if (
		result.snapshot &&
		!/^[0-9a-f]{64}$/.test(result.snapshot.fingerprint)
	) {
		throw new Error(
			"Writeback adapter returned an invalid snapshot fingerprint",
		);
	}
}

async function acknowledgeJob(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	result: SourceWritebackResult,
	workerId: string,
) {
	validateResult(result);
	if (job.collectionKey !== null) {
		await options.database.transaction(async (transaction) => {
			await lockCollectionMutation(transaction, job.collectionKey);
			const [currentJob] = await transaction
				.select()
				.from(sourceWritebackJob)
				.where(eq(sourceWritebackJob.id, job.id))
				.for("update")
				.limit(1);
			if (
				!currentJob ||
				currentJob.leaseOwner !== workerId ||
				currentJob.processedAt ||
				currentJob.deadLetteredAt
			) {
				throw new SourceWritebackLeaseLostError(job.id);
			}
			const [currentCollection] = await transaction
				.select({ revision: collection.revision })
				.from(collection)
				.where(eq(collection.key, job.collectionKey))
				.for("update")
				.limit(1);
			const [currentLink] = await transaction
				.select()
				.from(collectionSourceLink)
				.where(
					and(
						eq(
							collectionSourceLink.collectionKey,
							job.collectionKey,
						),
						eq(
							collectionSourceLink.sourceConnectionKey,
							job.sourceConnectionKey,
						),
					),
				)
				.for("update")
				.limit(1);
			if (!currentCollection || !currentLink) {
				throw new SourceWritebackLeaseLostError(job.id);
			}
			const dirtyFields =
				currentCollection.revision === job.canonicalRevision
					? currentLink.dirtyFields.filter(
							(field) => !job.dirtyFields.includes(field),
						)
					: currentLink.dirtyFields;
			const completedAt = currentTime(options);
			await transaction
				.update(collectionSourceLink)
				.set({
					dirtyFields,
					lastAcknowledgedRemoteVersion: result.remoteVersion,
					remoteDeleted: job.operation === "delete",
					remoteVersion: result.remoteVersion,
					sourceRecordKey: result.sourceRecordKey,
					updatedAt: completedAt,
				})
				.where(
					and(
						eq(
							collectionSourceLink.collectionKey,
							job.collectionKey,
						),
						eq(
							collectionSourceLink.sourceConnectionKey,
							job.sourceConnectionKey,
						),
					),
				);
			if (result.snapshot) {
				await transaction
					.insert(collectionSourceSnapshot)
					.values({
						collectionKey: job.collectionKey,
						fetchedAt: completedAt,
						mappingProfileVersion:
							result.snapshot.mappingProfileVersion ?? null,
						payload: result.snapshot.payload,
						payloadHash: result.snapshot.fingerprint,
						remoteVersion: result.remoteVersion,
						sourceConnectionKey: job.sourceConnectionKey,
					})
					.onConflictDoUpdate({
						target: [
							collectionSourceSnapshot.collectionKey,
							collectionSourceSnapshot.sourceConnectionKey,
						],
						set: {
							fetchedAt: completedAt,
							mappingProfileVersion:
								result.snapshot.mappingProfileVersion ?? null,
							payload: result.snapshot.payload,
							payloadHash: result.snapshot.fingerprint,
							remoteVersion: result.remoteVersion,
						},
					});
			}
			const [acknowledged] = await transaction
				.update(sourceWritebackJob)
				.set({
					completedRemoteVersion: result.remoteVersion,
					completedSourceRecordKey: result.sourceRecordKey,
					lastError: null,
					leaseExpiresAt: null,
					leaseOwner: null,
					processedAt: completedAt,
				})
				.where(
					and(
						eq(sourceWritebackJob.id, job.id),
						eq(sourceWritebackJob.leaseOwner, workerId),
						isNull(sourceWritebackJob.processedAt),
						isNull(sourceWritebackJob.deadLetteredAt),
					),
				)
				.returning({ id: sourceWritebackJob.id });
			if (!acknowledged) throw new SourceWritebackLeaseLostError(job.id);
		});
		return;
	}
	const itemKey = job.itemKey;
	await options.database.transaction(async (transaction) => {
		await lockItemMutation(transaction, itemKey);
		const [currentJob] = await transaction
			.select()
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.id, job.id))
			.for("update")
			.limit(1);
		if (
			!currentJob ||
			currentJob.leaseOwner !== workerId ||
			currentJob.processedAt ||
			currentJob.deadLetteredAt
		) {
			throw new SourceWritebackLeaseLostError(job.id);
		}
		const [currentItem] = await transaction
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, itemKey))
			.for("update")
			.limit(1);
		const [currentLink] = await transaction
			.select()
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(
						itemSourceLink.sourceConnectionKey,
						job.sourceConnectionKey,
					),
				),
			)
			.for("update")
			.limit(1);
		if (!currentItem || !currentLink) {
			throw new SourceWritebackLeaseLostError(job.id);
		}
		const dirtyFields =
			currentItem.revision === job.canonicalRevision
				? currentLink.dirtyFields.filter(
						(field) => !job.dirtyFields.includes(field),
					)
				: currentLink.dirtyFields;
		const completedAt = currentTime(options);
		await transaction
			.update(itemSourceLink)
			.set({
				dirtyFields,
				lastAcknowledgedRemoteVersion: result.remoteVersion,
				remoteDeleted: job.operation === "delete",
				remoteVersion: result.remoteVersion,
				sourceRecordKey: result.sourceRecordKey,
				updatedAt: completedAt,
			})
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(
						itemSourceLink.sourceConnectionKey,
						job.sourceConnectionKey,
					),
				),
			);
		if (result.snapshot) {
			await transaction
				.insert(sourceSnapshot)
				.values({
					fetchedAt: completedAt,
					itemKey,
					mappingProfileVersion:
						result.snapshot.mappingProfileVersion ?? null,
					payload: result.snapshot.payload,
					payloadHash: result.snapshot.fingerprint,
					remoteVersion: result.remoteVersion,
					sourceConnectionKey: job.sourceConnectionKey,
				})
				.onConflictDoUpdate({
					target: [
						sourceSnapshot.itemKey,
						sourceSnapshot.sourceConnectionKey,
					],
					set: {
						fetchedAt: completedAt,
						mappingProfileVersion:
							result.snapshot.mappingProfileVersion ?? null,
						payload: result.snapshot.payload,
						payloadHash: result.snapshot.fingerprint,
						remoteVersion: result.remoteVersion,
					},
				});
		}
		const [acknowledged] = await transaction
			.update(sourceWritebackJob)
			.set({
				completedRemoteVersion: result.remoteVersion,
				completedSourceRecordKey: result.sourceRecordKey,
				lastError: null,
				leaseExpiresAt: null,
				leaseOwner: null,
				processedAt: completedAt,
			})
			.where(
				and(
					eq(sourceWritebackJob.id, job.id),
					eq(sourceWritebackJob.leaseOwner, workerId),
					isNull(sourceWritebackJob.processedAt),
					isNull(sourceWritebackJob.deadLetteredAt),
				),
			)
			.returning({ id: sourceWritebackJob.id });
		if (!acknowledged) throw new SourceWritebackLeaseLostError(job.id);
	});
}

async function failJob(
	options: SourceWritebackConsumerOptions,
	job: ClaimedJob,
	workerId: string,
	error: unknown,
	maxAttempts: number,
	retryBaseMs: number,
	retryMaxMs: number,
) {
	const attempts = job.attempts + 1;
	const failedAt = currentTime(options);
	const deadLettered = attempts >= maxAttempts;
	const retryDelay = Math.min(
		retryMaxMs,
		retryBaseMs * 2 ** Math.max(0, attempts - 1),
	);
	const [updated] = await options.database
		.update(sourceWritebackJob)
		.set({
			attempts,
			deadLetteredAt: deadLettered ? failedAt : null,
			lastError: errorMessage(error),
			leaseExpiresAt: null,
			leaseOwner: null,
			nextAttemptAt: new Date(failedAt.getTime() + retryDelay),
		})
		.where(
			and(
				eq(sourceWritebackJob.id, job.id),
				eq(sourceWritebackJob.leaseOwner, workerId),
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		)
		.returning({ id: sourceWritebackJob.id });
	if (!updated) throw new SourceWritebackLeaseLostError(job.id);
	return deadLettered;
}

export async function processNextSourceWritebackJob(
	options: SourceWritebackConsumerOptions,
): Promise<SourceWritebackProcessResult> {
	const validated = validateOptions(options);
	const job = await claimJob(
		options,
		validated.leaseDurationMs,
		validated.workerId,
	);
	if (!job) return { status: "idle" };
	const entity = jobEntity(job);
	const resultBase = {
		...(entity.entity === "item"
			? { itemKey: entity.key }
			: { collectionKey: entity.key }),
		jobId: job.id,
		operation: job.operation,
	};

	try {
		const loaded = await loadRequest(options, job);
		if (!loaded || loaded.disposition === "supersede") {
			await markSuperseded(options, job, validated.workerId);
			return { ...resultBase, status: "superseded" };
		}
		if (loaded.disposition === "defer") {
			await deferJob(
				options,
				job,
				validated.workerId,
				loaded.deferDelay === "short"
					? validated.retryBaseMs
					: validated.retryMaxMs,
				loaded.deferReason,
			);
			return { ...resultBase, status: "deferred" };
		}
		const adapter = options.registry.get(loaded.state.connection.provider);
		const heartbeatAbort = new AbortController();
		const operationAbort = new AbortController();
		const combinedSignal = options.signal
			? AbortSignal.any([options.signal, operationAbort.signal])
			: operationAbort.signal;
		let heartbeatFailure: unknown = null;
		const heartbeat = heartbeatLoop(
			options,
			job,
			validated.heartbeatIntervalMs,
			validated.leaseDurationMs,
			validated.workerId,
			heartbeatAbort.signal,
			(error) => {
				heartbeatFailure = error;
				operationAbort.abort(error);
			},
		);
		let writeResult: SourceWritebackResult;
		try {
			writeResult = await adapter.write(loaded.request, {
				credentialResolver: options.credentialResolver,
				signal: combinedSignal,
			});
		} finally {
			heartbeatAbort.abort();
			await heartbeat;
		}
		if (heartbeatFailure) throw heartbeatFailure;
		throwIfAborted(options.signal);
		await acknowledgeJob(options, job, writeResult, validated.workerId);
		return { ...resultBase, status: "processed" };
	} catch (error) {
		if (error instanceof SourceWritebackLeaseLostError) {
			return { ...resultBase, status: "lease-lost" };
		}
		if (options.signal?.aborted) {
			await releaseJob(options, job, validated.workerId);
			throw new SourceWritebackAbortError();
		}
		const deadLettered = await failJob(
			options,
			job,
			validated.workerId,
			error,
			validated.maxAttempts,
			validated.retryBaseMs,
			validated.retryMaxMs,
		);
		return {
			...resultBase,
			status: deadLettered ? "dead-lettered" : "retrying",
		};
	}
}

export async function drainSourceWritebackJobs(
	options: SourceWritebackConsumerOptions,
	maxJobs = DEFAULT_SOURCE_WRITEBACK_MAX_JOBS,
) {
	validateSourceWritebackMaxJobs(maxJobs);
	const results: SourceWritebackProcessResult[] = [];
	for (let processed = 0; processed < maxJobs; processed += 1) {
		const result = await processNextSourceWritebackJob(options);
		if (result.status === "idle") break;
		results.push(result);
	}
	return results;
}
