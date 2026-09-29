import { OpenScholarServiceError, type OpenScholarService } from "@/lib/openscholar-service";

import type { SourceAdapterContext, SourceSyncResult } from "../adapter";
import { saveSourceDisplayName } from "../display-name";
import { OPENALEX_MAX_IDS_PER_FILTER, worksWithIds, type OpenAlexClient } from "../openalex/client";
import { openAlexWorksConfigSchema } from "../openalex/schema";
import {
	openAlexWorksAreDue,
	savedOpenAlexWorksVersion,
	syncOpenAlexWorks,
	withUpdatedSince,
	withdrawOpenAlexWorks,
	type OpenAlexSourceOptions,
	type OpenAlexWorkStream,
} from "../openalex/sync";
import { OpenScholarCollectionGoneError, readOpenScholarCollection } from "./client";

export type OpenScholarSourceOptions = OpenAlexSourceOptions & { service: OpenScholarService };

const PART = OPENALEX_MAX_IDS_PER_FILTER;

function offsetOf(cursor: string) {
	const offset = cursor === "*" ? 0 : Number(cursor);
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`Invalid collection cursor: ${cursor}`);
	return offset;
}

/**
 * A collection's works, read from OpenAlex a hundred ids at a time: in parallel
 * parts on a full scan, and as one stream on a nightly refresh. A refresh page
 * skips the parts with no updated work, so a page is empty only at the end.
 */
function collectionStream(openAlexIds: readonly string[], version: string, downloadPdfs: boolean): OpenAlexWorkStream {
	const read = async (client: OpenAlexClient, offset: number, updatedSince: string | null) => {
		const query = worksWithIds(openAlexIds.slice(offset, offset + PART));
		return (await client.works(updatedSince ? withUpdatedSince(query, updatedSince) : query, null, PART)).results;
	};
	return {
		version,
		downloadPdfs,
		fullScansOnly: false,
		page: async (client, cursor, _pageSize, updatedSince) => {
			for (let offset = offsetOf(cursor); offset < openAlexIds.length; offset += PART) {
				const results = await read(client, offset, updatedSince);
				const next = offset + PART < openAlexIds.length ? String(offset + PART) : null;
				if (results.length || !next) return { meta: { count: openAlexIds.length, next_cursor: next }, results };
			}
			return { meta: { count: openAlexIds.length, next_cursor: null }, results: [] };
		},
		planSlices: async () =>
			openAlexIds.length > PART
				? Array.from({ length: Math.ceil(openAlexIds.length / PART) }, (_, part) => ({
						dates: null,
						offset: part * PART,
						count: Math.min(PART, openAlexIds.length - part * PART),
					}))
				: null,
		slicePage: async (client, slice) => ({
			meta: { count: slice.count, next_cursor: null },
			results: await read(client, slice.offset ?? 0, null),
		}),
	};
}

function goneCode(error: unknown) {
	if (!(error instanceof OpenScholarServiceError)) return null;
	if (error.code === "owner_left") return "owner_left" as const;
	return error.code === "collection_not_found" ? ("not_found" as const) : null;
}

/**
 * Follows one OpenScholar collection. Every sweep asks whether it changed,
 * which costs one small request; a change imports it again, and a collection
 * the library lost access to has its works withdrawn.
 */
export async function syncOpenScholarCollection(
	context: SourceAdapterContext,
	options: OpenScholarSourceOptions,
): Promise<SourceSyncResult> {
	const connection = context.sourceConnection;
	const config = openAlexWorksConfigSchema.parse(connection.config);
	const collectionId = connection.externalScopeKey!;
	const read = async (knownVersion: string | null) => {
		try {
			return await readOpenScholarCollection(options.service, collectionId, knownVersion, { fetch: options.fetch });
		} catch (error) {
			const gone = goneCode(error);
			if (!gone) throw error;
			await withdrawOpenAlexWorks(context);
			throw new OpenScholarCollectionGoneError(gone, collectionId);
		}
	};
	let collection = await read(savedOpenAlexWorksVersion(connection.syncCursor));
	await saveSourceDisplayName(context.database, connection, async () => collection.name);
	if (collection.unchanged) {
		const due = openAlexWorksAreDue(connection.syncCursor, { version: collection.version, downloadPdfs: config.downloadPdfs }, new Date());
		if (!due) return { unchanged: true, version: collection.version };
		collection = await read(null);
		if (collection.unchanged) throw new Error(`OpenScholar collection ${collectionId} answered without its items`);
	}
	const result = await syncOpenAlexWorks(
		context,
		collectionStream(collection.openAlexIds, collection.version, config.downloadPdfs),
		options,
	);
	return { ...result, unresolved: collection.unresolved };
}
