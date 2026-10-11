import type { SourceCitationMetric } from "./citation-metrics";

const LISTS = {
	references: { filter: "citedBy", count: "referencedWorksCount" },
	citations: { filter: "cites", count: "citedByCount" },
} as const;
export type OpenScholarList = keyof typeof LISTS;

type CountedRecord = { sourceRecordKey?: string | null; citationMetrics?: Pick<SourceCitationMetric, "citedByCount" | "referencedWorksCount" | "workId">[] };

/**
 * The totals a record shows and links: OpenAlex's for the work it was matched to, or the first it has when none names
 * a work. The number shown and the list it opens always come from the same one.
 */
export function openAlexTotals<Metric extends { workId?: string | null }>(record: { citationMetrics?: Metric[] } | undefined) {
	return record?.citationMetrics?.find((metric) => metric.workId) ?? record?.citationMetrics?.[0];
}

/**
 * Where a record's whole list of references or citations opens in OpenScholar, as a path there, with how many OpenAlex
 * counts. OpenScholar finds the list by the OpenAlex work's ID: the one the record's counts are for, when it was
 * matched to OpenAlex from another source, or the record's own key when it came from OpenAlex. Null for a record
 * OpenAlex does not know.
 */
export function openScholarList(record: CountedRecord | undefined, list: OpenScholarList | undefined) {
	const totals = openAlexTotals(record);
	const work = totals?.workId ?? record?.sourceRecordKey ?? "";
	if (!list || !/^W\d+$/.test(work)) return null;
	return { total: totals?.[LISTS[list].count] ?? null, path: `/results?${LISTS[list].filter}=${work}` };
}
