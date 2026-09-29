import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { itemSourceLink } from "@opendeved/evidence-library-core";
import { item } from "@/db/schema/tables/item";
import { reconcileOpenAlexMemberships } from "./reconciliation";
import type { SourceAdapterContext, SourceConnection } from "../adapter";
import { nightlyScheduleForDate } from "@/lib/nightly-schedule";
import { SourceCredentialNotFoundError } from "../credentials";
import {
	MAX_INSTITUTION_FACTS,
	MAX_SOURCE_BATCH_BYTES,
	type JsonValue,
	type SourceItemUpsert,
} from "../batch-schema";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { OpenAlexApiError, OpenAlexClient } from "./client";
import { mapOpenAlexWork } from "./mapper";
import { MIN_SLICED_WORKS, planSlices, slicedQuery } from "./slices";
import { OPENALEX_MAX_PAGE_SIZE } from "./schema";
import { chunkValues } from "@/lib/chunk-values";
import { openAlexConnectionConfigSchema } from "./schema";

const cursorSchema = z
	.object({
		queryVersion: z.string(),
		startedAt: z.iso.datetime(),
		nextCursor: z.string().nullable(),
		imported: z.number().int().nonnegative(),
		completedAt: z.iso.datetime().nullable(),
		mode: z.enum(["full", "incremental"]).default("full"),
		reconciledAt: z.iso.datetime().nullable().default(null),
		updatedSince: z.string().nullable().default(null),
		incrementalAvailable: z.boolean().nullable().default(null),
		// Records are imported first, then a second scan adds their PDFs.
		stage: z.enum(["records", "pdfs"]).default("records"),
		pdfs: z
			.object({
				done: z.number().int().nonnegative(),
				missed: z.number().int().nonnegative(),
				// Null for a nightly refresh, which only looks at updated works.
				total: z.number().int().nonnegative().nullable(),
			})
			.nullable()
			.default(null),
		// A full scan of a large query reads date slices at once, each with its own cursor.
		// Only a sliced scan saves the key, so other cursors stay readable by older releases.
		slices: z
			.array(
				z.object({
					dates: z.object({ from: z.string().nullable(), to: z.string().nullable() }).nullable(),
					nextCursor: z.string().nullable(),
					// Works in the slice when it was planned, for the import's total.
					count: z.number().int().nonnegative(),
				}),
			)
			.optional(),
	})
	.strict();

export type OpenAlexSourceOptions = {
	fetch?: typeof fetch;
	sleep?: (milliseconds: number) => Promise<void>;
	attachmentProcessor?: RecordProcessor & {
		/** Keeps a PDF already published, without downloading. */
		reuse: RecordProcessor;
		flushCleanup: (sourceConnectionKey: string) => Promise<void>;
	};
};

type RecordProcessor = (
	record: SourceItemUpsert,
	sourceConnectionKey: string,
) => Promise<SourceItemUpsert>;
type Cursor = z.infer<typeof cursorSchema>;
type OpenAlexConnectionConfig = z.infer<typeof openAlexConnectionConfigSchema>;
type InstitutionFacts = ReturnType<typeof mapOpenAlexWork>["institutions"];

const DAY_MS = 24 * 3600_000;
/** When OpenAlex sources refresh each night: incrementally, and in full once a week. */
const OPENALEX_NIGHTLY_UTC_TIME = "02:00";

/** The most recent nightly refresh time at or before `now`. */
function lastNightlyRefresh(now: Date) {
	const tonight = nightlyScheduleForDate(OPENALEX_NIGHTLY_UTC_TIME, now).getTime();
	return now.getTime() < tonight ? tonight - DAY_MS : tonight;
}

/**
 * A full scan is due on the seventh night after the last one. Counting nights
 * rather than hours keeps it weekly even though a scan finishes after 02:00.
 */
