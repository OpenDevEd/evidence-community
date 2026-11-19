import { publicTagRules, recordPublishTags, type PublicTagRules } from "./tags";
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
	studyTypeFacet,
	type RuntimeSearch,
} from "@/config/library-config/search";
import type {
	LibraryPublicConfig,
	LibraryServerConfig,
} from "@/config/library-config/schema";
import { inferParserType } from "nuqs";
import { cacheLife, cacheTag } from "next/cache";
import { addRegionsToFacetDistribution, createCountryFilters } from "./country";
import { searchParamsLoader } from "./searchParams";
import { lastNumberedPage, offersSources, resolveSearchQuery, type SearchQueryConfig } from "./search-query";
import { SEARCH_RESULT_LIMITS, SOURCES_FIELD } from "./search-filter-constants";
import {
	decodeCursor,
	encodeCursor,
	fieldEquals,
	fieldIn,
	fieldNotEquals,
	fieldNotIn,
	fieldPresent,
	HAS_PDF_TEXT,
	searchOrder,
	yearRange,
	type FacetDistribution,
	type SearchFilter,
	type SearchOrder,
	type SearchRequest,
} from "./search-engine";
import { getSearchEngine } from "./search-engines";
import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import { CITATION_RECORD_COLUMNS } from "./citation-record-columns";
import { filterPublicAttachments, itemPageAttachments } from "./attachment-visibility";
import { getDatabaseForConfig } from "@/db";
import { readTopicTree, resolveTopicAncestry } from "./topics/catalog";
import { creatorFullName } from "./search-index/projection";
import { readAuthorProfiles } from "./authors/catalog-server";
import type { Author } from "@/app/api/item/types";
import { selectionFrontier, type TopicSelectionNode } from "./topics/selection";
import { inTagFilter, tagFacetKey, tagParam, tagSelections, type TagSelections } from "./tag-filters";
import { collectionNodes, collectionsMatch, deepestTicked } from "./collections-match";

/**
 * Result cards also open the item page before the full record loads, so they
 * carry every citation field and the citation does not change once it arrives.
 */
