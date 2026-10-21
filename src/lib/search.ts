import { publicTagRules, recordPublishTags, type PublicTagRules } from "./tags";
import { getCachedCollections, getCachedSources } from "@/app/api/cache";
import { cardTagsFor } from "./card-tags";
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
	studyTypeFacet,
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
import { offersSources, resolveSearchQuery } from "./search-query";
import { formatRange } from "./utils";
import { meilisearchEquals, meilisearchIn } from "./meilisearch-filter";
import { FULL_TEXT_PDF_FILTER, SOURCES_FIELD } from "./search-filter-constants";
import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import { CITATION_RECORD_COLUMNS } from "./citation-record-columns";
import { filterPublicAttachments, itemPageAttachments } from "./attachment-visibility";
import { getDatabaseForConfig } from "@/db";
import { readTopicTree, resolveTopicAncestry } from "./topics/catalog";
import { creatorFullName } from "./search-index/projection";
import { readAuthorProfiles } from "./authors/catalog-server";
import type { Author } from "@/app/api/item/types";
import { selectionFrontier, type TopicSelectionNode } from "./topics/selection";

/**
 * Result cards also open the item page before the full record loads, so they
 * carry every citation field and the citation does not change once it arrives.
 */
export const LIST_ITEM_FIELDS = [...new Set([
	...CITATION_RECORD_COLUMNS,
	"citationCount",
	"itemType",
	"reading",
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
	SOURCES_FIELD,
	"topics",
	"citationMetrics",
	"openAccess",
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
	/**
	 * How many results each facet's counts are out of: `*` for the filtered results, and for a facet counted without
	 * its own filter (topics, years, item types), the results without that filter.
	 */
	totals: FacetTotals;
};

type FacetTotals = Record<string, number>;

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
		(attribute) =>
			attribute !== "fullTextPDFs" &&
			!attribute.startsWith("fullTextPDFs.") &&
			(libraryConfig.topics.enabled || (attribute !== "topics" && attribute !== "topicAncestors")),
	);
}

/** A list result keeps only its public attachments that the item page reads. */
export function toLightweightItem(item: ListItem, rules: PublicTagRules): ListItem {
	return {
		...item,
		attachmentsData: itemPageAttachments(
			filterPublicAttachments(item.attachmentsData, rules, item.sourceConnectionKey),
			recordPublishTags(rules.publishBySource, item.sourceConnectionKey),
		),
	};
}

/** Each record's collections by name, and the groups its card names it a member of. */
async function applyCollectionsData(items: ListItem[], collections: Collection[], config: LibraryServerConfig) {
	const collectionMap = new Map(
		collections.map((collection) => [collection.key, collection]),
	);
	const tagsBySource = config.content.cardTags.some((group) => group.enabled && group.from === "sources");
	const cardTags = cardTagsFor(config, collections, tagsBySource ? await getCachedSources(config) : []);

	for (const item of items) {
		item.collectionsData = item.collectionsAncestry
			?.map((collectionKey: string) => collectionMap.get(collectionKey))
			.filter(
				(collectionData): collectionData is Collection =>
					!!collectionData,
			);
		item.cardTags = cardTags(item);
	}
}

