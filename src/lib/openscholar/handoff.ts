// Records, a search or a collection of this library, with the questions a reader's Smart screening asked, handed to
// OpenScholar for the reader to screen or extract from on their own account (plans/evidence-library-sources in
// OpenScholar). OpenScholar keeps the hand-off for a week and reads its source as whoever opens it.

import { z } from "zod";

import { listingParams, serializeSearchParams } from "@/lib/searchParams";
import { SMART_SCREENING_FIELD_TYPES } from "@/types/ai";

/** Most records a hand-off names one by one: OpenScholar's LIBRARY_SOURCE_RECORDS_MAX. */
const HANDOFF_RECORDS_MAX = 1_000;

const id = z.string().trim().min(1).max(200);
const RECORD_KEY = /^[A-Z0-9]{8}$/u;
/** What a question may say it means: as much as the Smart screening editor takes (src/lib/ai/screening-fields.ts). */
const DESCRIPTION_MAX = 1_024;

/** The record keys among `keys`, as many as a hand-off takes. */
export const recordsOf = (keys: string[]) => keys.filter((key) => RECORD_KEY.test(key)).slice(0, HANDOFF_RECORDS_MAX);

export const handoffSchema = z.strictObject({
	from: z.enum(["smartScreening", "search", "collection"]),
	source: z.union([
		z.strictObject({ records: z.array(z.string().regex(RECORD_KEY)).min(1).max(HANDOFF_RECORDS_MAX) }),
		// As long a search as the library resolves for OpenScholar (src/lib/openscholar/library-reads.ts).
		z.strictObject({ search: z.string().max(8_000), readerCollection: id.optional() }),
		z.strictObject({ readerCollection: id }),
		z.strictObject({ libraryCollection: id }),
	]),
	fields: z.array(z.strictObject({ label: z.string().trim().min(1).max(120), type: z.enum(SMART_SCREENING_FIELD_TYPES), description: z.string().trim().max(DESCRIPTION_MAX) })).max(20),
});

export type OpenScholarHandoff = z.infer<typeof handoffSchema>;

/** The search these results are, as the search page writes it: its words, filters and order, without the page. */
export function searchOf(params: Parameters<typeof listingParams>[0]) {
	const { page: _page, ...search } = listingParams(params);
	return serializeSearchParams(search).replace(/^\?/u, "");
}
