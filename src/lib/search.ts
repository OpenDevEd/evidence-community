import { filterPublicAttachments } from "./tags";
import { getCachedCollections } from "@/app/api/cache";
import { Collection } from "@/app/api/collections/types";
import { ListItem } from "@/app/api/item/types";
import {
	EXCLUDED_ITEM_TYPES,
	ITEMS_PER_PAGE,
	SORT_OPTIONS,
} from "@/constants/items";
import { countryFacetOptions } from "@/constants/misc";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	getRuntimeSearchAttributes,
	getRuntimeSearchFacets,
	normalizeRuntimeYearRange,
	resolveRuntimeSearchScope,
	type RuntimeSearch,
} from "@/config/library-config/search";
import type {
	LibraryPublicConfig,
	LibraryServerConfig,
} from "@/config/library-config/schema";
import { FacetDistribution } from "meilisearch";
import { inferParserType } from "nuqs";
import { cacheLife, cacheTag } from "next/cache";
import { addRegionsToFacetDistribution, createCountryFilters } from "./country";
import { getMeilisearchForConfig } from "./meilisearch";
import { searchParamsLoader } from "./searchParams";
import { formatRange } from "./utils";
import { meilisearchEquals } from "./meilisearch-filter";
import { FULL_TEXT_PDF_FILTER } from "./search-filter-constants";
import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import { CITATION_RECORD_COLUMNS } from "./citation-record-columns";
import { itemPageAttachments } from "./attachment-visibility";

/**
 * Result cards also open the item page before the full record loads, so they
 * carry every citation field and the citation does not change once it arrives.
 */
export const LIST_ITEM_FIELDS = [...new Set([
	...CITATION_RECORD_COLUMNS,
	"itemType",
	"key",
	"provider",
	"sourceConnectionKey",
	"sourceExternalScopeKey",
	"sourceRecordKey",
	"title",
	"shortTitle",
	"abstractNote",
	"creators",
	"date",
	"dateAdded",
	"dateModified",
	"datePublished",
	"deleted",
	"extra",
	"fullNames",
	"institution",
	"languageName",
	"links",
	"relations",
	"tags",
	"collections",
	"collectionsAncestry",
	"citationMetrics",
	"createdAt",
	"updatedAt",
	"year",
	"country",
	"DOI",
	"url",
	"accessDate",
	"libraryCatalog",
	"attachmentsData",
])];

type SearchCountOnlyResult = {
	currentPage: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
};

type SearchItemsResult = SearchCountOnlyResult & {
	items: ListItem[];
};

type SearchFacetsResult = {
	facetDistribution: FacetDistribution;
};

async function getCachedDisplayedAttributes(
	configRevision: string,
	libraryConfig: LibraryServerConfig,
) {
	"use cache";
	cacheLife({ revalidate: 60 });
	cacheTag("attributes-" + configRevision);
	const { index } = await getMeilisearchForConfig(libraryConfig);
	const displayed = await index.getDisplayedAttributes();
	if (!displayed.includes("*")) return displayed;
	// "*" cannot leave a field out, so name every stored field instead.
	const { fieldDistribution } = await index.getStats();
	return [...new Set(Object.keys(fieldDistribution).map((field) => field.split(".")[0]))];
}

/** Every public field except PDF full text, which is searched but never sent. */
export async function getMainAttributes(config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	const attributes = await getCachedDisplayedAttributes(
		libraryConfig.revision,
		libraryConfig,
	);
	return attributes.filter(
		(attribute) => attribute !== "fullTextPDFs" && !attribute.startsWith("fullTextPDFs."),
	);
}

/** A list result keeps only its public attachments that the item page reads. */
export function toLightweightItem(
	item: ListItem,
	tags: Pick<LibraryPublicConfig["content"]["tags"], "hidden" | "publish">,
): ListItem {
	return {
		...item,
		attachmentsData: itemPageAttachments(
			filterPublicAttachments(item.attachmentsData, tags),
			tags.publish,
		),
	};
}