export function openAlexFullScanDue(reconciledAt: string, now: Date) {
	return Date.parse(reconciledAt) < lastNightlyRefresh(now) - 6 * DAY_MS;
}
const UPDATED_SINCE = "from_updated_date:";
const RECORD_PAGE_SIZE = OPENALEX_MAX_PAGE_SIZE;
// Each slice waits about 4 seconds per page, so sixteen keep the writer busy.
const SLICE_CONCURRENCY = 16;
// Fetched pages waiting for the writer, about 2 MB each.
const QUEUED_PAGES = 8;
const PDF_PAGE_SIZE = 50;
const PDF_CONCURRENCY = 6;
// Leaves room for the batch envelope and institution facts.
const WRITE_BUDGET_BYTES = MAX_SOURCE_BATCH_BYTES - 4 * 1024 * 1024;

async function openAlexClient(
	context: SourceAdapterContext,
	config: OpenAlexConnectionConfig,
	options: OpenAlexSourceOptions,
) {
	const connection = context.sourceConnection;
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey) throw new SourceCredentialNotFoundError(connection.key);
	if (config.downloadPdfs && !options.attachmentProcessor)
		throw new Error(
			"OpenAlex PDF processing is enabled but no processor is available",
		);
	return new OpenAlexClient({
		apiKey,
		fetch: options.fetch,
		sleep: options.sleep,
	});
}

/** A reconciled full scan from this week lets the next run fetch only updated works. */
function incrementalSince(saved: Cursor | null, queryVersion: string) {
	if (
		!saved?.completedAt ||
		saved.queryVersion !== queryVersion ||
		!saved.reconciledAt ||
		openAlexFullScanDue(saved.reconciledAt, new Date()) ||
		saved.incrementalAvailable === false
	)
		return null;
	return new Date(Date.parse(saved.startedAt) - DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/** A sample of the updated works is not part of the approved sample, so sampled OQL always scans in full. */
function isSampledOql(query: OpenAlexConnectionConfig["approvedQuery"]["query"]) {
	return Boolean(query.oql && /\ssample\s+\d+(?:\s+seed\s+\d+)?\s*$/i.test(query.oql));
}

/** PDFs were turned on after the last complete run, so no PDF stage has covered the records yet. */
function pdfsOwed(config: OpenAlexConnectionConfig, saved: Cursor | null) {
	return config.downloadPdfs && Boolean(saved?.completedAt) && saved?.stage !== "pdfs";
}

/** PDFs turned off mid-stage: only a full records scan puts every page back on its external link. */
function pdfsDropped(config: OpenAlexConnectionConfig, saved: Cursor | null) {
	return saved?.stage === "pdfs" && !saved.completedAt && !config.downloadPdfs;
}

function resumedCursor(saved: Cursor | null, config: OpenAlexConnectionConfig): Cursor | null {
	if (!saved || saved.completedAt || saved.queryVersion !== config.approvedQuery.version) return null;
	if (pdfsDropped(config, saved)) return null;
	return saved.mode === "full" ? { ...saved, incrementalAvailable: null } : saved;
}

function startCursor(saved: Cursor | null, config: OpenAlexConnectionConfig): Cursor {
	const resumed = resumedCursor(saved, config);
	if (resumed) return resumed;
	const queryVersion = config.approvedQuery.version;
	const sameQuery = saved?.queryVersion === queryVersion;
	// A sample of updated works is a different sample; PDFs just turned on need every record.
	const fullOnly =
		isSampledOql(config.approvedQuery.query) || pdfsOwed(config, saved) || pdfsDropped(config, saved);
	const cursor: Cursor = {
		queryVersion,
		startedAt: new Date().toISOString(),
		nextCursor: "*",
		imported: 0,
		completedAt: null,
		mode: "full",
		reconciledAt: sameQuery ? saved!.reconciledAt : null,
		updatedSince: null,
		incrementalAvailable: null,
		stage: "records",
		pdfs: null,
	};
	const updatedSince = fullOnly ? null : incrementalSince(saved, queryVersion);
	return updatedSince
		? {
				...cursor,
				mode: "incremental",
				updatedSince,
				incrementalAvailable: saved!.incrementalAvailable,
			}
		: cursor;
}

/**
 * The regular sweep refreshes a source once a night. A new source, a changed
 * query and an unfinished run go ahead straight away.
 */
export function openAlexSyncIsDue(connection: SourceConnection, now: Date) {
	const config = openAlexConnectionConfigSchema.safeParse(connection.config);
	const saved = cursorSchema.safeParse(connection.syncCursor);
	// Let the run report what is wrong with a configuration or cursor it cannot read.
	if (!config.success || !saved.success) return true;
	if (!saved.data.completedAt) return true;
	if (saved.data.queryVersion !== config.data.approvedQuery.version) return true;
	if (pdfsOwed(config.data, saved.data)) return true;
	return Date.parse(saved.data.startedAt) < lastNightlyRefresh(now);
}

function pageQuery(config: OpenAlexConnectionConfig, cursor: Cursor) {
	const query = config.approvedQuery.query;
	if (cursor.mode !== "incremental") return query;
	if (query.oql) {
		const where = query.oql.replace(/^works\s+where\s+/i, "");
		return {
			oql: `works where (${where}) and from_updated_date is (${cursor.updatedSince})`,
		};
	}
	const clauses = (query.filter ?? "").split(",").filter(Boolean);
	const previousSince = clauses
		.find((clause) => clause.startsWith(UPDATED_SINCE))
		?.slice(UPDATED_SINCE.length);
	const since = [previousSince, cursor.updatedSince]
		.filter((value): value is string => Boolean(value))
		.sort()
		.at(-1);
	return {
		...query,
		filter: [
			...clauses.filter((clause) => !clause.startsWith(UPDATED_SINCE)),
			`${UPDATED_SINCE}${since}`,
		].join(","),
	};
}

function isEntitlementDenial(error: unknown): error is OpenAlexApiError {
	return (
		error instanceof OpenAlexApiError &&
		[400, 403].includes(error.status ?? 0) &&
		/premium|paid|from_updated_date/i.test(error.message)
	);
}

/** Returns null when the key cannot use incremental sync. */
async function fetchPage(
	client: OpenAlexClient,
	config: OpenAlexConnectionConfig,
	cursor: Cursor,
	sourceConnectionKey: string,
) {
	try {
		return await client.works(
			pageQuery(config, cursor),
			cursor.nextCursor!,
			cursor.stage === "pdfs" ? PDF_PAGE_SIZE : RECORD_PAGE_SIZE,
		);
	} catch (error) {
		// Free keys use complete scans. Only an explicit entitlement denial changes strategy.
		if (cursor.mode !== "incremental" || !isEntitlementDenial(error))
			throw error;
		console.info(
			"OpenAlex key does not support incremental sync; scanning the approved query",
			{ sourceConnectionKey, status: error.status },
		);
		return null;
	}
}

// Downloads take most of the PDF time, so several run at once. The cap
// bounds PDF buffers and renderer memory.
async function processAttachments(
	context: SourceAdapterContext,
	items: SourceItemUpsert[],
	processor: RecordProcessor,
) {
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			const index = next++;
			if (!items[index]!.file?.url) continue;
			await context.heartbeat();
			items[index] = await processor(
				items[index]!,
				context.sourceConnection.key,
			);
		}
	};
	// After a failure, start no more PDFs but let running ones finish before
	// the run gives up its lease.
	const results = await Promise.allSettled(
		Array.from({ length: PDF_CONCURRENCY }, () =>
			worker().catch((error: unknown) => {
				failed = true;
				throw error;
			}),
		),
	);
	const rejected = results.find((result) => result.status === "rejected");
	if (rejected) throw rejected.reason;
}

