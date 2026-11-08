import { OPENALEX_MAX_IDS_PER_FILTER, worksWithIds, type OpenAlexClient } from "./client";
import { withUpdatedSince, type OpenAlexWorkStream } from "./sync";

const PART = OPENALEX_MAX_IDS_PER_FILTER;

function offsetOf(cursor: string) {
	const offset = cursor === "*" ? 0 : Number(cursor);
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`Invalid work list cursor: ${cursor}`);
	return offset;
}

/**
 * A list of works, such as a collection's or the added papers, read from OpenAlex a hundred ids at a time: in parallel
 * parts on a full scan, and as one stream on a nightly refresh. A refresh page
 * skips the parts with no updated work, so a page is empty only at the end.
 */
export function openAlexIdStream(openAlexIds: readonly string[], version: string, downloadPdfs: boolean): OpenAlexWorkStream {
	const read = async (client: OpenAlexClient, offset: number, updatedSince: string | null) => {
		const query = worksWithIds(openAlexIds.slice(offset, offset + PART));
		// A hundred ids fit one page, so OpenAlex's own cursor never goes past "*".
		return (await client.works(updatedSince ? withUpdatedSince(query, updatedSince) : query, "*", PART)).results;
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