function applyCollectionsData(items: ListItem[], collections: Collection[]) {
	const collectionMap = new Map(
		collections.map((collection) => [collection.key, collection]),
	);

	for (const item of items) {
		item.collectionsData = item.collectionsAncestry
			?.map((collectionKey: string) => collectionMap.get(collectionKey))
			.filter(
				(collectionData): collectionData is Collection =>
					!!collectionData,
			);
	}
}

type SearchFilterInput = {
	author: string;
	collections: string[];
	country: string[];
	hiddenTags: readonly string[];
	institution: string[];
	range: string | null;
	scope: string;
};

/** An empty search has no relevance to sort by, so it shows the newest first. */
function resolveSortOption(search: string, sort: string) {
	const effectiveSort =
		search.trim().length === 0 && sort === SORT_OPTIONS[0].key
			? SORT_OPTIONS[1].key
			: sort;
	return (
		SORT_OPTIONS.find((option) => option.key === effectiveSort)?.sort ||
		SORT_OPTIONS[0].sort
	);
}

function buildSearchFilters({
	author,
	collections,
	country,
	hiddenTags,
	institution,
	range,
	scope,
}: SearchFilterInput) {
	return [
		`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
		range ? formatRange(range) : null,
		...institution.map((value) =>
			meilisearchEquals(INSTITUTION_FILTER_FIELD, value),
		),
		...createCountryFilters(country),
		author ? meilisearchEquals("fullNames", author) : null,
		scope === "documents" ? FULL_TEXT_PDF_FILTER : null,
		...collections.map((collection) =>
			meilisearchEquals("collectionsAncestry", collection),
		),
		"deleted != 1",
		hiddenTags.length ? `tags NOT IN ${JSON.stringify(hiddenTags)}` : null,
	].filter((filter): filter is string => filter !== null);
}

export function resolveSearchRequest(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryPublicConfig, "content" | "filters"> & {
		search: RuntimeSearch;
	},
) {
	const pageNum = Math.max(1, Number(searchParams.page || 1));
	const search = searchParams.search || "";
	const scope = resolveRuntimeSearchScope(
		searchParams.scope,
		libraryConfig.search,
	);
	const institution =
		libraryConfig.filters.institution.mode === "hidden"
			? []
			: searchParams.institution || [];
	const country = libraryConfig.search.country
		? searchParams.country || []
		: [];
	const finalFilters = buildSearchFilters({
		author: searchParams.author || "",
		collections: searchParams.collections || [],
		country,
		hiddenTags: libraryConfig.content.tags.hidden,
		institution,
		range: normalizeRuntimeYearRange(
			searchParams.range,
			libraryConfig.filters,
		),
		scope,
	});

	const sortOption = resolveSortOption(
		search,
		searchParams.sort || SORT_OPTIONS[0].key,
	);
	const limitNum = ITEMS_PER_PAGE;

	const attributesToSearchOn = getRuntimeSearchAttributes(
		scope,
		libraryConfig.search,
	);

	return {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
		country,
	};
}

export async function getPublicItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	options: {
		includeHeavyFields?: boolean;
		/** Fewer results than a listing page, from the start of the list: a preview. */
		limit?: number;
	} = {},
): Promise<SearchItemsResult> {
	const libraryConfig = await getLibraryConfig();
	const displayedAttributes = await getMainAttributes(libraryConfig);
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = resolveSearchRequest(searchParams, libraryConfig);

	const pageSize = options.limit ? Math.min(Math.max(1, Math.floor(options.limit)), limitNum) : limitNum;
	const page = options.limit ? 1 : pageNum;
	const includeHeavyFields = options.includeHeavyFields === true;
	const attributesToRetrieve = includeHeavyFields
		? displayedAttributes
		: [...LIST_ITEM_FIELDS];

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const [searchResults, collections] = await Promise.all([
		index.search(search, {
			offset: (page - 1) * pageSize,
			limit: pageSize,
			attributesToSearchOn,
			attributesToRetrieve,
			...(sortOption ? { sort: [sortOption] } : {}),
			filter: finalFilters,
		}),
		getCachedCollections(libraryConfig),
	]);

	const { tags } = libraryConfig.content;
	const items = (searchResults.hits as ListItem[]).map((item) =>
		includeHeavyFields
			? { ...item, attachmentsData: filterPublicAttachments(item.attachmentsData, tags) }
			: toLightweightItem(item, tags),
	);

	applyCollectionsData(items, collections as Collection[]);

	const totalCount =
		searchResults.estimatedTotalHits || searchResults.hits.length;

	return {
		items,
		currentPage: page,
		totalItems: totalCount,
		perPage: pageSize,
		totalPages: Math.ceil(totalCount / pageSize),
	};
}

/** The public list copies of these records, as a result list holds them, in one search; hidden and deleted ones are left out. */
export async function getPublicItemsByKeys(keys: string[]): Promise<ListItem[]> {
	if (keys.length === 0) return [];
	const libraryConfig = await getLibraryConfig();
	const { tags } = libraryConfig.content;
	const { index } = await getMeilisearchForConfig(libraryConfig);
	const [searchResults, collections] = await Promise.all([
		index.search("", {
			limit: keys.length,
			attributesToRetrieve: [...LIST_ITEM_FIELDS],
			filter: [
				`key IN ${JSON.stringify(keys)}`,
				...buildSearchFilters({ author: "", collections: [], country: [], hiddenTags: tags.hidden, institution: [], range: null, scope: "" }),
			],
		}),
		getCachedCollections(libraryConfig),
	]);
	const items = (searchResults.hits as ListItem[]).map((item) => toLightweightItem(item, tags));
	applyCollectionsData(items, collections as Collection[]);
	return items;
}

export async function getPublicFacets(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
): Promise<SearchFacetsResult> {
	const libraryConfig = await getLibraryConfig();
	const { search, finalFilters, attributesToSearchOn, country } =
		resolveSearchRequest(searchParams, libraryConfig);

	const facets = getRuntimeSearchFacets(
		libraryConfig.search,
		libraryConfig.filters,
	);

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const searchResults = await index.search(search, {
		offset: 0,
		limit: 0,
		attributesToSearchOn,
		facets,
		filter: finalFilters,
	});

	return {
		facetDistribution: publicFacetDistribution(
			searchResults.facetDistribution,
			facets,
			country,
		),
	};
}

/** Facet counts with each country facet's raw values kept beside its regions. */
export function publicFacetDistribution(
	distribution: FacetDistribution | undefined,
	facets: readonly string[],
	country: string[],
) {
	return addRegionsToFacetDistribution(
		Object.assign(
			{},
			distribution,
			countryFacetOptions
				.filter((facet) => facets.includes(facet.key))
				.reduce((acc, facet) => {
					acc[facet.key + "_uncategorized"] = distribution?.[facet.key] || {};
					return acc;
				}, {} as FacetDistribution),
		),
		{ country },
	);
}

export async function getItemsPaginationMeta(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
): Promise<SearchCountOnlyResult> {
	const libraryConfig = await getLibraryConfig();
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = resolveSearchRequest(searchParams, libraryConfig);

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const searchResults = await index.search(search, {
		offset: 0,
		limit: 0,
		attributesToSearchOn,
		...(sortOption ? { sort: [sortOption] } : {}),
		filter: finalFilters,
	});

	const totalItems =
		searchResults.estimatedTotalHits || searchResults.hits.length;

	return {
		currentPage: pageNum,
		perPage: limitNum,
		totalItems,
		totalPages: Math.ceil(totalItems / limitNum),
	};
}
