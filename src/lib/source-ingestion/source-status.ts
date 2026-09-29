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
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	notInArray,
	sql,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { PARENT_REQUIRED_ITEM_TYPES } from "@/lib/admin/item-fields";

import { SourceCredentialNotFoundError } from "./credentials";
import { OpenAlexApiError } from "./openalex/client";
import { OpenScholarCollectionGoneError } from "./openscholar/client";
import { OpenScholarServiceError } from "@/lib/openscholar-service";
import { ZoteroApiError } from "./zotero/client";
import { ZoteroSnapshotTooLargeError } from "./zotero/connection";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

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
	if (error instanceof OpenScholarCollectionGoneError) return error.code;
	if (error instanceof OpenScholarServiceError) {
		if (error.status === null || error.status >= 500) return "unavailable";
		return PROVIDER_STATUS_CODES[error.status] ?? "internal";
	}
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
		/** Set once the run adds PDFs: the records counts are then PDFs. */
		stage?: "pdfs" | null;
		pdfsMissed?: number | null;
	} | null;
	/** Set while the latest finished run failed, with whether it was adding PDFs then. */
	lastError: { code: SourceSyncErrorCode; details: string; at: Date; inPdfs?: boolean } | null;
	/** PDFs the source has published and those it could not download, when it has any. */
	pdfs: PdfCounts | null;
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
	/** Null while it is not counted: during an import, when it changes all the time. */
	searchable: number | null;
	/** Open record issues by code. */
	issues: Record<string, number>;
};

/** PDFs added to a source's records, and those that could not be downloaded. */
export type PdfCounts = { added: number; missed: number };

type SourceStatusBase = {
	key: string;
	provider: SourceProvider;
	/** Null while the source imports, when it is not counted. */
	searchable: number | null;
	searchFailed: number;
	/** Null until a run has changed anything. */
	changed: number | null;
	lastSuccessAt: string | null;
	issues: Record<string, number>;
	/** Null for a source without PDFs. While PDFs are added, the counts of this run. */
	pdfs: PdfCounts | null;
};

export type SourceStatus = SourceStatusBase &
	(
		| {
				state: "running";
				/** Records are imported and made searchable, then PDFs are added. */
				phase: "import" | "search" | "pdfs";
				done: number;
				/** Null when the source has not said how many records there are. */
				total: number | null;
				startedAt: string;
				minutesLeft: number | null;
		  }
		| {
				state: "failed";
				failure: { code: SourceSyncErrorCode; details: string; at: string };
				/** Set when the run stopped while adding PDFs: the records are all in. */
				failedIn?: "pdfs";
		  }
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
		pdfs: input.pdfs,
		provider: input.provider,
		searchFailed: input.searchFailed,
		searchable: input.searchable,
	};
	const run = input.activeRun;
	if (run && run.leaseExpiresAt <= input.now) {
		// Stopped while adding PDFs: the records' search update, if still waiting, comes first.
		return (run.stage === "pdfs" ? searchStatus(base, input) : null) ?? expiredLeaseStatus(base, run);
	}
	if (run?.stage === "pdfs") return pdfStageStatus(base, run, input);
	// A run that has reported nothing may only be checking for changes.
	if (run && (run.recordsDone > 0 || (run.recordsTotal ?? 0) > 0)) {
		return { ...base, ...runProgress(run, input.now), phase: "import" };
	}
	if (input.lastError) return lastErrorStatus(base, input, input.lastError);
	return searchStatus(base, input) ?? { ...base, state: input.lastSuccessAt ? "succeeded" : "idle" };
}

function expiredLeaseStatus(base: SourceStatusBase, run: NonNullable<SourceStatusInput["activeRun"]>): SourceStatus {
	return {
		...base,
		failure: {
			at: run.leaseExpiresAt.toISOString(),
			code: "interrupted",
			details: "SourceLeaseLostError: worker lease expired",
		},
		state: "failed",
		...(run.stage === "pdfs" ? { failedIn: "pdfs" as const } : {}),
	};
}

