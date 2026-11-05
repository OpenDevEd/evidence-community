import type { LibraryServerConfig } from "@/config/library-config/schema";

/** Whether the library's records live only in its Elasticsearch index (docs/search-indexing.md). */
export function isIndexOnly(config: Pick<LibraryServerConfig, "services">) {
	const search = config.services.search;
	return search.engine === "elasticsearch" && search.indexOnly;
}