type SearchFilterInput = {
	author: string;
	collections: string[];
	country: string[];
	/** Countries of the authors' affiliations. */
	authorCountry?: string[];
	hiddenTags: readonly string[];
	institution: string[];
	range: string | null;
	scope: string;
	/** Item types, any of them. */
	type?: readonly string[];
	/** Study types, any of them, as the AI read each record. */
	study?: readonly string[];
	/** The field study types are filtered by, as the library's settings choose. */
	studyField?: string;
	/** The library's sources, any of them. */
	sources?: readonly string[];
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
	authorCountry = [],
	hiddenTags,
	institution,
	range,
	scope,
	type = [],
	study = [],
	studyField = "studyType",
	sources = [],
}: SearchFilterInput) {
	return [
		`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
		range ? formatRange(range) : null,
		...institution.map((value) =>
			meilisearchEquals(INSTITUTION_FILTER_FIELD, value),
		),
		...createCountryFilters(country, authorCountry),
		author ? meilisearchEquals("fullNames", author) : null,
		type.length ? meilisearchIn("itemType", type) : null,
		study.length ? meilisearchIn(studyField, study) : null,
		sources.length ? meilisearchIn(SOURCES_FIELD, sources) : null,
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
		topics?: { enabled: boolean };
	},
	topicNodes: readonly TopicSelectionNode[] = [],
	perPage: number = ITEMS_PER_PAGE,
) {
	const {
		params: { page: pageNum, scope, institution, country, author_country, range, topics, sources },
	} = resolveSearchQuery(searchParams, libraryConfig, perPage);
	const search = searchParams.search || "";
	const facetFilters = buildSearchFilters({
		author: searchParams.author || "",
		collections: searchParams.collections || [],
		type: searchParams.type ?? [],
		study: searchParams.study ?? [],
		studyField: studyTypeFacet(libraryConfig.filters),
		country,
		authorCountry: author_country,
		hiddenTags: libraryConfig.content.tags.hidden,
		institution,
		range,
		scope,
		sources,
	});
	// A topic the library does not have matches nothing, as an unknown type
	// does. Left out of the filter, it would match everything.
	const known = selectionFrontier(topics, topicNodes);
	const topicIds = known.length > 0 ? known : topics;
	const finalFilters = [
		...facetFilters,
		...(topicIds.length ? [meilisearchIn("topicAncestors", topicIds)] : []),
	];

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
		facetFilters,
		attributesToSearchOn,
		country,
		authorCountry: author_country,
	};
}

export async function resolveSearchTopicNodes(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryServerConfig, "authentication" | "revision" | "services" | "topics" | "updatedAt">,
) {
	const selected = libraryConfig.topics.enabled
		? (searchParams.topics ?? [])
		: [];
	if (!selected.length) return [];
	const database = await getDatabaseForConfig(libraryConfig);
	return resolveTopicAncestry(selected, { database, config: libraryConfig }, {allowUnknown: true});
}

async function readCachedTopicTree(
	_configRevision: string,
	libraryConfig: LibraryServerConfig,
) {
	"use cache";
	// New topics from an import show within five minutes; until then the last tree is served.
	cacheLife({ revalidate: 300 });
	const { index } = await getMeilisearchForConfig(libraryConfig);
	const { facetDistribution } = await index.search("", {
		limit: 0,
		facets: ["topicAncestors"],
		filter: buildSearchFilters({
			author: "",
			collections: [],
			country: [],
			hiddenTags: libraryConfig.content.tags.hidden,
			institution: [],
			range: null,
			scope: "",
		}),
	});
	return readTopicTree(Object.keys(facetDistribution?.topicAncestors ?? {}), {
		database: await getDatabaseForConfig(libraryConfig),
		config: libraryConfig,
	});
}

/** Every topic a public item carries, with its ancestors: the whole topic filter in one response. */
export async function getPublicTopicTree(libraryConfig: LibraryServerConfig) {
	return readCachedTopicTree(libraryConfig.revision, libraryConfig);
}

export async function getPublicItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	options: {
		includeHeavyFields?: boolean;
		/** Results on one page, when not a listing page's worth. */
		perPage?: number;
	} = {},
): Promise<SearchItemsResult> {
	const libraryConfig = await getLibraryConfig();
	const displayedAttributes = await getMainAttributes(libraryConfig);
	const topicNodes = await resolveSearchTopicNodes(
		searchParams,
		libraryConfig,
	);
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = resolveSearchRequest(
		searchParams,
		libraryConfig,
		topicNodes,
		options.perPage,
	);

	const pageSize = options.perPage ?? limitNum;
	const page = pageNum;
	const includeHeavyFields = options.includeHeavyFields === true;
	const attributesToRetrieve = includeHeavyFields
		? displayedAttributes
		: LIST_ITEM_FIELDS.filter(attribute => libraryConfig.topics.enabled || attribute !== "topics");

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const [searchResults, collections] = await Promise.all([
		index.search(search, {
			offset: (page - 1) * pageSize,
			limit: pageSize,
			attributesToSearchOn,
			attributesToRetrieve,
			...(sortOption ? { sort: sortOption } : {}),
			filter: finalFilters,
		}),
		getCachedCollections(libraryConfig),
	]);

	const rules = publicTagRules(libraryConfig);
	const items = (searchResults.hits as ListItem[]).map((item) =>
		includeHeavyFields
			? { ...item, attachmentsData: filterPublicAttachments(item.attachmentsData, rules, item.sourceConnectionKey) }
			: toLightweightItem(item, rules),
	);

	await applyCollectionsData(items, collections as Collection[], libraryConfig);

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

/** The keys of the first `limit` records a public search finds, best first, and how many it finds in all. */
export async function getPublicItemKeys(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	limit: number,
): Promise<{ keys: string[]; total: number }> {
	const libraryConfig = await getLibraryConfig();
	const topicNodes = await resolveSearchTopicNodes(searchParams, libraryConfig);
	const { search, sortOption, finalFilters, attributesToSearchOn } = resolveSearchRequest(searchParams, libraryConfig, topicNodes, limit);
	const { index } = await getMeilisearchForConfig(libraryConfig);
	const result = await index.search(search, {
		limit,
		attributesToSearchOn,
		attributesToRetrieve: ["key"],
		...(sortOption ? { sort: sortOption } : {}),
		filter: finalFilters,
	});
	return { keys: result.hits.map((hit) => String(hit.key)), total: result.estimatedTotalHits ?? result.hits.length };
}

/** What keeps a search to public records: no excluded type, nothing deleted, nothing hidden. */
export const publicRecordFilters = (hiddenTags: readonly string[]) =>
	buildSearchFilters({ author: "", collections: [], country: [], hiddenTags, institution: [], range: null, scope: "" });

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
				...publicRecordFilters(tags.hidden),
			],
		}),
		getCachedCollections(libraryConfig),
	]);
	const items = (searchResults.hits as ListItem[]).map((item) => toLightweightItem(item, publicTagRules(libraryConfig)));
	await applyCollectionsData(items, collections as Collection[], libraryConfig);
	return items;
}

export async function getPublicFacets(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
): Promise<SearchFacetsResult> {
	const libraryConfig = await getLibraryConfig();
	const topicNodes = await resolveSearchTopicNodes(
		searchParams,
		libraryConfig,
	);
	const { search, finalFilters, facetFilters, attributesToSearchOn, country, authorCountry } =
		resolveSearchRequest(searchParams, libraryConfig, topicNodes);

	const facets = getRuntimeSearchFacets(
		libraryConfig.search,
		libraryConfig.filters,
		libraryConfig.topics.enabled,
	);

	const { index } = await getMeilisearchForConfig(libraryConfig);

	// A chosen year range or item type still shows the other years and types, so each is counted without its own filter.
	// Sources are too, and always out of the results some source holds: records made here belong to none.
	const ownFilters = [
		{ facet: "year", active: Boolean(searchParams.range), without: { range: "" } },
		{ facet: "itemType", active: Boolean(searchParams.type?.length), without: { type: [] } },
		{ facet: studyTypeFacet(libraryConfig.filters), active: Boolean(searchParams.study?.length), without: { study: [] } },
		{ facet: SOURCES_FIELD, active: offersSources(libraryConfig), without: { sources: [] }, also: [`${SOURCES_FIELD} IS NOT EMPTY`] },
	].filter(({ facet, active }) => active && facets.includes(facet));

	const [searchResults, topicResults, ...ownResults] = await Promise.all([
		index.search(search, {
			offset: 0, limit: 0, attributesToSearchOn, facets, filter: finalFilters,
		}),
		facets.includes("topicAncestors") && finalFilters.length !== facetFilters.length
			? index.search(search, {
				offset: 0, limit: 0, attributesToSearchOn, facets: ["topicAncestors"], filter: facetFilters,
			})
			: null,
		...ownFilters.map(({ facet, without, also = [] }) =>
			index.search(search, {
				offset: 0, limit: 0, attributesToSearchOn, facets: [facet],
				filter: [...resolveSearchRequest({ ...searchParams, ...without }, libraryConfig, topicNodes).finalFilters, ...also],
			}),
		),
	]);
	const totals: FacetTotals = { "*": searchResults.estimatedTotalHits ?? 0 };
	if (topicResults) totals.topicAncestors = topicResults.estimatedTotalHits ?? 0;
	ownFilters.forEach(({ facet }, index) => {
		totals[facet] = ownResults[index].estimatedTotalHits ?? 0;
	});
	searchResults.facetDistribution = Object.assign(
		{},
		searchResults.facetDistribution,
		topicResults?.facetDistribution,
		...ownResults.map((result) => result.facetDistribution),
	);

	return {
		facetDistribution: publicFacetDistribution(
			searchResults.facetDistribution,
			facets,
			{ country, author_country: authorCountry },
		),
		totals,
	};
}

/** Facet counts with each country facet's raw values kept beside its regions. */
export function publicFacetDistribution(
	distribution: FacetDistribution | undefined,
	facets: readonly string[],
	chosen: { country: string[]; author_country: string[] },
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
		chosen,
	);
}

export async function getItemsPaginationMeta(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
): Promise<SearchCountOnlyResult> {
	const libraryConfig = await getLibraryConfig();
	const topicNodes = await resolveSearchTopicNodes(
		searchParams,
		libraryConfig,
	);
	const {
		search,
		pageNum,
		limitNum,
		sortOption,
		finalFilters,
		attributesToSearchOn,
	} = resolveSearchRequest(searchParams, libraryConfig, topicNodes);

	const { index } = await getMeilisearchForConfig(libraryConfig);

	const searchResults = await index.search(search, {
		offset: 0,
		limit: 0,
		attributesToSearchOn,
		...(sortOption ? { sort: sortOption } : {}),
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

/** How many people the sidebar ranks. */
const TOP_AUTHORS = 10;

export type AuthorActivity = {
	name: string;
	/** Their results under the search and filters. */
	count: number;
	/** Their results by year. */
	years: Record<string, number>;
	/** How many of their results each of the other top authors shares. */
	together: Record<string, number>;
	/** The institution most of their results name, if any does. */
	institution: string | null;
	/** Their photo, when one of their results links them to an author profile that has one. */
	photo: string | null;
};

export type TopAuthors = {
	/** How many different people the results name, up to the facet's limit of 10,000. */
	authorCount: number;
	authors: AuthorActivity[];
	/** The results any of the top authors wrote, by year: a publication several of them wrote counts once. */
	combined: Record<string, number>;
};

/**
 * The people with the most results under a search and filters, and for each when they published, whom they share work
 * with, their main institution and photo. Ranking them counts every name in the results, the costliest search the
 * sidebar makes, so it runs here, apart from the facets the filters need and only for the sidebar, and its answer is
 * kept for five minutes per search and filters. Everything after the ranking goes in one multi-search request.
 */
async function readTopAuthors(
	_configRevision: string,
	libraryConfig: LibraryServerConfig,
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
): Promise<TopAuthors> {
	"use cache";
	cacheLife({ revalidate: 300 });
	// Cleared with every public record when an editor clears the public cache.
	cacheTag("library");
	const topicNodes = await resolveSearchTopicNodes(searchParams, libraryConfig);
	const { search, finalFilters, attributesToSearchOn } = resolveSearchRequest(searchParams, libraryConfig, topicNodes);
	const { client, index } = await getMeilisearchForConfig(libraryConfig);
	const ranked = await index.search(search, { offset: 0, limit: 0, attributesToSearchOn, facets: ["fullNames"], filter: finalFilters });
	const everyone = (ranked.facetDistribution?.fullNames ?? {}) as Record<string, number>;
	const top = Object.entries(everyone)
		.filter(([name]) => name.trim().length > 1)
		.sort((left, right) => right[1] - left[1])
		.slice(0, TOP_AUTHORS);
	const names = top.map(([name]) => name);
	if (names.length === 0) return { authorCount: 0, authors: [], combined: {} };
	const institutions = libraryConfig.filters.institution.mode !== "hidden";
	const indexUid = index.uid;
	const { results } = await client.multiSearch({
		queries: [
			{ indexUid, q: search, limit: 0, attributesToSearchOn, facets: ["year"], filter: [...finalFilters, meilisearchIn("fullNames", names)] },
			...names.map((name) => ({
				indexUid, q: search, attributesToSearchOn,
				// One of their results, to find the profile their name is linked to on it.
				limit: 1, attributesToRetrieve: ["creators"],
				facets: ["year", "fullNames", ...(institutions ? [INSTITUTION_FILTER_FIELD] : [])],
				filter: [...finalFilters, meilisearchEquals("fullNames", name)],
			})),
		],
	});
	const [all, ...perAuthor] = results;
	const profileIds = names.map((name, position) => profileIdOf(perAuthor[position]?.hits[0] as ListItem | undefined, name));
	const profiles = new Map((await readAuthorProfiles(profileIds.filter((id): id is string => Boolean(id)))).map((profile) => [profile.id, profile]));
	const authors = top.map(([name, count], position): AuthorActivity => {
		const distribution = (perAuthor[position]?.facetDistribution ?? {}) as Record<string, Record<string, number>>;
		const profileId = profileIds[position];
		return {
			name,
			count,
			years: distribution.year ?? {},
			together: sharedWith(name, names, distribution.fullNames ?? {}),
			institution: mostNamed(distribution[INSTITUTION_FILTER_FIELD] ?? {}),
			photo: profileId ? (profiles.get(profileId)?.photo ?? null) : null,
		};
	});
	return { authorCount: Object.keys(everyone).length, authors, combined: (all?.facetDistribution?.year ?? {}) as Record<string, number> };
}

/** The profile a result links an author to, found by the name the index files them under. */
function profileIdOf(hit: ListItem | undefined, name: string) {
	const creators = (hit?.creators ?? []) as Author[];
	return creators.find((creator) => creatorFullName(creator) === name)?.authorProfileId ?? null;
}

/** How many results an author shares with each of the other named authors; only those leave the server, not everyone they wrote with. */
function sharedWith(name: string, names: readonly string[], coauthors: Record<string, number>) {
	return Object.fromEntries(names.filter((other) => other !== name && coauthors[other]).map((other) => [other, coauthors[other]]));
}

/** The value most results name in a facet, if any does. */
function mostNamed(counts: Record<string, number>) {
	return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

export async function getTopAuthors(searchParams: Partial<inferParserType<typeof searchParamsLoader>>) {
	const libraryConfig = await getLibraryConfig();
	return readTopAuthors(libraryConfig.revision, libraryConfig, searchParams);
}
