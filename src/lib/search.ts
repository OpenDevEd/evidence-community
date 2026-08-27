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

export const LIST_ITEM_FIELDS = [
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
	"createdAt",
	"updatedAt",
	"year",
	"country",
	"DOI",
	"url",
	"accessDate",
	"libraryCatalog",
] as const;

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
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('attributes-' + configRevision)
	const { index } = await getMeilisearchForConfig(libraryConfig);
	return index.getDisplayedAttributes();
}

export async function getMainAttributes(config?: LibraryServerConfig) {
	const libraryConfig = config ?? await getLibraryConfig();
	const attributes = await getCachedDisplayedAttributes(
		libraryConfig.revision,
		libraryConfig,
	);
	return attributes.filter((attribute) => !attribute.endsWith("fullTextPDFs"));
}

function toLightweightItem(item: any): ListItem {
	const nextItem = { ...item } as ListItem;

	if (nextItem.attachmentsData) {
		nextItem.attachmentsData = nextItem.attachmentsData.map((attachment: any) => {
			const {
				note,
				fullTextPDF,
				fullTextPDFs,
				PDFCoverPageImage,
				PDFCoverPageWidth,
				PDFCoverPageHeight,
				...rest
			} = attachment || {};
			return rest;
		});
	}

	if (nextItem.fullTextPDFs) {
		nextItem.fullTextPDFs = undefined;
	}

	return nextItem;
}

function applyCollectionsData(items: ListItem[], collections: Collection[]) {
	const collectionMap = new Map(collections.map((collection) => [collection.key, collection]));

	for (const item of items) {
		item.collectionsData = item.collectionsAncestry
			?.map((collectionKey: string) => collectionMap.get(collectionKey))
			.filter((collectionData): collectionData is Collection => !!collectionData);

		item.attachmentsData = item.attachmentsData?.filter((attachment: any) => attachment.deleted === 0);
	}
}