/** Splits a page into writes under the batch limit, keeping record order. */
function writeChunks(items: SourceItemUpsert[]) {
	const chunks: SourceItemUpsert[][] = [[]];
	let bytes = 0;
	for (const record of items) {
		const size = Buffer.byteLength(JSON.stringify(record), "utf8");
		if (bytes + size > WRITE_BUDGET_BYTES && chunks.at(-1)!.length) {
			chunks.push([]);
			bytes = 0;
		}
		chunks.at(-1)!.push(record);
		bytes += size;
	}
	return chunks;
}

// Only the last write moves the cursor on, so a retry fetches the page again.
async function writePage(
	context: SourceAdapterContext,
	expectedCursor: Record<string, JsonValue>,
	nextCursor: Record<string, JsonValue>,
	page: { items: SourceItemUpsert[]; institutionCountries: InstitutionFacts },
	stage: Cursor["stage"],
) {
	const chunks = writeChunks(page.items);
	// A page of works with many affiliations can carry more facts than one write takes.
	const facts = chunkValues(page.institutionCountries, MAX_INSTITUTION_FACTS);
	const writes = Math.max(chunks.length, facts.length);
	for (let index = 0; index < writes; index++) {
		await writeBatch(
			context,
			expectedCursor,
			index === writes - 1 ? nextCursor : expectedCursor,
			{ items: chunks[index] ?? [], institutionCountries: facts[index] ?? [] },
			stage,
		);
	}
}

