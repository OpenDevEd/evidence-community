import type { SourceCitationMetric } from "./citation-metrics";

const LISTS = {
	references: { filter: "citedBy", count: "referencedWorksCount" },
	citations: { filter: "cites", count: "citedByCount" },
} as const;
export type OpenScholarList = keyof typeof LISTS;

/**
 * Where a record's whole list of references or citations opens in OpenScholar, as a path there, with how many OpenAlex
 * counts. Null for a record that is not an OpenAlex work: OpenScholar finds the list by the work's ID.
 */
export function openScholarList(record: { sourceRecordKey?: string | null; citationMetrics?: Pick<SourceCitationMetric, "citedByCount" | "referencedWorksCount">[] } | undefined, list: OpenScholarList | undefined) {
	const work = record?.sourceRecordKey ?? "";
	if (!list || !/^W\d+$/.test(work)) return null;
	return { total: record?.citationMetrics?.[0]?.[LISTS[list].count] ?? null, path: `/results?${LISTS[list].filter}=${work}` };
}