// The filters that decide which records the public library may show at all.
// Search, the record list, and the whole-library exports all start here.
export function getPublicRecordFilters(
	libraryConfig: Pick<LibraryPublicConfig, "content">,
) {
	const hiddenTags = libraryConfig.content.tags.hidden;

	return [
		`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
		"deleted != 1",
		hiddenTags.length
			? `tags NOT IN ${JSON.stringify(hiddenTags)}`
			: null,
	].filter((filter): filter is string => filter !== null);
}

// An empty query has nothing to rank, so it falls back to newest first.
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

function buildSearchFilters(
	libraryConfig: Pick<LibraryPublicConfig, "content">,
	selection: {
		range: ReturnType<typeof normalizeRuntimeYearRange>;
		institution: string[];
		country: string[];
		author_country: string[];
		author: string;
		scope: string;
		collections: string[];
	},
) {
	return [
		...getPublicRecordFilters(libraryConfig),
		selection.range ? formatRange(selection.range) : null,
		...selection.institution.map((institutionValue) =>
			meilisearchEquals("institution", institutionValue),
		),
		...createCountryFilters(selection.country, selection.author_country),
		selection.author
			? meilisearchEquals("fullNames", selection.author)
			: null,
		selection.scope === "documents"
			? `fullTextPDFs.fullTextPDF.text EXISTS`
			: null,
		...selection.collections.map((collection) =>
			meilisearchEquals("collectionsAncestry", collection),
		),
	].filter((filter): filter is string => filter !== null);
}

// A facet the library has switched off contributes nothing, whatever the URL
// asks for.
function resolveFacetSelection(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryPublicConfig, "filters"> & {
		search: RuntimeSearch;
	},
) {
	return {
		institution:
			libraryConfig.filters.institution.mode === "hidden"
				? []
				: searchParams.institution || [],
		country: libraryConfig.search.country
			? searchParams.country || []
			: [],
		author_country: libraryConfig.search.authorCountry
			? searchParams.author_country || []
			: [],
		author: searchParams.author || "",
		collections: searchParams.collections || [],
	};
}

function resolveSearchRequest(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryPublicConfig, "content" | "filters"> & {
		search: RuntimeSearch;
	},
) {
	const search = searchParams.search || "";
	const scope = resolveRuntimeSearchScope(
		searchParams.scope,
		libraryConfig.search,
	);
	const facets = resolveFacetSelection(searchParams, libraryConfig);

	return {
		search,
		pageNum: Math.max(1, Number(searchParams.page || 1)),
		limitNum: ITEMS_PER_PAGE,
		sortOption: resolveSortOption(
			search,
			searchParams.sort || SORT_OPTIONS[0].key,
		),
		finalFilters: buildSearchFilters(libraryConfig, {
			...facets,
			range: normalizeRuntimeYearRange(
				searchParams.range,
				libraryConfig.filters,
			),
			scope,
		}),
		attributesToSearchOn: getRuntimeSearchAttributes(
			scope,
			libraryConfig.search,
		),
		country: facets.country,
		author_country: facets.author_country,
	};
}

export async function getPublicItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	options: {
		includeHeavyFields?: boolean;
	} = {}
): Promise<SearchItemsResult> {
	const libraryConfig = await getLibraryConfig();
	const displayedAttributes = await getMainAttributes(libraryConfig);
	const { search, pageNum, limitNum, sortOption, finalFilters, attributesToSearchOn } =
		resolveSearchRequest(
			searchParams,
			libraryConfig,
		);

	const includeHeavyFields = options.includeHeavyFields === true;
	const attributesToRetrieve = includeHeavyFields
		? displayedAttributes
		: [...LIST_ITEM_FIELDS];

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const [searchResults, collections] = await Promise.all([
		index.search(search, {
			offset: (pageNum - 1) * limitNum,
			limit: limitNum,
			attributesToSearchOn,
			attributesToRetrieve,
			...(sortOption ? { sort: [sortOption] } : {}),
			filter: finalFilters,
		}),
		getCachedCollections(libraryConfig),
	]);

	const items = (searchResults.hits as ListItem[]).map((item) =>
		includeHeavyFields ? item : toLightweightItem(item)
	);

	applyCollectionsData(items, collections as Collection[]);

	const totalCount = searchResults.estimatedTotalHits || searchResults.hits.length;

	return {
		items,
		currentPage: pageNum,
		totalItems: totalCount,
		perPage: limitNum,
		totalPages: Math.ceil(totalCount / limitNum),
	};
}

export async function getPublicFacets(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>
): Promise<SearchFacetsResult> {
	const libraryConfig = await getLibraryConfig();
	const { search, finalFilters, attributesToSearchOn, country, author_country } =
		resolveSearchRequest(
			searchParams,
			libraryConfig,
		);

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
		facetDistribution: addRegionsToFacetDistribution(
			Object.assign(
				{},
				searchResults.facetDistribution,
				countryFacetOptions
					.filter((facet) => facets.includes(facet.key))
					.reduce((acc, facet) => {
						acc[facet.key + "_uncategorized"] =
							searchResults.facetDistribution?.[facet.key] || {};
						return acc;
					}, {} as FacetDistribution)
			),
			{
				country,
				author_country,
			}
		),
	};
}

export async function getItemsPaginationMeta(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>
): Promise<SearchCountOnlyResult> {
	const libraryConfig = await getLibraryConfig();
	const { search, pageNum, limitNum, sortOption, finalFilters, attributesToSearchOn } =
		resolveSearchRequest(
			searchParams,
			libraryConfig,
		);

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const searchResults = await index.search(search, {
		offset: 0,
		limit: 0,
		attributesToSearchOn,
		...(sortOption ? { sort: [sortOption] } : {}),
		filter: finalFilters,
	});

	const totalItems = searchResults.estimatedTotalHits || searchResults.hits.length;

	return {
		currentPage: pageNum,
		perPage: limitNum,
		totalItems,
		totalPages: Math.ceil(totalItems / limitNum),
	};
}
