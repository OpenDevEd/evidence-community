import { z } from "zod";
import { reconcileOpenAlexMemberships } from "./reconciliation";
import type { SourceAdapterContext, SourceConnection } from "../adapter";
import { nightlyScheduleForDate } from "@/lib/nightly-schedule";
import { SourceCredentialNotFoundError } from "../credentials";
import {
	MAX_SOURCE_BATCH_BYTES,
	type JsonValue,
	type SourceItemUpsert,
} from "../batch-schema";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { OpenAlexApiError, OpenAlexClient } from "./client";
import { mapOpenAlexWork } from "./mapper";
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
	})
	.strict();

export type OpenAlexSourceOptions = {
	fetch?: typeof fetch;
	sleep?: (milliseconds: number) => Promise<void>;
	attachmentProcessor?: ((
		record: SourceItemUpsert,
		sourceConnectionKey: string,
	) => Promise<SourceItemUpsert>) & {
		flushCleanup: (sourceConnectionKey: string) => Promise<void>;
	};
};

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

function startCursor(
	saved: Cursor | null,
	queryVersion: string,
	fullOnly: boolean,
): Cursor {
	const sameQuery = saved?.queryVersion === queryVersion;
	if (saved && !saved.completedAt && sameQuery)
		return saved.mode === "full"
			? { ...saved, incrementalAvailable: null }
			: saved;
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
			config.downloadPdfs ? PDF_PAGE_SIZE : 100,
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
	processor: NonNullable<OpenAlexSourceOptions["attachmentProcessor"]>,
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
	nextCursor: Cursor,
	page: { items: SourceItemUpsert[]; institutionCountries: InstitutionFacts },
) {
	const chunks = writeChunks(page.items);
	for (const [index, items] of chunks.entries()) {
		await writeBatch(
			context,
			expectedCursor,
			index === chunks.length - 1 ? nextCursor : expectedCursor,
			{ items, institutionCountries: index ? [] : page.institutionCountries },
		);
	}
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
) {
	const connection = context.sourceConnection;
	return writeSourceIngestionBatch(context.database, {
		sourceConnectionKey: connection.key,
		expectedConfiguration: connection.config,
		expectedCursor,
		nextCursor,
		mappingProfileVersion: "openalex-v1",
		sourceSyncRunId: context.run?.id,
		fetchedAt: new Date(),
		...batch,
	});
}

export async function syncOpenAlexSource(
	context: SourceAdapterContext,
	options: OpenAlexSourceOptions = {},
) {
	const connection = context.sourceConnection;
	const config = openAlexConnectionConfigSchema.parse(connection.config);
	const client = await openAlexClient(context, config, options);
	let expectedCursor = connection.syncCursor as Record<string, JsonValue>;
	let cursor = startCursor(
		Object.keys(expectedCursor).length
			? cursorSchema.parse(expectedCursor)
			: null,
		config.approvedQuery.version,
		isSampledOql(config.approvedQuery.query),
	);
	let pages = 0;
	await options.attachmentProcessor?.flushCleanup(connection.key);
	while (cursor.nextCursor) {
		await context.heartbeat();
		const page = await fetchPage(client, config, cursor, connection.key);
		if (!page) {
			cursor = {
				...cursor,
				mode: "full",
				nextCursor: "*",
				startedAt: new Date().toISOString(),
				imported: 0,
				updatedSince: null,
				incrementalAvailable: false,
			};
			continue;
		}
		if (cursor.mode === "incremental") cursor.incrementalAvailable = true;
		if (
			page.meta.next_cursor === cursor.nextCursor ||
			(!page.results.length && page.meta.next_cursor)
		) {
			throw new Error(
				`OpenAlex source ${connection.key} returned a non-advancing page`,
			);
		}
		// The total is known from the page; say it before slow PDF work starts.
		// A resumed import can pass a count that shrank since it started.
		const reportPage = (imported: number) =>
			context.run?.report(imported, Math.max(page.meta.count, imported));
		await reportPage(cursor.imported);
		const mapped = page.results.map(mapOpenAlexWork);
		const items = mapped.flatMap((work) => work.items);
		if (config.downloadPdfs) {
			const startedAt = performance.now();
			await processAttachments(
				context,
				items,
				options.attachmentProcessor!,
			);
			logPdfPage(connection.key, page.results.length, items, startedAt);
		}
		cursor = {
			...cursor,
			nextCursor: page.meta.next_cursor,
			imported: cursor.imported + page.results.length,
			completedAt: null,
		};
		await context.heartbeat();
		await writePage(context, expectedCursor, cursor, {
			items,
			institutionCountries: mapped.flatMap((work) => work.institutions),
		});
		expectedCursor = cursor;
		pages++;
		await reportPage(cursor.imported);
		await options.attachmentProcessor?.flushCleanup(connection.key);
	}
	while (
		cursor.mode === "full" &&
		(await reconcileOpenAlexMemberships(context.database, {
			sourceConnectionKey: connection.key,
			configuration: connection.config,
			cursor: expectedCursor,
			startedAt: cursor.startedAt,
			sourceSyncRunId: context.run?.id,
		}))
	)
		await context.heartbeat();
	cursor = {
		...cursor,
		completedAt: new Date().toISOString(),
		reconciledAt:
			cursor.mode === "full"
				? new Date().toISOString()
				: cursor.reconciledAt,
	};
	await writeBatch(context, expectedCursor, cursor, { items: [] });
	return {
		records: cursor.imported,
		pages,
		queryVersion: cursor.queryVersion,
		completedAt: cursor.completedAt,
	};
}
