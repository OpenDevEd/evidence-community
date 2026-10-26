import { getLibraryConfig } from "@/config/library-config/server";
import { publicRecordFilters, searchRecords } from "@/lib/search";

import { parseOpenScholarInstitutionRequest } from "./institution-catalog-contract";
import { pageTagCounts, type OpenScholarTagPage } from "./openscholar-tags";

/** The page a request asks for, read from the search index's tag counts. Missing parameters take the institution list's defaults. */
export async function listPublicTagCounts(input: unknown): Promise<OpenScholarTagPage> {
	const request = parseOpenScholarInstitutionRequest(input);
	const config = await getLibraryConfig();
	const response = await searchRecords(config, {
		text: "",
		fields: [],
		filters: publicRecordFilters(config.content.tags.hidden),
		size: 0,
		exactTotal: false,
		facets: ["tags"],
	});
	return pageTagCounts(response.facets.tags ?? {}, request);
}
