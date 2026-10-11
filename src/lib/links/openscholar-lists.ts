import type { SourceCitationMetric } from "./citation-metrics";

const LISTS = {
	references: { filter: "citedBy", count: "referencedWorksCount" },
	citations: { filter: "cites", count: "citedByCount" },
} as const;
export type OpenScholarList = keyof typeof LISTS;

/**
 * Where a record's whole list of references or citations opens in OpenScholar, as a path there, with how many OpenAlex
 * counts. OpenScholar finds the list by the OpenAlex work's ID: the one the record's counts are for, when it was
 * matched to OpenAlex from another source, or the record's own key when it came from OpenAlex. Null for a record
 * OpenAlex does not know.
 */
export function openScholarList(record: { sourceRecordKey?: string | null; citationMetrics?: Pick<SourceCitationMetric, "citedByCount" | "referencedWorksCount" | "workId">[] } | undefined, list: OpenScholarList | undefined) {
	const matched = record?.citationMetrics?.find((metric) => metric.workId);
	const work = matched?.workId ?? record?.sourceRecordKey ?? "";
	if (!list || !/^W\d+$/.test(work)) return null;
	return { total: (matched ?? record?.citationMetrics?.[0])?.[LISTS[list].count] ?? null, path: `/results?${LISTS[list].filter}=${work}` };
}
