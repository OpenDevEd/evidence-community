import { z } from "zod";
import { reconcileOpenAlexMemberships } from "./reconciliation";
import type { SourceAdapterContext } from "../adapter";
import type { JsonValue, SourceItemUpsert } from "../batch-schema";
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
const UPDATED_SINCE = "from_updated_date:";

async function openAlexClient(
	context: SourceAdapterContext,
	config: OpenAlexConnectionConfig,
	options: OpenAlexSourceOptions,
) {
	const connection = context.sourceConnection;
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey)
		throw new Error(
			`OpenAlex source ${connection.key} has no API credential`,
		);
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

/** A recent, reconciled full scan lets the next run fetch only updated works. */
function incrementalSince(saved: Cursor | null, queryVersion: string) {
	if (
		!saved?.completedAt ||
		saved.queryVersion !== queryVersion ||
		!saved.reconciledAt ||
		Date.now() - Date.parse(saved.reconciledAt) >= DAY_MS ||
		saved.incrementalAvailable === false
	)
		return null;
	return new Date(Date.parse(saved.startedAt) - DAY_MS)
		.toISOString()
		.slice(0, 10);
}

function startCursor(saved: Cursor | null, queryVersion: string): Cursor {
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
	const updatedSince = incrementalSince(saved, queryVersion);
	return updatedSince
		? {
				...cursor,
				mode: "incremental",
				updatedSince,
				incrementalAvailable: saved!.incrementalAvailable,
			}
		: cursor;
}

function pageQuery(config: OpenAlexConnectionConfig, cursor: Cursor) {
	const query = config.approvedQuery.query;
	if (cursor.mode !== "incremental") return query;
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
			config.downloadPdfs ? 10 : 100,
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

// Process one file at a time to bound PDF buffers and renderer memory.
async function processAttachments(
	context: SourceAdapterContext,
	items: SourceItemUpsert[],
	processor: NonNullable<OpenAlexSourceOptions["attachmentProcessor"]>,
) {
	for (let index = 0; index < items.length; index++) {
		if (!items[index]!.file?.url) continue;
		await context.heartbeat();
		items[index] = await processor(
			items[index]!,
			context.sourceConnection.key,
		);
	}
}

function writeBatch(
	context: SourceAdapterContext,
	expectedCursor: Record<string, JsonValue>,
	nextCursor: Cursor,
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
		const mapped = page.results.map(mapOpenAlexWork);
		const items = mapped.flatMap((work) => work.items);
		if (config.downloadPdfs)
			await processAttachments(
				context,
				items,
				options.attachmentProcessor!,
			);
		cursor = {
			...cursor,
			nextCursor: page.meta.next_cursor,
			imported: cursor.imported + page.results.length,
			completedAt: null,
		};
		await context.heartbeat();
		await writeBatch(context, expectedCursor, cursor, {
			items,
			institutionCountries: mapped.flatMap((work) => work.institutions),
		});
		expectedCursor = cursor;
		pages++;
		await options.attachmentProcessor?.flushCleanup(connection.key);
	}
	while (
		cursor.mode === "full" &&
		(await reconcileOpenAlexMemberships(context.database, {
			sourceConnectionKey: connection.key,
			configuration: connection.config,
			cursor: expectedCursor,
			startedAt: cursor.startedAt,
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
