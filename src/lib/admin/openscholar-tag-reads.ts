import { getLibraryConfig } from "@/config/library-config/server";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { publicRecordFilters } from "@/lib/search";

import { parseOpenScholarInstitutionRequest } from "./institution-catalog-contract";
import { pageTagCounts, type OpenScholarTagPage } from "./openscholar-tags";

/** The page a request asks for, read from the search index's tag counts. Missing parameters take the institution list's defaults. */
export async function listPublicTagCounts(input: unknown): Promise<OpenScholarTagPage> {
	const request = parseOpenScholarInstitutionRequest(input);
	const config = await getLibraryConfig();
	const { index } = await getMeilisearchForConfig(config);
	const { facetDistribution } = await index.search("", { limit: 0, facets: ["tags"], filter: publicRecordFilters(config.content.tags.hidden) });
	return pageTagCounts(facetDistribution?.tags ?? {}, request);
}
