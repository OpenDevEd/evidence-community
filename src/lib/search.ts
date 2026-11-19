import { getCachedCollections } from "@/app/api/cache";
import { Collection } from "@/app/api/collections/types";
import { ListItem } from "@/app/api/item/types";
import config from "@/constants/config.json";
import {
	EXCLUDED_ITEM_TYPES,
	ITEMS_PER_PAGE,
	SCOPE_OPTIONS,
	SORT_OPTIONS,
} from "@/constants/items";
import { blockedTags, countryFacetOptions } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { inferParserType } from "nuqs";
import { cacheLife, cacheTag } from "next/cache";
import { addRegionsToFacetDistribution, createCountryFilters } from "./country";
import meilisearchClient from "./meilisearch";
import { FULL_TEXT_PDF_FILTER } from "./search-filter-constants";
import { searchParamsLoader } from "./searchParams";
import { semanticSearch, understandQuery } from "./semantic-search";
import { WORDS_ONLY_SCOPES, type SemanticInfo } from "./semantic-concepts";
import { formatRange } from "./utils";

export const LIST_ITEM_FIELDS = [
	"id",
	"itemType",
	"version",
	"key",
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
	"groupExternalId",
	"institution",
	"languageName",
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

const DEFAULT_FACETS = ["collectionsAncestry", "institution"];

type SearchCountOnlyResult = {
	currentPage: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
};

type SearchItemsResult = SearchCountOnlyResult & {
	items: ListItem[];
	semantic?: SemanticInfo;
};

type SearchFacetsResult = {
	facetDistribution: FacetDistribution;
};

export type LibrarySearchParams = Partial<
	inferParserType<typeof searchParamsLoader>
>;

export type CompiledLibrarySearchRequest = {
	search: string;
	pageNum: number;
	limitNum: number;
	sortOption?: string;
	finalFilters: string[];
	attributesToSearchOn: string[];
	country: string[];
	author_country: string[];
};

function cleanTheAttributesToSearchOn(fields: string[]) {
	let nextFields = fields;

	if (process.env.NEXT_PUBLIC_DISABLE_FULLTEXT === "true") {
		nextFields = nextFields.filter(
			(field) => !field.includes("fullTextPDF"),
		);
	}

	if (process.env.NEXT_PUBLIC_DISABLE_TAGS === "true") {
		nextFields = nextFields.filter((field) => !field.includes("tags"));
	}

	return nextFields;
}

async function getCachedDisplayedAttributes() {
	"use cache";
	cacheLife({ revalidate: 60 });
	cacheTag("attributes");
	return meilisearchClient
		.index(process.env.MEILI_INDEX || config.index)
		.getDisplayedAttributes();
}

export async function getMainAttributes() {
	const attributes = await getCachedDisplayedAttributes();
	return attributes.filter(
		(attribute) => !attribute.endsWith("fullTextPDFs"),
	);
}

function toLightweightItem(item: any): ListItem {
	const nextItem = { ...item } as ListItem;

	if (nextItem.attachmentsData) {
		nextItem.attachmentsData = nextItem.attachmentsData.map(
			(attachment: any) => {
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
			},
		);
	}

	if (nextItem.fullTextPDFs) {
		nextItem.fullTextPDFs = undefined;
	}

	return nextItem;
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

		item.attachmentsData = item.attachmentsData?.filter(
			(attachment: any) => attachment.deleted === 0,
		);
	}
}

