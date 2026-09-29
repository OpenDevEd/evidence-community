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
import { OPENALEX_MAX_PAGE_SIZE, openAlexConnectionConfigSchema, type OpenAlexPage, type OpenAlexQuery } from "./schema";
import { chunkValues } from "@/lib/chunk-values";

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
		// PDFs were added since the last full scan that left them out, so turning them off must take them down.
		pdfsAdded: z.literal(true).optional(),
		// A full scan of a large query reads date slices at once, each with its own cursor.
		// Only a sliced scan saves the key, so other cursors stay readable by older releases.
		slices: z
			.array(
				z.object({
					dates: z.object({ from: z.string().nullable(), to: z.string().nullable() }).nullable(),
					// Where a list of works' part starts in the list; queries split by dates instead.
					offset: z.number().int().nonnegative().optional(),
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
		/** Time spent per publishing step since the last call, for the page log. */
		takeTimings?: (sourceConnectionKey: string) => unknown;
	};
};

type RecordProcessor = (
	record: SourceItemUpsert,
	sourceConnectionKey: string,
) => Promise<SourceItemUpsert>;
type Cursor = z.infer<typeof cursorSchema>;
type Slice = NonNullable<Cursor["slices"]>[number];
type SlicePlan = Omit<Slice, "nextCursor">;
type InstitutionFacts = ReturnType<typeof mapOpenAlexWork>["institutions"];

/**
 * Where an import reads its works: one approved query, or the works an
 * OpenScholar collection lists. Everything else about an import, from
 * incremental refreshes to the PDF stage, is the same for both.
 */
export type OpenAlexWorkStream = {
	/** What the stream covers. A new version starts a full scan, which withdraws works it no longer finds. */
	version: string;
	downloadPdfs: boolean;
	/** Every scan reads everything, as for a sample, where the updated works are a different sample. */
	fullScansOnly: boolean;
	/** One page of works: "*" asks for the first, and `updatedSince` keeps works updated since that day. */
	page: (client: OpenAlexClient, cursor: string, pageSize: number, updatedSince: string | null) => Promise<OpenAlexPage>;
	/** Splits a new full scan of `count` works into parts read at the same time, or null to read it as one stream. */
	planSlices: (client: OpenAlexClient, count: number) => Promise<SlicePlan[] | null>;
	/** One page of a planned part. */
	slicePage: (client: OpenAlexClient, slice: Slice, cursor: string) => Promise<OpenAlexPage>;
};

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
// A page waits for its slowest download, so larger pages leave fewer such waits.
const PDF_PAGE_SIZE = OPENALEX_MAX_PAGE_SIZE;
const PDF_CONCURRENCY = 48;
// More at once and some publishers answer 429.
const PDF_PER_HOST = 4;
// A page is written once its slowest PDF is done, which in production can take a
// minute or two. With three pages in flight such waits left most lanes idle.
const PDF_PAGES_IN_FLIGHT = 8;
// Leaves room for the batch envelope and institution facts.
const WRITE_BUDGET_BYTES = MAX_SOURCE_BATCH_BYTES - 4 * 1024 * 1024;

async function openAlexClient(
	context: SourceAdapterContext,
	downloadPdfs: boolean,
	options: OpenAlexSourceOptions,
) {
	const connection = context.sourceConnection;
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey) throw new SourceCredentialNotFoundError(connection.key);
	if (downloadPdfs && !options.attachmentProcessor)
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
function isSampledOql(query: OpenAlexQuery) {
	return Boolean(query.oql && /\ssample\s+\d+(?:\s+seed\s+\d+)?\s*$/i.test(query.oql));
}

/** PDFs were turned on after the last complete run, so no PDF stage has covered the records yet. */
function pdfsOwed(stream: Pick<OpenAlexWorkStream, "downloadPdfs">, saved: Cursor | null) {
	return stream.downloadPdfs && Boolean(saved?.completedAt) && saved?.stage !== "pdfs";
}

/**
 * PDFs turned off after a run added them, or while it was adding them: only a
 * full records scan puts every record back on its external link.
 */
function pdfsDropped(stream: Pick<OpenAlexWorkStream, "downloadPdfs">, saved: Cursor | null) {
	return !stream.downloadPdfs && (saved?.stage === "pdfs" || saved?.pdfsAdded === true);
}

function resumedCursor(saved: Cursor | null, stream: OpenAlexWorkStream): Cursor | null {
	if (!saved || saved.completedAt || saved.queryVersion !== stream.version) return null;
	if (pdfsDropped(stream, saved)) return null;
	return saved.mode === "full" ? { ...saved, incrementalAvailable: null } : saved;
}

/** PDFs just turned on or off need every record, and so does a sample. */
function mustScanInFull(stream: OpenAlexWorkStream, saved: Cursor | null) {
	return stream.fullScansOnly || pdfsOwed(stream, saved) || pdfsDropped(stream, saved);
}

/** Added PDFs are remembered while PDFs stay on; a scan with them off takes them all down. */
function carriedPdfs(saved: Cursor | null, stream: OpenAlexWorkStream) {
	return saved?.pdfsAdded && stream.downloadPdfs ? { pdfsAdded: true as const } : {};
}

function startCursor(saved: Cursor | null, stream: OpenAlexWorkStream): Cursor {
	const resumed = resumedCursor(saved, stream);
	if (resumed) return resumed;
	const queryVersion = stream.version;
	const sameQuery = saved?.queryVersion === queryVersion;
	const fullOnly = mustScanInFull(stream, saved);
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
		...carriedPdfs(saved, stream),
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
	// Let the run report what is wrong with a configuration it cannot read.
	if (!config.success) return true;
	return openAlexWorksAreDue(connection.syncCursor, { version: config.data.approvedQuery.version, downloadPdfs: config.data.downloadPdfs }, now);
}

/** Whether a stream at this version has work to do: a new version, an unfinished run, PDFs owed, or tonight's refresh. */
export function openAlexWorksAreDue(syncCursor: unknown, stream: Pick<OpenAlexWorkStream, "version" | "downloadPdfs">, now: Date) {
	// Let the run report what is wrong with a cursor it cannot read.
	const saved = cursorSchema.safeParse(syncCursor);
	if (!saved.success) return true;
	if (!saved.data.completedAt) return true;
	if (saved.data.queryVersion !== stream.version) return true;
	if (pdfsOwed(stream, saved.data) || pdfsDropped(stream, saved.data)) return true;
	return Date.parse(saved.data.startedAt) < lastNightlyRefresh(now);
}

/** The query narrowed to works updated since a day, for an incremental refresh. */
export function withUpdatedSince(query: OpenAlexQuery, updatedSince: string): OpenAlexQuery {
	if (query.oql) {
		const where = query.oql.replace(/^works\s+where\s+/i, "");
		return {
			oql: `works where (${where}) and from_updated_date is (${updatedSince})`,
		};
	}
	const clauses = (query.filter ?? "").split(",").filter(Boolean);
	const previousSince = clauses
		.find((clause) => clause.startsWith(UPDATED_SINCE))
		?.slice(UPDATED_SINCE.length);
	const since = [previousSince, updatedSince]
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
	stream: OpenAlexWorkStream,
	cursor: Cursor,
	sourceConnectionKey: string,
) {
	try {
		return await stream.page(
			client,
			cursor.nextCursor!,
			cursor.stage === "pdfs" ? PDF_PAGE_SIZE : RECORD_PAGE_SIZE,
			cursor.mode === "incremental" ? cursor.updatedSince : null,
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

// The records stage only reuses PDFs already published, which reads the database.
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
	scan: Scan,
	page: { works: number; items: SourceItemUpsert[]; startedAt: number; writeSeconds: number },
) {
	const pdfs = page.items.filter((record) => record.file?.url);
	const failed = pdfs.filter((record) => record.processingIssue).length;
	console.info("OpenAlex PDF page processed", {
		sourceConnectionKey: scan.context.sourceConnection.key,
		works: page.works,
		pdfs: pdfs.length,
		published: pdfs.length - failed,
		failed,
		seconds: (performance.now() - page.startedAt) / 1000,
		writeSeconds: page.writeSeconds,
		// Pages overlap, so this covers the PDFs finished since the previous page's log.
		steps: scan.options.attachmentProcessor?.takeTimings?.(scan.context.sourceConnection.key),
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
	stream: OpenAlexWorkStream;
	options: OpenAlexSourceOptions;
	cursor: Cursor;
	expectedCursor: Record<string, JsonValue>;
	pages: number;
};

/**
 * Records first: a page is written as soon as it is fetched, keeping only PDFs
 * already published. The PDF stage then adds the rest, page by page.
 */
async function preparePage(scan: Scan, items: SourceItemUpsert[]) {
	const processor = scan.options.attachmentProcessor;
	if (!scan.stream.downloadPdfs || !processor) return;
	await processAttachments(scan.context, items, processor.reuse);
}

/** Adds a processed PDF page to the stage's counts. */
function countPdfPage(scan: Scan, items: SourceItemUpsert[], links: ReadonlySet<string>) {
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
	const { context, client, stream } = scan;
	const connection = context.sourceConnection;
	while (scan.cursor.nextCursor && !scan.cursor.slices) {
		await context.heartbeat();
		const page = await fetchPage(client, stream, scan.cursor, connection.key);
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
		await preparePage(scan, items);
		await writeScannedPage(scan, page, mapped, items);
	}
}

/**
 * Download lanes shared by every page in flight, given out in the order asked
 * for, with a few per host so no publisher gets many requests at once. A PDF
 * waiting on a busy host does not hold up PDFs from other hosts.
 */
function downloadLanes(size: number, perHost: number) {
	let busy = 0;
	const byHost = new Map<string, number>();
	const waiting: { host: string; start: () => void }[] = [];
	const fits = (host: string) => busy < size && (byHost.get(host) ?? 0) < perHost;
	const take = (host: string) => {
		busy++;
		byHost.set(host, (byHost.get(host) ?? 0) + 1);
	};
	return async <T,>(host: string, task: () => Promise<T>) => {
		// Only a full host or a full set of lanes makes a download wait.
		if (fits(host)) take(host);
		else await new Promise<void>((start) => waiting.push({ host, start }));
		try {
			return await task();
		} finally {
			busy--;
			const left = byHost.get(host)! - 1;
			if (left) byHost.set(host, left);
			else byHost.delete(host);
			for (let index = 0; index < waiting.length && busy < size; ) {
				const next = waiting[index]!;
				if (!fits(next.host)) {
					index++;
					continue;
				}
				waiting.splice(index, 1);
				take(next.host);
				next.start();
			}
		}
	};
}

type PdfPage = {
	page: NonNullable<Awaited<ReturnType<typeof fetchPage>>>;
	mapped: ReturnType<typeof mapOpenAlexWork>[];
	items: SourceItemUpsert[];
	links: Set<string>;
	startedAt: number;
	processed: Promise<void>;
};

type PdfStop = { failed: boolean; error?: unknown };
type PdfPipeline = {
	scan: Scan;
	lane: ReturnType<typeof downloadLanes>;
	stop: PdfStop;
	/** A page that could not be fetched; the pages before it are still written. */
	fetchError?: unknown;
	inFlight: PdfPage[];
	fetchCursor: Cursor;
};

/** Fetches pages ahead until enough are in flight. False when incremental access was refused. */
async function fillPdfPages(pipeline: PdfPipeline) {
	const { scan, lane, stop, inFlight } = pipeline;
	const { context, client, stream } = scan;
	const processor = scan.options.attachmentProcessor;
	while (pipeline.fetchCursor.nextCursor && inFlight.length < PDF_PAGES_IN_FLIGHT && !stop.failed && !pipeline.fetchError) {
		let page: Awaited<ReturnType<typeof fetchPage>>;
		try {
			await context.heartbeat();
			page = await fetchPage(client, stream, pipeline.fetchCursor, context.sourceConnection.key);
		} catch (error) {
			pipeline.fetchError = error;
			break;
		}
		if (!page) return false;
		if (pipeline.fetchCursor.mode === "incremental") pipeline.fetchCursor = { ...pipeline.fetchCursor, incrementalAvailable: true };
		assertAdvancing(page, pipeline.fetchCursor.nextCursor, context.sourceConnection.key);
		pipeline.fetchCursor = { ...pipeline.fetchCursor, nextCursor: page.meta.next_cursor };
		const mapped = page.results.map(mapOpenAlexWork);
		const items = mapped.flatMap((work) => work.items);
		const processed = processor ? processWithLanes(context, items, processor, lane, stop) : Promise.resolve();
		// A failure is handled when its page is written; this keeps it from going unobserved first.
		processed.catch(() => (stop.failed = true));
		inFlight.push({ page, mapped, items, processed, links: new Set(items.filter(isPdfLink).map((record) => record.sourceRecordKey)), startedAt: performance.now() });
	}
	return true;
}

/** Writes the oldest page in flight once all its PDFs are done. */
async function writePdfPage(pipeline: PdfPipeline, next: PdfPage) {
	const { scan } = pipeline;
	await next.processed;
	countPdfPage(scan, next.items, next.links);
	if (pipeline.fetchCursor.incrementalAvailable && scan.cursor.mode === "incremental") scan.cursor = { ...scan.cursor, incrementalAvailable: true };
	const writeStarted = performance.now();
	await writeScannedPage(scan, next.page, next.mapped, next.items, false);
	logPdfPage(scan, { works: next.page.results.length, items: next.items, startedAt: next.startedAt, writeSeconds: (performance.now() - writeStarted) / 1000 });
}

/**
 * The PDF stage keeps a few pages in flight: a page's slowest download no
 * longer holds up the next pages' downloads, only its own write. Pages are
 * still written in order.
 */
async function scanPdfPages(scan: Scan) {
	// Times left from a run that stopped part-way are not this run's.
	scan.options.attachmentProcessor?.takeTimings?.(scan.context.sourceConnection.key);
	const pipeline: PdfPipeline = {
		scan,
		lane: downloadLanes(PDF_CONCURRENCY, PDF_PER_HOST),
		stop: { failed: false },
		inFlight: [],
		fetchCursor: scan.cursor,
	};
	const settle = async () => {
		pipeline.stop.failed = true;
		await Promise.allSettled(pipeline.inFlight.map((pending) => pending.processed));
	};
	let failed = false;
	try {
		for (;;) {
			if (!(await fillPdfPages(pipeline))) {
				// Incremental access was refused: pages in flight belong to the old query.
				await settle();
				scan.cursor = fullScanCursor(scan.cursor);
				break;
			}
			const next = pipeline.inFlight.shift();
			if (!next) {
				if (pipeline.fetchError) throw pipeline.fetchError;
				break;
			}
			await writePdfPage(pipeline, next);
		}
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await settle();
		// Every staged upload is now written or given up, so cleanup cannot remove one in use.
		await scan.options.attachmentProcessor?.flushCleanup(scan.context.sourceConnection.key).catch((error: unknown) => {
			// A failed stage reports its own error, not the cleanup's.
			if (!failed) throw error;
		});
	}
}

function pdfHost(url: string) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/** Processes a page's PDFs on the shared lanes; after a failure no new PDF starts. */
async function processWithLanes(
	context: SourceAdapterContext,
	items: SourceItemUpsert[],
	processor: RecordProcessor,
	lane: ReturnType<typeof downloadLanes>,
	stop: PdfStop,
) {
	const results = await Promise.allSettled(
		items.map((record, index) =>
			record.file?.url
				? lane(pdfHost(record.file.url), async () => {
						if (stop.failed) throw stop.error ?? new Error("PDF stage stopped");
						try {
							await context.heartbeat();
							items[index] = await processor(record, context.sourceConnection.key);
						} catch (error) {
							// Before this lane goes to the next download. The first failure is the one reported.
							stop.failed = true;
							stop.error ??= error;
							throw error;
						}
					})
				: Promise.resolve(),
		),
	);
	const rejected = results.find((result) => result.status === "rejected");
	if (rejected) {
		stop.failed = true;
		throw stop.error ?? rejected.reason;
	}
}

/**
 * Moves the cursor past a fetched page and writes it. Cleanup removes staged
 * files no publication uses, so it waits while later pages have uploads staged.
 */
async function writeScannedPage(
	scan: Scan,
	page: { meta: { count: number; next_cursor: string | null }; results: unknown[] },
	mapped: ReturnType<typeof mapOpenAlexWork>[],
	items: SourceItemUpsert[],
	cleanUp = true,
) {
	const { context } = scan;
	const connection = context.sourceConnection;
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
	if (cleanUp) await scan.options.attachmentProcessor?.flushCleanup(connection.key);
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
	const part = scan.cursor.slices![slice]!;
	let cursor = part.nextCursor;
	while (cursor && !stop.stopped) {
		const page = await scan.stream.slicePage(scan.client, part, cursor);
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
	await preparePage(scan, items);
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
	const { cursor, stream, context } = scan;
	if (cursor.stage !== "records" || cursor.mode !== "full" || cursor.nextCursor !== "*" || cursor.imported) return false;
	const slices = await stream.planSlices(scan.client, count).catch((error: unknown) => {
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

/** Withdraws the source's works that no scan has read since `startedAt`, in retryable batches. */
async function withdrawUnread(context: SourceAdapterContext, cursor: Record<string, JsonValue>, startedAt: string) {
	const connection = context.sourceConnection;
	while (
		await reconcileOpenAlexMemberships(context.database, {
			sourceConnectionKey: connection.key,
			configuration: connection.config,
			cursor,
			startedAt,
			sourceSyncRunId: context.run?.id,
		})
	)
		await context.heartbeat();
}

async function reconcile(scan: Scan) {
	if (scan.cursor.mode === "full") await withdrawUnread(scan.context, scan.expectedCursor, scan.cursor.startedAt);
}

/**
 * Withdraws every work the source holds, as when a scan no longer finds them,
 * and forgets its cursor, so the source imports in full if it comes back.
 */
export async function withdrawOpenAlexWorks(context: SourceAdapterContext) {
	const cursor = context.sourceConnection.syncCursor as Record<string, JsonValue>;
	await withdrawUnread(context, cursor, new Date().toISOString());
	if (Object.keys(cursor).length) await writeBatch(context, cursor, {}, { items: [] });
}

/** The stream version the source's last run read, or null before its first. */
export function savedOpenAlexWorksVersion(syncCursor: unknown) {
	const saved = cursorSchema.safeParse(syncCursor);
	return saved.success ? saved.data.queryVersion : null;
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
		pdfsAdded: true,
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
			if (!scan.stream.downloadPdfs) return;
			await startPdfStage(scan);
		}
		// Said before the first page, so a failure there still reads as the PDF stage.
		await reportProgress(scan, 0);
		await scanPdfPages(scan);
		if (scan.cursor.stage === "pdfs") return;
	}
}

/** The works an approved query finds, page by page with OpenAlex's own cursor; a large one is read in date slices. */
function queryStream(config: z.infer<typeof openAlexConnectionConfigSchema>): OpenAlexWorkStream {
	const query = config.approvedQuery.query;
	return {
		version: config.approvedQuery.version,
		downloadPdfs: config.downloadPdfs,
		fullScansOnly: isSampledOql(query),
		page: (client, cursor, pageSize, updatedSince) =>
			client.works(updatedSince ? withUpdatedSince(query, updatedSince) : query, cursor, pageSize, { followsCursor: true }),
		planSlices: async (client, count) =>
			count < MIN_SLICED_WORKS || isSampledOql(query) ? null : planSlices(client, query),
		slicePage: (client, slice, cursor) => client.works(slicedQuery(query, slice.dates), cursor, RECORD_PAGE_SIZE, { followsCursor: true }),
	};
}

export async function syncOpenAlexSource(
	context: SourceAdapterContext,
	options: OpenAlexSourceOptions = {},
) {
	const config = openAlexConnectionConfigSchema.parse(context.sourceConnection.config);
	return syncOpenAlexWorks(context, queryStream(config), options);
}

/** Imports a stream's works: records first, then their PDFs when the source adds them. */
export async function syncOpenAlexWorks(
	context: SourceAdapterContext,
	stream: OpenAlexWorkStream,
	options: OpenAlexSourceOptions = {},
) {
	const connection = context.sourceConnection;
	const expectedCursor = connection.syncCursor as Record<string, JsonValue>;
	const saved = Object.keys(expectedCursor).length ? cursorSchema.parse(expectedCursor) : null;
	const scan: Scan = {
		context,
		client: await openAlexClient(context, stream.downloadPdfs, options),
		stream,
		options,
		expectedCursor,
		cursor: startCursor(saved, stream),
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
