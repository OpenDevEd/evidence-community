import { z } from "zod";
import type { SourceAdapterContext } from "../adapter";
import type { JsonValue, SourceItemUpsert } from "../batch-schema";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { OpenAlexClient } from "./client";
import { mapOpenAlexWork } from "./mapper";
import { openAlexConnectionConfigSchema } from "./schema";

const cursorSchema = z
	.object({
		queryVersion: z.string(),
		startedAt: z.iso.datetime(),
		nextCursor: z.string().nullable(),
		imported: z.number().int().nonnegative(),
		completedAt: z.iso.datetime().nullable(),
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
				};
	let pages = 0;
	await options.attachmentProcessor?.flushCleanup(connection.key);
	while (cursor.nextCursor) {
		await context.heartbeat();
		const page = await client.works(
			config.approvedQuery.query,
			cursor.nextCursor,
			// Ten work/PDF pairs fit under the writer's 64 MiB batch limit,
			// including bounded extracted text and institution facts.
			config.downloadPdfs ? 10 : 100,
		);
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
			completedAt: page.meta.next_cursor
				? null
				: new Date().toISOString(),
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
	return {
		records: cursor.imported,
		pages,
		queryVersion: cursor.queryVersion,
		completedAt: cursor.completedAt,
	};
}
