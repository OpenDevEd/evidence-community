export {
	PLATFORM_SEARCH_SCOPE_OPTIONS as SCOPE_OPTIONS,
} from "@/config/library-config/catalogs";

export const ITEMS_PER_PAGE = 20;

export const EXCLUDED_ITEM_TYPES = ["Note", "Attachment", "Annotation"];

export const SORT_OPTIONS = [
	{ key: "relevance", legacyKey: "relevance", name: "Relevance" },
	{ key: "desc", legacyKey: "date_desc", name: "Newest", sort: ["dateSortKey:desc"] },
	{ key: "asc", legacyKey: "date_asc", name: "Oldest", sort: ["dateSortKey:asc"] },
	// Equal counts, most often none, list the newest first.
	{ key: "mostCited", name: "Most cited", sort: ["citationCount:desc", "dateSortKey:desc"] },
	{ key: "leastCited", name: "Least cited", sort: ["citationCount:asc", "dateSortKey:desc"] },
	// { key: "dateAddedDesc", name: "Date Added (Newest)", sort: "dateAdded:desc" },
	// { key: "dateAddedAsc", name: "Date Added (Oldest)", sort: "dateAdded:asc" },
	{ key: "authorAZ", legacyKey: "author_asc", name: "Author A-Z", sort: ["fullNames:asc"] },
	{ key: "authorZA", legacyKey: "author_desc", name: "Author Z-A", sort: ["fullNames:desc"] },
	{ key: "titleAZ", legacyKey: "title_asc", name: "Title A-Z", sort: ["title:asc"] },
	{ key: "titleZA", legacyKey: "title_desc", name: "Title Z-A", sort: ["title:desc"] },
];