/**
 * Works the PDF stage finds that the records stage did not write, because
 * OpenAlex added them since. Their search update is the run's, like any
 * record's; PDFs added to known records are not.
 */
async function splitNewRecords(scan: Scan, items: SourceItemUpsert[]) {
	if (scan.cursor.stage !== "pdfs" || !items.length) return { fresh: [], known: items };
	const rows = await scan.context.database
		.select({ key: itemSourceLink.sourceRecordKey })
		.from(itemSourceLink)
		.where(
			and(
				eq(itemSourceLink.sourceConnectionKey, scan.context.sourceConnection.key),
				// A withdrawn work that comes back is new to search again.
				eq(itemSourceLink.remoteDeleted, false),
				inArray(itemSourceLink.sourceRecordKey, items.map((record) => record.sourceRecordKey)),
			),
		);
	const known = new Set(rows.map((row) => row.key));
	return {
		fresh: items.filter((record) => !known.has(record.sourceRecordKey)),
		known: items.filter((record) => known.has(record.sourceRecordKey)),
	};
}

function logPdfPage(
	sourceConnectionKey: string,
	works: number,
	items: SourceItemUpsert[],
	startedAt: number,
) {
	const pdfs = items.filter((record) => record.file?.url);
	const failed = pdfs.filter((record) => record.processingIssue).length;
	console.info("OpenAlex PDF page processed", {
		sourceConnectionKey,
		works,
		pdfs: pdfs.length,
		published: pdfs.length - failed,
		failed,
		seconds: (performance.now() - startedAt) / 1000,
	});
}

function writeBatch(
	context: SourceAdapterContext,
	expectedCursor: Record<string, JsonValue>,
	nextCursor: Record<string, JsonValue>,
	batch: {
		items: SourceItemUpsert[];
		institutionCountries?: InstitutionFacts;
	},
	stage: Cursor["stage"] = "records",
) {
	const connection = context.sourceConnection;
	return writeSourceIngestionBatch(context.database, {
		sourceConnectionKey: connection.key,
		expectedConfiguration: connection.config,
		expectedCursor,
		nextCursor,
		mappingProfileVersion: "openalex-v1",
		// The records' search update is the run's; records changed by their
		// PDFs are updated in search like any other edit.
		sourceSyncRunId: stage === "records" ? context.run?.id : undefined,
		fetchedAt: new Date(),
		...batch,
	});
}

/** PDF links among a source's records: what its PDF stage works through. */
async function countPdfLinks(database: SourceAdapterContext["database"], sourceConnectionKey: string) {
	const [row] = await database
		.select({ count: sql<number>`count(*)::int` })
		.from(itemSourceLink)
		.innerJoin(item, eq(item.key, itemSourceLink.itemKey))
		.where(
			and(
				eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey),
				eq(itemSourceLink.remoteDeleted, false),
				eq(item.itemType, "Attachment"),
				eq(item.contentType, "application/pdf"),
			),
		);
	return row?.count ?? 0;
}

const isPdfLink = (record: SourceItemUpsert) =>
	record.metadata.itemType === "Attachment" &&
	record.file?.contentType === "application/pdf" &&
	Boolean(record.file.url);

type Scan = {
	context: SourceAdapterContext;
	client: OpenAlexClient;
	config: OpenAlexConnectionConfig;
	options: OpenAlexSourceOptions;
	cursor: Cursor;
	expectedCursor: Record<string, JsonValue>;
	pages: number;
};

/**
 * Records first: a page is written as soon as it is fetched, keeping only PDFs
 * already published. The PDF stage then adds the rest, page by page.
 */
