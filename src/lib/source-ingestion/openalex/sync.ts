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

export async function syncOpenAlexSource(
	context: SourceAdapterContext,
	options: OpenAlexSourceOptions = {},
) {
	const connection = context.sourceConnection;
	const config = openAlexConnectionConfigSchema.parse(connection.config);
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey)
		throw new Error(
			`OpenAlex source ${connection.key} has no API credential`,
		);
	if (config.downloadPdfs && !options.attachmentProcessor)
		throw new Error(
			"OpenAlex PDF processing is enabled but no processor is available",
		);
	const client = new OpenAlexClient({
		apiKey,
		fetch: options.fetch,
		sleep: options.sleep,
	});
	let expectedCursor = connection.syncCursor as Record<string, JsonValue>;
	const saved = Object.keys(expectedCursor).length
		? cursorSchema.parse(expectedCursor)
		: null;
	let cursor =
		saved &&
		!saved.completedAt &&
		saved.queryVersion === config.approvedQuery.version
			? saved
			: {
					queryVersion: config.approvedQuery.version,
					startedAt: new Date().toISOString(),
					nextCursor: "*",
					imported: 0,
					completedAt: null,
                    mode: "full" as "full" | "incremental",
                    reconciledAt: saved?.queryVersion === config.approvedQuery.version ? saved.reconciledAt : null,
                    updatedSince: null as string | null,
                    incrementalAvailable: saved?.incrementalAvailable ?? null,
                };
    if (saved?.completedAt && saved.queryVersion === config.approvedQuery.version && saved.reconciledAt && Date.now() - Date.parse(saved.reconciledAt) < 24 * 3600_000 && saved.incrementalAvailable !== false) {
        cursor.mode = "incremental";
        cursor.updatedSince = new Date(Date.parse(saved.startedAt) - 24 * 3600_000).toISOString().slice(0, 10);
    } else if (cursor.mode === "full") cursor.incrementalAvailable = null;
	let pages = 0;
	await options.attachmentProcessor?.flushCleanup(connection.key);
	while (cursor.nextCursor) {
		await context.heartbeat();
        const clauses = (config.approvedQuery.query.filter ?? "").split(",").filter(Boolean);
        const previousSince = clauses.find(clause => clause.startsWith("from_updated_date:"))?.slice("from_updated_date:".length);
        const since = [previousSince, cursor.updatedSince].filter((value): value is string => Boolean(value)).sort().at(-1);
        const query = cursor.mode === "incremental" ? {...config.approvedQuery.query,
            filter: [...clauses.filter(clause => !clause.startsWith("from_updated_date:")), `from_updated_date:${since}`].join(","),
        } : config.approvedQuery.query;
        let page;
        try {
            page = await client.works(query, cursor.nextCursor, config.downloadPdfs ? 10 : 100);
            if (cursor.mode === "incremental") cursor.incrementalAvailable = true;
        } catch (error) {
            // Free keys use complete scans. Only an explicit entitlement denial changes strategy.
            if (cursor.mode !== "incremental" || !(error instanceof OpenAlexApiError) || ![400, 403].includes(error.status ?? 0) || !/premium|paid|from_updated_date/i.test(error.message)) throw error;
            console.info("OpenAlex key does not support incremental sync; scanning the approved query", {sourceConnectionKey: connection.key, status: error.status});
            cursor = {...cursor, mode: "full", nextCursor: "*", startedAt: new Date().toISOString(), imported: 0, updatedSince: null, incrementalAvailable: false};
            continue;
        }
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
		// Process one file at a time to bound PDF buffers and renderer memory.
		if (config.downloadPdfs) {
			for (let index = 0; index < items.length; index++) {
				if (items[index]!.file?.url) {
					await context.heartbeat();
					items[index] = await options.attachmentProcessor!(
						items[index]!,
						connection.key,
					);
				}
			}
		}
		cursor = {
			...cursor,
			nextCursor: page.meta.next_cursor,
			imported: cursor.imported + page.results.length,
			completedAt: null,
		};
		await context.heartbeat();
		await writeSourceIngestionBatch(context.database, {
			sourceConnectionKey: connection.key,
			expectedConfiguration: connection.config,
			expectedCursor,
			nextCursor: cursor,
			mappingProfileVersion: "openalex-v1",
			fetchedAt: new Date(),
			items,
			institutionCountries: mapped.flatMap((work) => work.institutions),
		});
		expectedCursor = cursor;
		pages++;
		await options.attachmentProcessor?.flushCleanup(connection.key);
	}
	while (cursor.mode === "full" && await reconcileOpenAlexMemberships(context.database, {
		sourceConnectionKey: connection.key, configuration: connection.config,
		cursor: expectedCursor, startedAt: cursor.startedAt,
	})) await context.heartbeat();
	cursor = {...cursor, completedAt: new Date().toISOString(), reconciledAt: cursor.mode === "full" ? new Date().toISOString() : cursor.reconciledAt};
	await writeSourceIngestionBatch(context.database, {
		sourceConnectionKey: connection.key, expectedConfiguration: connection.config,
		expectedCursor, nextCursor: cursor, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: [],
	});
	return {
		records: cursor.imported,
		pages,
		queryVersion: cursor.queryVersion,
		completedAt: cursor.completedAt,
	};
}