export const LIST_ITEM_FIELDS = [...new Set([
	...CITATION_RECORD_COLUMNS,
	// What decides whether readers get a record's files (`filterPublicAttachments`).
	"licence",
	"fileAccess",
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
	/** Where the next and previous pages continue from, past the pages readers reach by number. */
	cursors: { previous: string | null; next: string | null };
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

/**
 * Fields never sent: PDF full text, which is searched but not shown; a record's vector and what made it, which only
 * Elasticsearch holds; and topics when the library has them off.
 */
function hiddenFields(libraryConfig: Pick<LibraryServerConfig, "topics">) {
	return ["fullTextPDFs", "embedding", "embeddingHash", "embeddingModel", ...(libraryConfig.topics.enabled ? [] : ["topics", "topicAncestors"])];
}

/** Every public field a search sends. */
export function publicFields(libraryConfig: Pick<LibraryServerConfig, "topics">): SearchRequest["returned"] {
	return { except: hiddenFields(libraryConfig) };
}

/** One search of the library's records, in the engine its readers search: every filter must hold. */
export async function searchRecords<T = ListItem>(
	libraryConfig: Pick<LibraryServerConfig, "revision" | "search" | "services" | "updatedAt">,
	request: SearchRequest,
) {
	return (await getSearchEngine(libraryConfig)).search<T>(request);
}

/** A page of the records with these keys. */
export function searchKeys(
	libraryConfig: Pick<LibraryServerConfig, "revision" | "search" | "services" | "updatedAt">,
	keys: readonly string[],
	page: { number: number; size: number },
	request: Pick<SearchRequest, "returned" | "facets" | "exactTotal"> = {},
) {
	return searchRecords(libraryConfig, {
		text: "",
		fields: [],
		filters: [fieldIn("key", keys)],
		from: (page.number - 1) * page.size,
		size: page.size,
		...request,
	});
}

/** One record's search copy with every public field, or null when the library has none under this key. */
export async function readSearchDocument(libraryConfig: LibraryServerConfig, key: string) {
	return (await getSearchEngine(libraryConfig)).read<ListItem>(key, hiddenFields(libraryConfig));
}

/** A list result keeps only its public attachments that the item page reads. */
export function toLightweightItem(item: ListItem, rules: PublicTagRules): ListItem {
	return {
		...item,
		attachmentsData: itemPageAttachments(
			filterPublicAttachments(item, rules),
			recordPublishTags(rules.publishBySource, item.sourceConnectionKey),
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
	/** Each tag filter's ticks: a record carries any of a filter's, and every filter with ticks narrows. */
	tags?: TagSelections;
	/** Ticked collections a record may be in any of, in place of all of `collections`. */
	anyCollections?: readonly string[];
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

/** Ticked collections, all of them or any of `anyCollections`, and each tag filter's ticks, any of them. */
function collectionAndTagFilters(collections: readonly string[], anyCollections: readonly string[] | undefined, tags: TagSelections) {
	const collectionFilters = anyCollections
		? [anyCollections.length ? fieldIn("collectionsAncestry", anyCollections) : null]
		: collections.map((collection) => fieldEquals("collectionsAncestry", collection));
	return [...collectionFilters, ...Object.values(tags).map((ticked) => (ticked.length ? fieldIn("tags", ticked) : null))];
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
	tags = {},
	anyCollections,
}: SearchFilterInput) {
	return [
		fieldNotIn("itemType", EXCLUDED_ITEM_TYPES),
		yearRange(range),
		...institution.map((value) => fieldEquals(INSTITUTION_FILTER_FIELD, value)),
		...createCountryFilters(country, authorCountry),
		author ? fieldEquals("fullNames", author) : null,
		type.length ? fieldIn("itemType", type) : null,
		study.length ? fieldIn(studyField, study) : null,
		sources.length ? fieldIn(SOURCES_FIELD, sources) : null,
		scope === "documents" ? HAS_PDF_TEXT : null,
		...collectionAndTagFilters(collections, anyCollections, tags),
		fieldNotEquals("deleted", 1),
		hiddenTags.length ? fieldNotIn("tags", hiddenTags) : null,
	].filter((filter): filter is SearchFilter => filter !== null);
}

export function resolveSearchRequest(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryPublicConfig, "content" | "filters"> & Pick<SearchQueryConfig, "resultLimit" | "services"> & {
		search: RuntimeSearch;
		topics?: { enabled: boolean };
	},
	topicNodes: readonly TopicSelectionNode[] = [],
	perPage: number = ITEMS_PER_PAGE,
) {
	const {
		params: { page: pageNum, scope, institution, country, author_country, range, topics, sources, study },
	} = resolveSearchQuery(searchParams, libraryConfig, perPage);
	const search = searchParams.search || "";
	const collections = searchParams.collections || [];
	const facetFilters = buildSearchFilters({
		author: searchParams.author || "",
		collections,
		// The nodes hold the ticked collections' parents when they match any.
		anyCollections: collectionsMatch(searchParams.match, libraryConfig.filters) === "any" ? deepestTicked(collections, topicNodes) : undefined,
		// Asked without the param, as a whole-library view is, no defaults apply; a reader's address always has it.
		tags: searchParams.tags === undefined ? {} : tagSelections(searchParams.tags, libraryConfig.filters.tagFilters),
		type: searchParams.type ?? [],
		study,
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
		...(topicIds.length ? [fieldIn("topicAncestors", topicIds)] : []),
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

/** The tree nodes a search's ticks are read against: the chosen topics' paths, and the collections when ticked ones match any. */
export async function resolveSearchTopicNodes(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	libraryConfig: Pick<LibraryServerConfig, "authentication" | "filters" | "revision" | "services" | "topics" | "updatedAt">,
) {
	const selected = libraryConfig.topics.enabled
		? (searchParams.topics ?? [])
		: [];
	const anyCollections = (searchParams.collections?.length ?? 0) > 1 && collectionsMatch(searchParams.match, libraryConfig.filters) === "any";
	const [topics, collections] = await Promise.all([
		selected.length ? resolveTopicAncestry(selected, { database: await getDatabaseForConfig(libraryConfig), config: libraryConfig }, { allowUnknown: true }) : [],
		anyCollections ? getCachedCollections() : [],
	]);
	return [...topics, ...collectionNodes(collections as Collection[])];
}

async function readCachedTopicTree(
	_configRevision: string,
	libraryConfig: LibraryServerConfig,
) {
	"use cache";
	// New topics from an import show within five minutes; until then the last tree is served.
	cacheLife({ revalidate: 300 });
	const response = await searchRecords(libraryConfig, {
		text: "",
		fields: [],
		filters: publicRecordFilters(libraryConfig.content.tags.hidden),
		size: 0,
		exactTotal: false,
		facets: ["topicAncestors"],
	});
	return readTopicTree(Object.keys(response.facets.topicAncestors ?? {}), {
		database: await getDatabaseForConfig(libraryConfig),
		config: libraryConfig,
	});
}

/** Every topic a public item carries, with its ancestors: the whole topic filter in one response. */
export async function getPublicTopicTree(libraryConfig: LibraryServerConfig) {
	return readCachedTopicTree(libraryConfig.revision, libraryConfig);
}

/**
 * Where a page starts. Numbered pages start at their offset. Past them, a page continues after the record its `after`
 * cursor names, or before the one its `before` cursor names, read backwards. A deep page whose cursor belongs to
 * another order opens on the first page, and says so in its page number.
 */
export function pagePosition(
	page: number,
	pageSize: number,
	searchParams: { after?: string; before?: string },
	order: SearchOrder,
): { page: number; start: Pick<SearchRequest, "from" | "after" | "before"> } {
	if (page <= lastNumberedPage(pageSize, SEARCH_RESULT_LIMITS[order.engine])) return { page, start: { from: (page - 1) * pageSize } };
	const after = decodeCursor(searchParams.after, order);
	if (after) return { page, start: { after } };
	const before = decodeCursor(searchParams.before, order);
	if (before) return { page, start: { before } };
	return { page: 1, start: { from: 0 } };
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
	const engine = await getSearchEngine(libraryConfig);
	const order = searchOrder(engine.name, { text: search, sort: sortOption });
	const position = pagePosition(pageNum, pageSize, searchParams, order);
	const includeHeavyFields = options.includeHeavyFields === true;
	const returned = includeHeavyFields
		? publicFields(libraryConfig)
		: { only: LIST_ITEM_FIELDS.filter(attribute => libraryConfig.topics.enabled || attribute !== "topics") };

	const [response, collections] = await Promise.all([
		engine.search<ListItem>({ text: search, fields: attributesToSearchOn, filters: finalFilters, sort: sortOption, size: pageSize, returned, ...position.start }),
		getCachedCollections(libraryConfig),
	]);

	const rules = publicTagRules(libraryConfig);
	const items = response.hits.map((item) => {
		return includeHeavyFields
			? { ...item, attachmentsData: filterPublicAttachments(item, rules) }
			: toLightweightItem(item, rules);
	});

	applyCollectionsData(items, collections as Collection[]);

	const totalCount = response.total;
	const totalPages = Math.ceil(totalCount / pageSize);

	return {
		items,
		currentPage: position.page,
		totalItems: totalCount,
		perPage: pageSize,
		totalPages,
		cursors: {
			previous: position.page > 1 ? encodeCursor(order, response.first) : null,
			next: position.page < totalPages ? encodeCursor(order, response.last) : null,
		},
	};
}

/** The keys of the first `limit` records a public search finds, best first, and how many it finds in all. */
export async function getPublicItemKeys(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	limit: number,
	signal?: AbortSignal,
): Promise<{ keys: string[]; total: number }> {
	const libraryConfig = await getLibraryConfig();
	const topicNodes = await resolveSearchTopicNodes(searchParams, libraryConfig);
	const { search, sortOption, finalFilters, attributesToSearchOn } = resolveSearchRequest(searchParams, libraryConfig, topicNodes, limit);
	const response = await searchRecords(libraryConfig, {
		text: search,
		fields: attributesToSearchOn,
		filters: finalFilters,
		sort: sortOption,
		size: limit,
		returned: { only: ["key"] },
		signal,
	});
	return { keys: response.hits.map((hit) => String(hit.key)), total: response.total };
}

/** What keeps a search to public records: no excluded type, nothing deleted, nothing hidden. */
export const publicRecordFilters = (hiddenTags: readonly string[]) =>
	buildSearchFilters({ author: "", collections: [], country: [], hiddenTags, institution: [], range: null, scope: "" });

/** The public list copies of these records, as a result list holds them, in one search; hidden and deleted ones are left out. */
export async function getPublicItemsByKeys(keys: string[]): Promise<ListItem[]> {
	if (keys.length === 0) return [];
	const libraryConfig = await getLibraryConfig();
	const { tags } = libraryConfig.content;
	const [response, collections] = await Promise.all([
		searchRecords(libraryConfig, {
			text: "",
			fields: [],
			filters: [fieldIn("key", keys), ...publicRecordFilters(tags.hidden)],
			size: keys.length,
			returned: { only: [...LIST_ITEM_FIELDS] },
			exactTotal: false,
		}),
		getCachedCollections(libraryConfig),
	]);
	const items = response.hits.map((item) => toLightweightItem(item, publicTagRules(libraryConfig)));
	applyCollectionsData(items, collections as Collection[]);
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

	// A chosen year range or item type still shows the other years and types, so each is counted without its own filter.
	// Sources are too, and always out of the results some source holds: records made here belong to none.
	// Collections that match any are counted without the collection ticks, so the other branches keep theirs.
	// Each tag filter is counted without its own ticks, under a key of its own, since they share the tags facet.
	const { tagFilters } = libraryConfig.filters;
	const tagTicks = tagSelections(searchParams.tags, tagFilters);
	type OwnFilter = { facet: string; active: boolean; without: Partial<inferParserType<typeof searchParamsLoader>>; also?: SearchFilter[]; as?: string; keep?: (value: string) => boolean };
	const ownFilters = ([
		{ facet: "year", active: Boolean(searchParams.range), without: { range: "" } },
		{ facet: "itemType", active: Boolean(searchParams.type?.length), without: { type: [] } },
		{ facet: studyTypeFacet(libraryConfig.filters), active: Boolean(searchParams.study?.length), without: { study: [] } },
		{ facet: SOURCES_FIELD, active: offersSources(libraryConfig), without: { sources: [] }, also: [fieldPresent(SOURCES_FIELD)] },
		{ facet: "collectionsAncestry", active: Boolean(searchParams.collections?.length) && collectionsMatch(searchParams.match, libraryConfig.filters) === "any", without: { collections: [] } },
		...tagFilters.filter((filter) => filter.enabled).map((filter) => ({
			facet: "tags",
			as: tagFacetKey(filter.id),
			active: true,
			without: searchParams.tags === undefined ? {} : { tags: tagParam({ ...tagTicks, [filter.id]: [] }, tagFilters) },
			keep: (tag: string) => inTagFilter(filter, tag),
		})),
	] satisfies OwnFilter[] as OwnFilter[]).filter(({ facet, active, as }) => active && (as || facets.includes(facet)));

	const count = (facetsToCount: readonly string[], filters: readonly SearchFilter[]) =>
		searchRecords(libraryConfig, { text: search, fields: attributesToSearchOn, filters, size: 0, facets: facetsToCount });
	const [searchResults, topicResults, ...ownResults] = await Promise.all([
		count(facets, finalFilters),
		facets.includes("topicAncestors") && finalFilters.length !== facetFilters.length ? count(["topicAncestors"], facetFilters) : null,
		...ownFilters.map(({ facet, without, also = [] }) =>
			count([facet], [...resolveSearchRequest({ ...searchParams, ...without }, libraryConfig, topicNodes).finalFilters, ...also]),
		),
	]);
	const totals: FacetTotals = { "*": searchResults.total };
	if (topicResults) totals.topicAncestors = topicResults.total;
	ownFilters.forEach(({ facet, as }, index) => {
		totals[as ?? facet] = ownResults[index].total;
	});
	const distribution: FacetDistribution = Object.assign(
		{},
		searchResults.facets,
		topicResults ? topicResults.facets : {},
		...ownResults.map((result, index) => {
			const { facet, as, keep } = ownFilters[index];
			const counted = result.facets;
			if (!as) return counted;
			const counts = Object.entries(counted[facet] ?? {}).filter(([value]) => !keep || keep(value));
			return { [as]: Object.fromEntries(counts) };
		}),
	);

	return {
		facetDistribution: publicFacetDistribution(
			distribution,
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
		finalFilters,
		attributesToSearchOn,
	} = resolveSearchRequest(searchParams, libraryConfig, topicNodes);

	const { total: totalItems } = await searchRecords(libraryConfig, { text: search, fields: attributesToSearchOn, filters: finalFilters, size: 0 });

	return {
		currentPage: pageNum,
		perPage: limitNum,
		totalItems,
		totalPages: Math.ceil(totalItems / limitNum),
	};
}

/** How many people the sidebar ranks. */
const TOP_AUTHORS = 10;
/** Names counted to rank the top authors: past this many, a library of 400,000 authors takes over 30 seconds to count. */
const AUTHORS_RANKED = 100;

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
	const ranked = await searchRecords(libraryConfig, {
		text: search,
		fields: attributesToSearchOn,
		filters: finalFilters,
		size: 0,
		facets: ["fullNames"],
		facetLimit: AUTHORS_RANKED,
	});
	const everyone = ranked.facets.fullNames ?? {};
	const top = Object.entries(everyone)
		.filter(([name]) => name.trim().length > 1)
		.sort((left, right) => right[1] - left[1])
		.slice(0, TOP_AUTHORS);
	const names = top.map(([name]) => name);
	if (names.length === 0) return { authorCount: 0, authors: [], combined: {} };
	const institutions = libraryConfig.filters.institution.mode !== "hidden";
	const searched = { text: search, fields: attributesToSearchOn };
	const [all, ...perAuthor] = await (await getSearchEngine(libraryConfig)).searchMany<ListItem>([
		{ ...searched, filters: [...finalFilters, fieldIn("fullNames", names)], size: 0, facets: ["year"] },
		...names.map((name) => ({
			...searched,
			filters: [...finalFilters, fieldEquals("fullNames", name)],
			// Some of their results: the profile their name is linked to, and the institutions they themselves are listed
			// with, not their co-authors' (a record's institution facet counts everyone's).
			size: INSTITUTION_SAMPLE,
			returned: { only: ["creators"] },
			facets: ["year", "fullNames"],
		})),
	]);
	const profileIds = names.map((name, position) => profileIdOf(perAuthor[position]?.hits[0], name));
	const profiles = new Map((await readAuthorProfiles(profileIds.filter((id): id is string => Boolean(id)))).map((profile) => [profile.id, profile]));
	const authors = top.map(([name, count], position): AuthorActivity => {
		const distribution = perAuthor[position]?.facets ?? {};
		const profileId = profileIds[position];
		return {
			name,
			count,
			years: distribution.year ?? {},
			together: sharedWith(name, names, distribution.fullNames ?? {}),
			institution: ownInstitution(institutions, perAuthor[position]?.hits, name),
			photo: profileId ? (profiles.get(profileId)?.photo ?? null) : null,
		};
	});
	return { authorCount: ranked.distinct?.fullNames ?? Object.keys(everyone).length, authors, combined: all?.facets.year ?? {} };
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

/** Results read for each top author to tell their own institution. */
const INSTITUTION_SAMPLE = 20;

/** How many of these results list the author, by the name the index files them under, at each institution. */
export function ownInstitutions(hits: readonly Pick<ListItem, "creators">[], name: string) {
	const counts: Record<string, number> = {};
	// The search finds them ignoring case and accents, so their entries may spell the name another way.
	const theirs = folded(name);
	for (const hit of hits) {
		const creator = ((hit.creators ?? []) as Author[]).find((entry) => folded(creatorFullName(entry)) === theirs);
		for (const institution of new Set((creator?.institutions ?? []).map((entry) => entry.display_name?.trim()).filter(Boolean)))
			counts[institution!] = (counts[institution!] ?? 0) + 1;
	}
	return counts;
}

/** A name as the search compares it: case and accents left out. */
const folded = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** The institution most of these results list the author at, if any does and the library shows institutions. */
const ownInstitution = (shown: boolean, hits: readonly Pick<ListItem, "creators">[] | undefined, name: string) => (shown ? mostNamed(ownInstitutions(hits ?? [], name)) : null);

/** The value most results name in a facet, if any does. */
function mostNamed(counts: Record<string, number>) {
	return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

export async function getTopAuthors(searchParams: Partial<inferParserType<typeof searchParamsLoader>>) {
	const libraryConfig = await getLibraryConfig();
	return readTopAuthors(libraryConfig.revision, libraryConfig, searchParams);
}