async function preparePage(scan: Scan, items: SourceItemUpsert[], works: number) {
	const processor = scan.options.attachmentProcessor;
	if (!scan.config.downloadPdfs || !processor) return;
	const key = scan.context.sourceConnection.key;
	if (scan.cursor.stage === "records") {
		await processAttachments(scan.context, items, processor.reuse);
		return;
	}
	const links = new Set(items.filter(isPdfLink).map((record) => record.sourceRecordKey));
	const startedAt = performance.now();
	await processAttachments(scan.context, items, processor);
	logPdfPage(key, works, items, startedAt);
	const pdfs = scan.cursor.pdfs!;
	const done = pdfs.done + links.size;
	// Other records' issues, such as incomplete authors, are not PDFs missed.
	const missed = items.filter(
		(record) => links.has(record.sourceRecordKey) && record.processingIssue,
	).length;
	// A new cursor: the saved one is still what the next write expects.
	scan.cursor = {
		...scan.cursor,
		pdfs: {
			done,
			missed: pdfs.missed + missed,
			total: pdfs.total === null ? null : Math.max(pdfs.total, done),
		},
	};
}

async function reportProgress(scan: Scan, count: number) {
	const { cursor, context } = scan;
	if (cursor.stage === "pdfs") {
		const pdfs = cursor.pdfs!;
		await context.run?.report(pdfs.done, pdfs.total, { missed: pdfs.missed });
		return;
	}
	// A resumed import can pass a count that shrank since it started.
	await context.run?.report(cursor.imported, Math.max(count, cursor.imported));
}

/** Incremental access was refused: scan the whole query instead. */
function fullScanCursor(cursor: Cursor): Cursor {
	return {
		...cursor,
		mode: "full",
		nextCursor: "*",
		startedAt: new Date().toISOString(),
		imported: 0,
		updatedSince: null,
		incrementalAvailable: false,
		// A full PDF pass would skip reconciling, so the records go first again.
		stage: "records",
		pdfs: null,
	};
}

function assertAdvancing(
	page: { meta: { next_cursor: string | null }; results: unknown[] },
	cursor: string | null,
	sourceConnectionKey: string,
) {
	if (page.meta.next_cursor === cursor || (!page.results.length && page.meta.next_cursor)) {
		throw new Error(`OpenAlex source ${sourceConnectionKey} returned a non-advancing page`);
	}
}

/** Fetches and writes every page of the cursor's stage. */
async function scanPages(scan: Scan) {
	const { context, client, config } = scan;
	const connection = context.sourceConnection;
	while (scan.cursor.nextCursor && !scan.cursor.slices) {
		await context.heartbeat();
		const page = await fetchPage(client, config, scan.cursor, connection.key);
		if (!page) {
			scan.cursor = fullScanCursor(scan.cursor);
			continue;
		}
		if (scan.cursor.mode === "incremental") scan.cursor = { ...scan.cursor, incrementalAvailable: true };
		assertAdvancing(page, scan.cursor.nextCursor, connection.key);
		if (await switchToSlices(scan, page.meta.count)) return;
		// The total is known from the page; say it before slow PDF work starts.
		await reportProgress(scan, page.meta.count);
		const mapped = page.results.map(mapOpenAlexWork);
		const items = mapped.flatMap((work) => work.items);
		await preparePage(scan, items, page.results.length);
		scan.cursor = {
			...scan.cursor,
			nextCursor: page.meta.next_cursor,
			imported:
				scan.cursor.stage === "records"
					? scan.cursor.imported + page.results.length
					: scan.cursor.imported,
			completedAt: null,
		};
		await context.heartbeat();
		const { fresh, known } = await splitNewRecords(scan, items);
		// New works go in first, without moving the cursor on.
		if (fresh.length) {
			await writePage(context, scan.expectedCursor, scan.expectedCursor, { items: fresh, institutionCountries: [] }, "records");
		}
		await writePage(
			context,
			scan.expectedCursor,
			scan.cursor,
			{ items: known, institutionCountries: mapped.flatMap((work) => work.institutions) },
			scan.cursor.stage,
		);
		scan.expectedCursor = scan.cursor;
		scan.pages++;
		await reportProgress(scan, page.meta.count);
		await scan.options.attachmentProcessor?.flushCleanup(connection.key);
	}
}