export function compileLibrarySearchRequest(
	searchParams: LibrarySearchParams,
): CompiledLibrarySearchRequest {
	const pageNum = Math.max(1, Number(searchParams.page || 1));
	const limitNum = ITEMS_PER_PAGE;
	const sort = searchParams.sort || SORT_OPTIONS[0].key;
	const search = searchParams.search || "";
	const scope = searchParams.scope || SCOPE_OPTIONS[0].key;
	const range = searchParams.range || null;
	const institution = searchParams.institution || [];
	const country = searchParams.country || [];
	const author_country = searchParams.author_country || [];
	const author = searchParams.author || "";
	const collections = searchParams.collections || [];

	const effectiveSort =
		search.trim().length === 0 && sort === SORT_OPTIONS[0].key
			? SORT_OPTIONS[1].key
			: sort;
	const sortOption =
		SORT_OPTIONS.find((option) => option.key === effectiveSort)?.sort ||
		SORT_OPTIONS[0].sort;

	const finalFilters = [
		`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
		range ? formatRange(range) : null,
		...(Array.isArray(institution)
			? institution.map(
					(institutionValue) =>
						`institution = ${JSON.stringify(institutionValue)}`,
				)
			: []),
		...createCountryFilters(country, author_country),
		author ? `fullNames = ${JSON.stringify(author)}` : null,
		scope === "documents" ? FULL_TEXT_PDF_FILTER : null,
		...collections.map(
			(collection) =>
				`collectionsAncestry = ${JSON.stringify(collection)}`,
		),
		"deleted != 1",
		`tags NOT IN ${JSON.stringify(blockedTags)}`,
	].filter((filter): filter is string => filter !== null);

	const attributesToSearchOn = cleanTheAttributesToSearchOn(
		SCOPE_OPTIONS.find((option) => option.key === scope)
			?.attributesToSearchOn || SCOPE_OPTIONS[0].attributesToSearchOn,
	);

	return {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
		country,
		author_country,
	};
}

export async function getPublicItems(
	searchParams: LibrarySearchParams,
	options: {
		includeHeavyFields?: boolean;
		locale?: string;
	} = {},
): Promise<SearchItemsResult> {
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = compileLibrarySearchRequest(searchParams);

	const includeHeavyFields = options.includeHeavyFields === true;
	const attributesToRetrieve = includeHeavyFields
		? await getMainAttributes()
		: [...LIST_ITEM_FIELDS];

	const index = meilisearchClient.index(
		process.env.MEILI_INDEX || config.index,
	);

	const indexName = process.env.MEILI_INDEX || config.index;
	const [semantic, collections] = await Promise.all([
		semanticSearch({
			indexName,
			concept: searchParams.concept ?? 1,
			scope: searchParams.scope || SCOPE_OPTIONS[0].key,
			search,
			like: searchParams.like ?? "",
			theme: searchParams.theme ?? -1,
			literal: searchParams.literal ?? false,
			wordsOnly: searchParams.wordsOnly ?? false,
			locale: options.locale ?? "en-GB",
			offset: (pageNum - 1) * limitNum,
			limit: limitNum,
			attributesToSearchOn,
			attributesToRetrieve,
			...(sortOption ? { sort: [sortOption] } : {}),
			filter: finalFilters,
		}),
		getCachedCollections(),
	]);
	const searchResults = semantic
		? { hits: semantic.hits, estimatedTotalHits: semantic.total }
		: await index.search(search, {
				offset: (pageNum - 1) * limitNum,
				limit: limitNum,
				attributesToSearchOn,
				attributesToRetrieve,
				...(sortOption ? { sort: [sortOption] } : {}),
				filter: finalFilters,
			});

	const items = (searchResults.hits as ListItem[]).map((item) =>
		includeHeavyFields ? item : toLightweightItem(item),
	);

	applyCollectionsData(items, collections as Collection[]);

	const totalCount =
		searchResults.estimatedTotalHits || searchResults.hits.length;

	return {
		items,
		currentPage: pageNum,
		totalItems: totalCount,
		perPage: limitNum,
		totalPages: Math.ceil(totalCount / limitNum),
		...(semantic ? { semantic: semantic.semantic } : {}),
	};
}

export async function getPublicFacets(
	searchParams: LibrarySearchParams,
): Promise<SearchFacetsResult> {
	const {
		search,
		finalFilters,
		attributesToSearchOn,
		country,
		author_country,
	} = compileLibrarySearchRequest(searchParams);

	const facets = [...DEFAULT_FACETS];
	if (process.env.NEXT_PUBLIC_DISABLE_COUNTRY !== "true") {
		facets.push("country");
	}
	if (process.env.NEXT_PUBLIC_DISABLE_AUTHOR_COUNTRY !== "true") {
		facets.push("creators.institutions.country_code");
	}

	const index = meilisearchClient.index(
		process.env.MEILI_INDEX || config.index,
	);

	// shortcut: mock — words decide facet counts, so a concept that searches by meaning counts the whole library; the real version facets its own results.
	const concept = searchParams.concept ?? 1;
	const facetSearch =
		concept === 2 && !searchParams.literal && search.trim()
			? ((await understandQuery(search)) ?? search)
			: WORDS_ONLY_SCOPES.includes(searchParams.scope ?? "") && [1, 3, 5].includes(concept)
				? search
				: (concept === 1 && !searchParams.wordsOnly) || [3, 5].includes(concept) || (concept === 4 && searchParams.like)
				? ""
				: search;
	const searchResults = await index.search(facetSearch, {
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
				countryFacetOptions.reduce((acc, facet) => {
					acc[facet.key + "_uncategorized"] =
						searchResults.facetDistribution?.[facet.key] || {};
					return acc;
				}, {} as FacetDistribution),
			),
			{
				country,
				author_country,
			},
		),
	};
}

export async function getItemsPaginationMeta(
	searchParams: LibrarySearchParams,
): Promise<SearchCountOnlyResult> {
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = compileLibrarySearchRequest(searchParams);

	const index = meilisearchClient.index(
		process.env.MEILI_INDEX || config.index,
	);

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
