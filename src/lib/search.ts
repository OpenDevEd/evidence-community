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
import { cacheLife } from "next/cache";
import { addRegionsToFacetDistribution, createCountryFilters } from "./country";
import meilisearchClient from "./meilisearch";
import { searchParamsLoader } from "./searchParams";
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
	facetDistribution: FacetDistribution;
};

function cleanTheAttributesToSearchOn(fields: string[]) {
	let nextFields = fields;

	if (process.env.NEXT_PUBLIC_DISABLE_FULLTEXT === "true") {
		nextFields = nextFields.filter((field) => !field.includes("fullTextPDF"));
	}

	if (process.env.NEXT_PUBLIC_DISABLE_TAGS === "true") {
		nextFields = nextFields.filter((field) => !field.includes("tags"));
	}

	return nextFields;
}

export async function getMainAttributes() {
	"use cache";
	cacheLife({ revalidate: 60 });
	const attributes = await meilisearchClient
		.index(process.env.MEILI_INDEX || config.index)
		.getDisplayedAttributes();

	return attributes.filter((attribute: string) => !attribute.endsWith("fullTextPDFs"));
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

export async function searchPublicIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties: Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1] | undefined,
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"],
	options: {
		includeHeavyFields?: boolean;
		countOnly: true;
	}
): Promise<SearchCountOnlyResult>;
export async function searchPublicIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties?: Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1],
	extraFilters?: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"],
	options?: {
		includeHeavyFields?: boolean;
		countOnly?: false;
	}
): Promise<SearchItemsResult>;
export async function searchPublicIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties: Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1] = {},
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"] = [],
	options: {
		includeHeavyFields?: boolean;
		countOnly?: boolean;
	} = {}
): Promise<SearchItemsResult | SearchCountOnlyResult> {
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
	const includeHeavyFields = options.includeHeavyFields === true;
	const countOnly = options.countOnly === true;

	const index = meilisearchClient.index(process.env.MEILI_INDEX || config.index);

	const effectiveSort =
		search.trim().length === 0 && sort === SORT_OPTIONS[0].key
			? SORT_OPTIONS[1].key
			: sort;
	const sortOption =
		SORT_OPTIONS.find((option) => option.key === effectiveSort)?.sort ||
		SORT_OPTIONS[0].sort;

	const countryFilters = createCountryFilters(country, author_country);

	const finalFilters = [
		`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
		range ? formatRange(range) : null,
		...(Array.isArray(institution)
			? institution.map((institutionValue) => `institution = "${institutionValue}"`)
			: []),
		...countryFilters,
		author ? `fullNames = "${author}"` : null,
		scope === "documents" ? `fullTextPDFs.fullTextPDF.text EXISTS` : null,
		...(Array.isArray(extraFilters) ? extraFilters : []),
		"deleted != 1",
		`tags NOT IN ${JSON.stringify(blockedTags)}`,
	].filter((filter): filter is string => filter !== null);

	const attributesToSearchOn = cleanTheAttributesToSearchOn(
		SCOPE_OPTIONS.find((option) => option.key === scope)?.attributesToSearchOn ||
			SCOPE_OPTIONS[0].attributesToSearchOn
	);

	if (countOnly) {
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

	const attributesToRetrieve = includeHeavyFields ? await getMainAttributes() : [...LIST_ITEM_FIELDS];

	const [searchResults, collections] = await Promise.all([
		index.search(search, {
			offset: (pageNum - 1) * limitNum,
			limit: limitNum,
			attributesToSearchOn,
			attributesToRetrieve,
			...(sortOption ? { sort: [sortOption] } : {}),
			...extraProperties,
			filter: finalFilters,
		}),
		getCachedCollections(),
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
		facetDistribution: addRegionsToFacetDistribution(
			Object.assign(
				{},
				searchResults.facetDistribution,
				countryFacetOptions.reduce((acc, facet) => {
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

export async function getPublicItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	options: {
		includeHeavyFields?: boolean;
	} = {}
): Promise<SearchItemsResult> {
	const facets = [...DEFAULT_FACETS];

	if (process.env.NEXT_PUBLIC_DISABLE_COUNTRY !== "true") {
		facets.push("country");
	}
	if (process.env.NEXT_PUBLIC_DISABLE_AUTHOR_COUNTRY !== "true") {
		facets.push("creators.institutions.country_code");
	}

	const collections = searchParams.collections || [];
	return searchPublicIndex(
		searchParams,
		{
			facets,
		},
		[
			...collections.map(
				(collection: string) => `collectionsAncestry = "${collection}"`
			),
		],
		{
			...options,
			countOnly: false,
		}
	);
}