type SlicePage = { slice: number; nextCursor: string | null; works: number; mapped: ReturnType<typeof mapOpenAlexWork>[] };

/** Pages waiting for the writer. Fetchers wait while it is full, which bounds memory. */
function pageQueue(limit: number) {
	const pages: SlicePage[] = [];
	let closed = false;
	let failure: unknown;
	let wakeWriter: (() => void) | null = null;
	const waitingFetchers: (() => void)[] = [];
	return {
		async put(page: SlicePage) {
			while (pages.length >= limit && !closed) await new Promise<void>((wake) => waitingFetchers.push(wake));
			if (closed) return false;
			pages.push(page);
			wakeWriter?.();
			return true;
		},
		// Pages fetched before a failure are still written, so a restart has less to fetch.
		async take() {
			for (;;) {
				if (pages.length) {
					waitingFetchers.shift()?.();
					return pages.shift()!;
				}
				if (failure) throw failure;
				if (closed) return null;
				await new Promise<void>((wake) => (wakeWriter = wake));
				wakeWriter = null;
			}
		},
		close(error?: unknown) {
			closed = true;
			failure ??= error;
			wakeWriter?.();
			for (const wake of waitingFetchers.splice(0)) wake();
		},
	};
}

/** Fetches one slice's pages in order, handing each to the writer, until the scan stops. */
async function fetchSlice(scan: Scan, slice: number, queue: ReturnType<typeof pageQueue>, stop: { stopped: boolean }) {
	const { dates, nextCursor } = scan.cursor.slices![slice]!;
	const query = slicedQuery(scan.config.approvedQuery.query, dates);
	let cursor = nextCursor;
	while (cursor && !stop.stopped) {
		const page = await scan.client.works(query, cursor, RECORD_PAGE_SIZE);
		assertAdvancing(page, cursor, scan.context.sourceConnection.key);
		cursor = page.meta.next_cursor;
		const handed = await queue.put({
			slice,
			nextCursor: cursor,
			works: page.results.length,
			mapped: page.results.map(mapOpenAlexWork),
		});
		if (!handed) return;
	}
}

/** Writes one fetched page and moves only its slice's cursor on. */
async function writeSlicePage(scan: Scan, page: SlicePage, total: number) {
	const { context } = scan;
	await context.heartbeat();
	const items = page.mapped.flatMap((work) => work.items);
	await preparePage(scan, items, page.works);
	const slices = scan.cursor.slices!.map((slice, index) =>
		index === page.slice ? { ...slice, nextCursor: page.nextCursor } : slice,
	);
	scan.cursor = {
		...scan.cursor,
		slices,
		imported: scan.cursor.imported + page.works,
		nextCursor: slices.some((slice) => slice.nextCursor) ? scan.cursor.nextCursor : null,
		completedAt: null,
	};
	await writePage(context, scan.expectedCursor, scan.cursor, {
		items,
		institutionCountries: page.mapped.flatMap((work) => work.institutions),
	}, "records");
	scan.expectedCursor = scan.cursor;
	scan.pages++;
	await reportProgress(scan, total);
	await scan.options.attachmentProcessor?.flushCleanup(context.sourceConnection.key);
}

/**
 * Fetches the slices at the same time while one writer saves their pages, so
 * the import waits on OpenAlex far less. A restart resumes every slice.
 */
async function scanSlices(scan: Scan) {
	const queue = pageQueue(QUEUED_PAGES);
	const total = scan.cursor.slices!.reduce((sum, slice) => sum + slice.count, 0);
	const open = scan.cursor.slices!.flatMap((slice, index) => (slice.nextCursor ? [index] : []));
	// After a failure no fetcher starts another request, but pages already
	// fetched still reach the writer before the error does.
	const stop = { stopped: false };
	let failure: unknown;
	let next = 0;
	const fetcher = async () => {
		while (!stop.stopped && next < open.length) await fetchSlice(scan, open[next++]!, queue, stop);
	};
	const fetching = Promise.allSettled(
		Array.from({ length: Math.min(SLICE_CONCURRENCY, open.length) }, () =>
			fetcher().catch((error: unknown) => {
				stop.stopped = true;
				failure ??= error;
			}),
		),
	).then(() => queue.close(failure));
	try {
		for (let page = await queue.take(); page; page = await queue.take()) {
			await writeSlicePage(scan, page, total);
		}
	} finally {
		// The writer finished or failed: stop the fetchers and wait for every one.
		stop.stopped = true;
		queue.close();
		await fetching;
	}
}

