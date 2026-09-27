import {
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceRecordIssue,
	sourceSyncRun,
	sourceSyncState,
	type SourceProvider,
	type SourceSyncErrorCode,
} from "@opendeved/evidence-library-core";
import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	notInArray,
	sql,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { PARENT_REQUIRED_ITEM_TYPES } from "@/lib/admin/item-fields";

import { SourceCredentialNotFoundError } from "./credentials";
import { OpenAlexApiError } from "./openalex/client";
import { ZoteroApiError } from "./zotero/client";
import { ZoteroSnapshotTooLargeError } from "./zotero/connection";

const PROVIDER_STATUS_CODES: Partial<Record<number, SourceSyncErrorCode>> = {
	401: "access_denied",
	403: "access_denied",
	404: "not_found",
	429: "rate_limited",
};

function providerErrorCode(error: ZoteroApiError | OpenAlexApiError): SourceSyncErrorCode {
	const { status } = error;
	// No status means the request never got an answer, even after retries.
	if (status === undefined || status >= 500) return "unavailable";
	if (status === 400 && error instanceof OpenAlexApiError) return "invalid_query";
	return PROVIDER_STATUS_CODES[status] ?? "internal";
}

/** Why an import failed, as a code each app can put in its own words. */
export function classifySourceError(error: unknown): SourceSyncErrorCode {
	if (error instanceof SourceCredentialNotFoundError) return "missing_key";
	if (error instanceof ZoteroSnapshotTooLargeError) return "too_large";
	if (error instanceof ZoteroApiError || error instanceof OpenAlexApiError) {
		return providerErrorCode(error);
	}
	return "internal";
}

export type SourceStatusInput = {
	key: string;
	provider: SourceProvider;
	now: Date;
	/** The run holding the source's lease, if any. */
	activeRun: {
		startedAt: Date;
		leaseExpiresAt: Date;
		recordsDone: number;
		recordsTotal: number | null;
		/** Where this run picked up and when, for its own rate. */
		recordsFrom: number | null;
		recordsFromAt: Date | null;
	} | null;
	/** Set while the latest finished run failed. */
	lastError: { code: SourceSyncErrorCode; details: string; at: Date } | null;
	lastSuccessAt: Date | null;
	/**
	 * Search work queued by this source's runs that still have some waiting.
	 * Done counts failed events too, so the bar can finish.
	 */
	search: { done: number; total: number; startedAt: Date } | null;
	/** Search updates of this source's records that failed and wait for a retry. */
	searchFailed: number;
	/** The latest run that changed records. */
	lastChange: { records: number } | null;
	searchable: number;
	/** Open record issues by code. */
	issues: Record<string, number>;
};

type SourceStatusBase = {
	key: string;
	provider: SourceProvider;
	searchable: number;
	searchFailed: number;
	/** Null until a run has changed anything. */
	changed: number | null;
	lastSuccessAt: string | null;
	issues: Record<string, number>;
};

export type SourceStatus = SourceStatusBase &
	(
		| {
				state: "running";
				phase: "import" | "search";
				done: number;
				/** Null when the source has not said how many records there are. */
				total: number | null;
				startedAt: string;
				minutesLeft: number | null;
		  }
		| { state: "failed"; failure: { code: SourceSyncErrorCode; details: string; at: string } }
		| { state: "succeeded" }
		| { state: "idle" }
	);

// A rate from the first seconds of work swings too much to predict from.
const MIN_RATE_SAMPLE_MS = 5_000;

/** Time left at the rate measured from a starting point: how many were done then, and when. */
function minutesLeft(
	progress: { done: number; total: number | null },
	since: { done: number; at: Date } | null,
	now: Date,
) {
	if (progress.total === null || !since) return null;
	const progressed = progress.done - since.done;
	const elapsed = now.getTime() - since.at.getTime();
	if (progressed <= 0 || elapsed < MIN_RATE_SAMPLE_MS) return null;
	return Math.ceil(((progress.total - progress.done) * elapsed) / progressed / 60_000);
}

/**
 * Where one source stands. An import under way comes first, then a failed
 * last run, then search work still waiting from any earlier run, since the
 * worker starts a new, usually empty, run every minute.
 */