/** Stopped while adding PDFs: the records' search update, if still waiting, comes first. */
function lastErrorStatus(
	base: SourceStatusBase,
	input: SourceStatusInput,
	lastError: NonNullable<SourceStatusInput["lastError"]>,
): SourceStatus {
	return (lastError.inPdfs ? searchStatus(base, input) : null) ?? failedStatus(base, lastError);
}

function failedStatus(base: SourceStatusBase, lastError: NonNullable<SourceStatusInput["lastError"]>): SourceStatus {
	const { inPdfs, ...failure } = lastError;
	return {
		...base,
		failure: { ...failure, at: failure.at.toISOString() },
		state: "failed",
		...(inPdfs ? { failedIn: "pdfs" as const } : {}),
	};
}

function searchStatus(base: SourceStatusBase, input: SourceStatusInput): SourceStatus | null {
	const search = input.search;
	if (!search || search.done >= search.total) return null;
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

/** How far a run has got, and the time left at its own rate. */
function runProgress(run: NonNullable<SourceStatusInput["activeRun"]>, now: Date) {
	return {
		done: run.recordsDone,
		minutesLeft: minutesLeft(
			{ done: run.recordsDone, total: run.recordsTotal },
			run.recordsFrom === null || !run.recordsFromAt
				? null
				: { at: run.recordsFromAt, done: run.recordsFrom },
			now,
		),
		startedAt: run.startedAt.toISOString(),
		state: "running" as const,
		total: run.recordsTotal,
	};
}

/** A run adding PDFs: its records' search update shows first, since it came first. */
function pdfStageStatus(
	base: SourceStatusBase,
	run: NonNullable<SourceStatusInput["activeRun"]>,
	input: SourceStatusInput,
): SourceStatus {
	const missed = run.pdfsMissed ?? 0;
	return (
		searchStatus(base, input) ?? {
			...base,
			...runProgress(run, input.now),
			pdfs: { added: run.recordsDone - missed, missed },
			phase: "pdfs",
		}
	);
}

/**
 * Every imported source's status, read in one pass. Search work is counted
 * per run: all events of the runs that still have some waiting.
 */
/** How long a searchable count is reused while its source's state holds. */
const SEARCHABLE_MAX_AGE_MS = 60_000;

/** Searchable counts a caller keeps between reads, so frequent reads do not rescan idle sources. */
export type SearchableCache = Map<string, { count: number; revision: string; countedAt: number }>;

/** What a source's count depends on besides time: its state and when its runs last ended. */
function searchableRevision(status: SourceStatus) {
	const failedAt = status.state === "failed" ? status.failure.at : "";
	return `${status.state}|${status.lastSuccessAt ?? ""}|${failedAt}`;
}

const isImporting = (status: SourceStatus) => status.state === "running" && status.phase === "import";

export async function readSourceStatuses(
	database: Database,
	options: { hiddenTags: readonly string[]; now?: Date; cache?: SearchableCache },
): Promise<SourceStatus[]> {
	const now = options.now ?? new Date();
	const hiddenTags = options.hiddenTags.map((name) => name.toLowerCase());
	const [sources, states, searchRows, failedRows, issueRows] =
		await Promise.all([
			database
				.select({
					config: sourceConnection.config,
					key: sourceConnection.key,
					provider: sourceConnection.provider,
				})
				.from(sourceConnection)
				// A source dropped from the configuration stays as a removed row.
				.where(
					and(
						ne(sourceConnection.provider, NATIVE_SOURCE_CONNECTION_KEY),
						ne(sourceConnection.status, "removed"),
					),
				)
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
					runStage: sourceSyncRun.stage,
					runPdfsMissed: sourceSyncRun.pdfsMissed,
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

	const [pdfsByKey, failedStageByKey] = await Promise.all([
		readPdfCounts(database),
		readFailedStages(database),
	]);
	const stateByKey = new Map(states.map((row) => [row.key, row]));
	const searchByKey = new Map(searchRows.map((row) => [row.key, row]));
	const failedByKey = new Map(failedRows.map((row) => [row.key, row.count]));
	const issuesByKey = new Map<string, Record<string, number>>();
	for (const row of issueRows) {
		issuesByKey.set(row.key, { ...issuesByKey.get(row.key), [row.code]: row.count });
	}

	const statuses = sources.map(({ config, key, provider }) => {
		const state = stateByKey.get(key) ?? NEVER_RUN;
		return sourceStatus({
			activeRun: activeRunOf(state),
			issues: issuesByKey.get(key) ?? {},
			key,
			lastChange: state.lastChangedRecords ? { records: state.lastChangedRecords } : null,
			lastError: lastErrorOf(state, failedStageByKey.get(key) ?? null),
			lastSuccessAt: state.lastSuccessAt,
			now,
			pdfs: addsPdfs(provider, config) ? (pdfsByKey.get(key) ?? { added: 0, missed: 0 }) : null,
			provider,
			search: searchByKey.get(key) ?? null,
			searchFailed: failedByKey.get(key) ?? 0,
			searchable: 0,
		});
	});
	// Every record is read to count them, so a source mid-import is left out.
	const searchable = await searchableCounts(database, statuses, hiddenTags, now, options.cache);
	return statuses.map((status) => ({
		...status,
		searchable: isImporting(status) ? null : (searchable.get(status.key) ?? 0),
	}));
}

/**
 * Counts for the sources not mid-import. With a cache, a source is recounted
 * when its revision changed or its count is over a minute old, and a source
 * seen importing loses its cached count.
 */
async function searchableCounts(
	database: Database,
	statuses: SourceStatus[],
	hiddenTags: string[],
	now: Date,
	cache: SearchableCache | undefined,
) {
	for (const status of statuses) if (isImporting(status)) cache?.delete(status.key);
	const counted = statuses.filter((status) => !isImporting(status));
	const due = counted.filter((status) => {
		const cached = cache?.get(status.key);
		return (
			!cached ||
			cached.revision !== searchableRevision(status) ||
			now.getTime() - cached.countedAt >= SEARCHABLE_MAX_AGE_MS
		);
	});
	const fresh = await countSearchable(database, due.map(({ key }) => key), hiddenTags);
	if (!cache) return fresh;
	for (const status of due) {
		cache.set(status.key, {
			count: fresh.get(status.key) ?? 0,
			countedAt: now.getTime(),
			revision: searchableRevision(status),
		});
	}
	return new Map(counted.map(({ key }) => [key, cache.get(key)?.count ?? 0]));
}

/** Whether any source is importing or has search work waiting: cheap enough to ask every few seconds. */
export async function hasSourceActivity(database: Database, now = new Date()) {
	// A dead worker's lease on a source paused since is not work under way.
	const [running] = await database
		.select({ key: sourceSyncState.sourceConnectionKey })
		.from(sourceSyncState)
		.innerJoin(sourceConnection, eq(sourceConnection.key, sourceSyncState.sourceConnectionKey))
		.where(
			and(
				isNotNull(sourceSyncState.activeRunId),
				gt(sourceSyncState.leaseExpiresAt, now),
				eq(sourceConnection.status, "active"),
			),
		)
		.limit(1);
	if (running) return true;
	const [waiting] = await database
		.select({ id: outbox.id })
		.from(outbox)
		.where(
			and(
				isNotNull(outbox.sourceSyncRunId),
				isNull(outbox.processedAt),
				isNull(outbox.deadLetteredAt),
			),
		)
		.limit(1);
	return waiting !== undefined;
}

/**
 * Records each source has in the public library, by the search projection's
 * rule. Counted only for the sources that show it: this reads every record.
 */
async function countSearchable(
	database: Database,
	sourceKeys: string[],
	hiddenTags: string[],
): Promise<Map<string, number>> {
	if (sourceKeys.length === 0) return new Map();
	const rows = await database
		.select({
			count: sql<number>`count(*)::int`,
			key: itemSourceLink.sourceConnectionKey,
		})
		.from(itemSourceLink)
		.innerJoin(item, eq(item.key, itemSourceLink.itemKey))
		.where(
			and(
				inArray(itemSourceLink.sourceConnectionKey, sourceKeys),
				// A record the source withdrew stays public through another source.
				eq(itemSourceLink.remoteDeleted, false),
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
		.groupBy(itemSourceLink.sourceConnectionKey);
	return new Map(rows.map((row) => [row.key, row.count]));
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
	runStage: "pdfs" | null;
	runPdfsMissed: number | null;
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
	runStage: null,
	runPdfsMissed: null,
};

function activeRunOf(state: SyncStateRow): SourceStatusInput["activeRun"] {
	if (!state.runStartedAt || !state.leaseExpiresAt) return null;
	return {
		leaseExpiresAt: state.leaseExpiresAt,
		recordsDone: state.recordsDone ?? 0,
		recordsFrom: state.recordsFrom,
		recordsFromAt: state.recordsFromAt,
		recordsTotal: state.recordsTotal,
		stage: state.runStage,
		pdfsMissed: state.runPdfsMissed,
		startedAt: state.runStartedAt,
	};
}

function lastErrorOf(state: SyncStateRow, failedStage: "pdfs" | null): SourceStatusInput["lastError"] {
	if (!state.lastError || !state.lastFailureAt) return null;
	return {
		at: state.lastFailureAt,
		// Failures saved before codes existed.
		code: state.lastErrorCode ?? "internal",
		details: state.lastError,
		inPdfs: failedStage === "pdfs",
	};
}

/** Sources of OpenAlex works add PDFs to their records when the configuration asks. */
function addsPdfs(provider: SourceProvider, config: unknown) {
	return (
		isOpenAlexWorkProvider(provider) &&
		typeof config === "object" &&
		config !== null &&
		"downloadPdfs" in config &&
		config.downloadPdfs === true
	);
}

const PDF_ISSUE_CODES = ["openalex_pdf_download_failed", "openalex_pdf_invalid", "openalex_pdf_storage_failed"];

/**
 * Each source's published PDFs and open PDF issues, for sources that have
 * either. A PDF counts for every source holding the record, not only the one
 * that published it.
 */
async function readPdfCounts(database: Database): Promise<Map<string, PdfCounts>> {
	const [published, missed] = await Promise.all([
		database
			.select({ count: sql<number>`count(*)::int`, key: itemSourceLink.sourceConnectionKey })
			.from(itemSourceLink)
			.innerJoin(itemFilePublication, eq(itemFilePublication.itemKey, itemSourceLink.itemKey))
			.where(eq(itemSourceLink.remoteDeleted, false))
			.groupBy(itemSourceLink.sourceConnectionKey),
		database
			.select({ count: sql<number>`count(*)::int`, key: sourceRecordIssue.sourceConnectionKey })
			.from(sourceRecordIssue)
			.where(and(isNull(sourceRecordIssue.dismissedAt), inArray(sourceRecordIssue.code, PDF_ISSUE_CODES)))
			.groupBy(sourceRecordIssue.sourceConnectionKey),
	]);
	const counts = new Map<string, PdfCounts>();
	for (const row of published) counts.set(row.key, { added: row.count, missed: 0 });
	for (const row of missed) counts.set(row.key, { added: counts.get(row.key)?.added ?? 0, missed: row.count });
	return counts;
}

/** The stage each source's latest failed run stopped in. */
async function readFailedStages(database: Database): Promise<Map<string, "pdfs" | null>> {
	const rows = await database
		.selectDistinctOn([sourceSyncRun.sourceConnectionKey], {
			key: sourceSyncRun.sourceConnectionKey,
			stage: sourceSyncRun.stage,
		})
		.from(sourceSyncRun)
		.where(eq(sourceSyncRun.status, "failed"))
		.orderBy(sourceSyncRun.sourceConnectionKey, desc(sourceSyncRun.finishedAt));
	return new Map(rows.map((row) => [row.key, row.stage]));
}