/**
 * A new full scan whose first page shows a large query is split into date
 * slices, saved so a restart keeps them. That first page is fetched again
 * by its slice.
 */
async function switchToSlices(scan: Scan, count: number) {
	const { cursor, config, context } = scan;
	if (cursor.stage !== "records" || cursor.mode !== "full" || cursor.nextCursor !== "*" || cursor.imported) return false;
	if (count < MIN_SLICED_WORKS || isSampledOql(config.approvedQuery.query)) return false;
	const slices = await planSlices(scan.client, config.approvedQuery.query).catch((error: unknown) => {
		console.warn("OpenAlex slice planning failed; scanning the query as one stream", {
			sourceConnectionKey: context.sourceConnection.key,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	});
	if (!slices) return false;
	scan.cursor = { ...cursor, slices: slices.map((slice) => ({ ...slice, nextCursor: "*" })) };
	await writeBatch(context, scan.expectedCursor, scan.cursor, { items: [] });
	scan.expectedCursor = scan.cursor;
	return true;
}

async function reconcile(scan: Scan) {
	const connection = scan.context.sourceConnection;
	while (
		scan.cursor.mode === "full" &&
		(await reconcileOpenAlexMemberships(scan.context.database, {
			sourceConnectionKey: connection.key,
			configuration: connection.config,
			cursor: scan.expectedCursor,
			startedAt: scan.cursor.startedAt,
			sourceSyncRunId: scan.context.run?.id,
		}))
	)
		await scan.context.heartbeat();
}

/** Starts the PDF stage over the same query, once every record is in. */
async function startPdfStage(scan: Scan) {
	const total =
		scan.cursor.mode === "full"
			? await countPdfLinks(scan.context.database, scan.context.sourceConnection.key)
			: null;
	const { slices: _finished, ...records } = scan.cursor;
	scan.cursor = {
		...records,
		stage: "pdfs",
		nextCursor: "*",
		pdfs: { done: 0, missed: 0, total },
	};
	await writeBatch(scan.context, scan.expectedCursor, scan.cursor, { items: [] }, "pdfs");
	scan.expectedCursor = scan.cursor;
}

/** Records, then PDFs. A PDF stage that falls back to a full scan starts over from the records. */
async function scanStages(scan: Scan) {
	for (;;) {
		if (scan.cursor.stage === "records") {
			await scanPages(scan);
			if (scan.cursor.slices) await scanSlices(scan);
			await reconcile(scan);
			if (!scan.config.downloadPdfs) return;
			await startPdfStage(scan);
		}
		// Said before the first page, so a failure there still reads as the PDF stage.
		await reportProgress(scan, 0);
		await scanPages(scan);
		if (scan.cursor.stage === "pdfs") return;
	}
}

export async function syncOpenAlexSource(
	context: SourceAdapterContext,
	options: OpenAlexSourceOptions = {},
) {
	const connection = context.sourceConnection;
	const config = openAlexConnectionConfigSchema.parse(connection.config);
	const client = await openAlexClient(context, config, options);
	const expectedCursor = connection.syncCursor as Record<string, JsonValue>;
	const saved = Object.keys(expectedCursor).length ? cursorSchema.parse(expectedCursor) : null;
	const scan: Scan = {
		context,
		client,
		config,
		options,
		expectedCursor,
		cursor: startCursor(saved, config),
		pages: 0,
	};
	await options.attachmentProcessor?.flushCleanup(connection.key);
	await scanStages(scan);
	const cursor: Cursor = {
		...scan.cursor,
		completedAt: new Date().toISOString(),
		reconciledAt:
			scan.cursor.mode === "full"
				? new Date().toISOString()
				: scan.cursor.reconciledAt,
	};
	await writeBatch(context, scan.expectedCursor, cursor, { items: [] }, cursor.stage);
	return {
		records: cursor.imported,
		pages: scan.pages,
		queryVersion: cursor.queryVersion,
		completedAt: cursor.completedAt,
	};
}