export function sourceStatus(input: SourceStatusInput): SourceStatus {
	const base: SourceStatusBase = {
		changed: input.lastChange?.records ?? null,
		issues: input.issues,
		key: input.key,
		lastSuccessAt: input.lastSuccessAt?.toISOString() ?? null,
		provider: input.provider,
		searchFailed: input.searchFailed,
		searchable: input.searchable,
	};
	const run = input.activeRun;
	if (run && run.leaseExpiresAt <= input.now) {
		return {
			...base,
			failure: {
				at: run.leaseExpiresAt.toISOString(),
				code: "interrupted",
				details: "SourceLeaseLostError: worker lease expired",
			},
			state: "failed",
		};
	}
	// A run that has reported nothing may only be checking for changes.
	if (run && (run.recordsDone > 0 || (run.recordsTotal ?? 0) > 0)) {
		return {
			...base,
			done: run.recordsDone,
			minutesLeft: minutesLeft(
				{ done: run.recordsDone, total: run.recordsTotal },
				run.recordsFrom === null || !run.recordsFromAt
					? null
					: { at: run.recordsFromAt, done: run.recordsFrom },
				input.now,
			),
			phase: "import",
			startedAt: run.startedAt.toISOString(),
			state: "running",
			total: run.recordsTotal,
		};
	}
	if (input.lastError) {
		return {
			...base,
			failure: { ...input.lastError, at: input.lastError.at.toISOString() },
			state: "failed",
		};
	}
	const search = input.search;
	if (search && search.done < search.total) {
		return {
			...base,
			done: search.done,
			minutesLeft: minutesLeft(search, { at: search.startedAt, done: 0 }, input.now),
			phase: "search",
			startedAt: search.startedAt.toISOString(),
			state: "running",
			total: search.total,
		};
	}
	return { ...base, state: input.lastSuccessAt ? "succeeded" : "idle" };
}

/**
 * Every imported source's status, read in one pass. Search work is counted
 * per run: all events of the runs that still have some waiting.
 */
