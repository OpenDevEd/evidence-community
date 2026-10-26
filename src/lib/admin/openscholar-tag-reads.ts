import { getLibraryConfig } from "@/config/library-config/server";
import { publicRecordFilters, searchRecords } from "@/lib/search";
import { facetAggregations, facetDistribution } from "@/lib/search-engine";

import { parseOpenScholarInstitutionRequest } from "./institution-catalog-contract";
import { pageTagCounts, type OpenScholarTagPage } from "./openscholar-tags";

/** The page a request asks for, read from the search index's tag counts. Missing parameters take the institution list's defaults. */
export async function listPublicTagCounts(input: unknown): Promise<OpenScholarTagPage> {
	const request = parseOpenScholarInstitutionRequest(input);
	const config = await getLibraryConfig();
	const response = await searchRecords(
		config,
		{ search: "", attributesToSearchOn: [], filters: publicRecordFilters(config.content.tags.hidden) },
		{ size: 0, track_total_hits: false, aggs: facetAggregations(["tags"]) },
	);
	return pageTagCounts(facetDistribution(response.aggregations).tags ?? {}, request);
}