export async function readSourceStatuses(
	database: Database,
	options: { hiddenTags: readonly string[]; now?: Date },
): Promise<SourceStatus[]> {
	const now = options.now ?? new Date();
	const hiddenTags = options.hiddenTags.map((name) => name.toLowerCase());
	const [sources, states, searchRows, failedRows, searchableRows, issueRows] =
		await Promise.all([
			database
				.select({ key: sourceConnection.key, provider: sourceConnection.provider })
				.from(sourceConnection)
				.where(ne(sourceConnection.provider, NATIVE_SOURCE_CONNECTION_KEY))
				.orderBy(asc(sourceConnection.key)),
			database
				.select({
					key: sourceSyncState.sourceConnectionKey,
					lastChangedRecords: sourceSyncState.lastChangedRecords,
					lastError: sourceSyncState.lastError,
					lastErrorCode: sourceSyncState.lastErrorCode,
					lastFailureAt: sourceSyncState.lastFailureAt,
					lastSuccessAt: sourceSyncState.lastSuccessAt,
					leaseExpiresAt: sourceSyncState.leaseExpiresAt,
					recordsDone: sourceSyncRun.recordsDone,
					recordsFrom: sourceSyncRun.recordsFrom,
					recordsFromAt: sourceSyncRun.recordsFromAt,
					recordsTotal: sourceSyncRun.recordsTotal,
					runStartedAt: sourceSyncRun.startedAt,
				})
				.from(sourceSyncState)
				.leftJoin(sourceSyncRun, eq(sourceSyncState.activeRunId, sourceSyncRun.id)),
			database
				.select({
					done: sql<number>`count(*) filter (where ${outbox.processedAt} is not null or ${outbox.deadLetteredAt} is not null)::int`,
					key: sourceSyncRun.sourceConnectionKey,
					startedAt: sql<Date>`min(${outbox.createdAt})`.mapWith(outbox.createdAt),
					total: sql<number>`count(*)::int`,
				})
				.from(outbox)
				.innerJoin(sourceSyncRun, eq(outbox.sourceSyncRunId, sourceSyncRun.id))
				.where(
					inArray(
						outbox.sourceSyncRunId,
						database
							.selectDistinct({ id: outbox.sourceSyncRunId })
							.from(outbox)
							.where(
								and(
									isNotNull(outbox.sourceSyncRunId),
									isNull(outbox.processedAt),
									isNull(outbox.deadLetteredAt),
								),
							),
					),
				)
				.groupBy(sourceSyncRun.sourceConnectionKey),
			database
				.select({
					count: sql<number>`count(*)::int`,
					key: sourceSyncRun.sourceConnectionKey,
				})
				.from(outbox)
				.innerJoin(sourceSyncRun, eq(outbox.sourceSyncRunId, sourceSyncRun.id))
				.where(and(isNull(outbox.processedAt), isNotNull(outbox.deadLetteredAt)))
				.groupBy(sourceSyncRun.sourceConnectionKey),
			// The same records the search projection publishes.
			database
				.select({
					count: sql<number>`count(*)::int`,
					key: itemSourceLink.sourceConnectionKey,
				})
				.from(itemSourceLink)
				.innerJoin(item, eq(item.key, itemSourceLink.itemKey))
				.where(
					and(
						sql`coalesce(${item.deleted}, 0) = 0`,
						isNull(item.parentItem),
						notInArray(sql`lower(${item.itemType}::text)`, [...PARENT_REQUIRED_ITEM_TYPES]),
						hiddenTags.length > 0
							? notExists(
									database
										.select({ itemKey: itemToTag.itemKey })
										.from(itemToTag)
										.where(
											and(
												eq(itemToTag.itemKey, item.key),
												inArray(sql`lower(${itemToTag.tagName})`, hiddenTags),
											),
										),
								)
							: undefined,
					),
				)
				.groupBy(itemSourceLink.sourceConnectionKey),
			database
				.select({
					code: sourceRecordIssue.code,
					count: sql<number>`count(*)::int`,
					key: sourceRecordIssue.sourceConnectionKey,
				})
				.from(sourceRecordIssue)
				.where(isNull(sourceRecordIssue.dismissedAt))
				.groupBy(sourceRecordIssue.sourceConnectionKey, sourceRecordIssue.code),
		]);

	const stateByKey = new Map(states.map((row) => [row.key, row]));
	const searchByKey = new Map(searchRows.map((row) => [row.key, row]));
	const failedByKey = new Map(failedRows.map((row) => [row.key, row.count]));
	const searchableByKey = new Map(searchableRows.map((row) => [row.key, row.count]));
	const issuesByKey = new Map<string, Record<string, number>>();
	for (const row of issueRows) {
		issuesByKey.set(row.key, { ...issuesByKey.get(row.key), [row.code]: row.count });
	}

	return sources.map(({ key, provider }) => {
		const state = stateByKey.get(key) ?? NEVER_RUN;
		return sourceStatus({
			activeRun: activeRunOf(state),
			issues: issuesByKey.get(key) ?? {},
			key,
			lastChange: state.lastChangedRecords ? { records: state.lastChangedRecords } : null,
			lastError: lastErrorOf(state),
			lastSuccessAt: state.lastSuccessAt,
			now,
			provider,
			search: searchByKey.get(key) ?? null,
			searchFailed: failedByKey.get(key) ?? 0,
			searchable: searchableByKey.get(key) ?? 0,
		});
	});
}

type SyncStateRow = {
	lastChangedRecords: number | null;
	lastError: string | null;
	lastErrorCode: SourceSyncErrorCode | null;
	lastFailureAt: Date | null;
	lastSuccessAt: Date | null;
	leaseExpiresAt: Date | null;
	recordsDone: number | null;
	recordsFrom: number | null;
	recordsFromAt: Date | null;
	recordsTotal: number | null;
	runStartedAt: Date | null;
};

// A source the worker has not claimed yet has no sync state row.
const NEVER_RUN: SyncStateRow = {
	lastChangedRecords: null,
	lastError: null,
	lastErrorCode: null,
	lastFailureAt: null,
	lastSuccessAt: null,
	leaseExpiresAt: null,
	recordsDone: null,
	recordsFrom: null,
	recordsFromAt: null,
	recordsTotal: null,
	runStartedAt: null,
};

function activeRunOf(state: SyncStateRow): SourceStatusInput["activeRun"] {
	if (!state.runStartedAt || !state.leaseExpiresAt) return null;
	return {
		leaseExpiresAt: state.leaseExpiresAt,
		recordsDone: state.recordsDone ?? 0,
		recordsFrom: state.recordsFrom,
		recordsFromAt: state.recordsFromAt,
		recordsTotal: state.recordsTotal,
		startedAt: state.runStartedAt,
	};
}

function lastErrorOf(state: SyncStateRow): SourceStatusInput["lastError"] {
	if (!state.lastError || !state.lastFailureAt) return null;
	return {
		at: state.lastFailureAt,
		// Failures saved before codes existed.
		code: state.lastErrorCode ?? "internal",
		details: state.lastError,
	};
}
