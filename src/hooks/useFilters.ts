import { useCallback, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/routing";
import { useQueryStates } from "nuqs";
import { fetcher, buildFacetsQuery } from "@/lib/utils";
import { searchParamsLoader } from "@/lib/searchParams";
import {
	Collection,
	CollectionsGetResponse,
} from "@/app/api/collections/types";
import { FacetsGetResponse } from "@/app/api/facets/types";
import type { SourcesGetResponse } from "@/app/api/sources/types";
import { CollectionNoteGetResponse } from "@/app/api/collections/[id]/note/types";
import {
	buildHierarchy,
	getDescendantKeys,
	recursiveFind,
} from "@/lib/collections";
import { isAdminPath, normalizePathname } from "@/lib/path";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { resolveSearchQuery } from "@/lib/search-query";

const SWR_OPTIONS = {
	keepPreviousData: true,
	revalidateOnFocus: false,
	revalidateOnReconnect: false,
	revalidateIfStale: false,
};

/**
 * The shared "filters" slice of the library state: the nuqs query params, the
 * collections tree + hierarchy, the facet distribution, the collection note,
 * and every selection handler.
 *
 * It is split out of {@link useItemsList} (which layers the page-specific items
 * results on top) so it can be hoisted into one app-level provider
 * (`FiltersProvider`). The navbar's filter chips / Explore modal and the library
 * page then read the SAME instance, which:
 *   - removes the duplicate `/collections` + `/facets` fetches each consumer
 *     used to fire on its own, and
 *   - keeps the data resident across navigation, so opening an item no longer
 *     drops and re-pops the active-filter chips while collections "reload".
 *
 * It owns NO items fetch and takes no `userData` — it is the public, shared
 * filtering surface.
 */
/**
 * A page with something above its list (a reader's card) marks where the list
 * starts with this id. Changing page or collection then returns to the list
 * instead of the top of the page, and only when the list's top has scrolled
 * out of view, so it never moves the page down.
 */
export const LIST_TOP_ID = "list-top";

function returnToListTop() {
	const listTop = document.getElementById(LIST_TOP_ID);
	if (!listTop) return undefined;
	if (listTop.getBoundingClientRect().top < 0) listTop.scrollIntoView({ block: "start" });
	return { scroll: false };
}

export function useFilters() {
	const [params, setParams] = useQueryStates(searchParamsLoader);
	const config = useLibraryConfig();
	const { features, filters, search } = config;
	// What the address says, put right for this library, so the API is only
	// ever asked for a search it offers.
	const runtimeParams = useMemo(
		() => resolveSearchQuery(params, { filters, search, topics: config.topics }).params,
		[config.topics, filters, params, search],
	);

	// Raw search params, only needed downstream for atom-feed serialization.
	const rawSearchParams = useSearchParams();
	const searchParams = useMemo(
		() =>
			Object.fromEntries(rawSearchParams.entries()) as Record<
				string,
				string
			>,
		[rawSearchParams],
	);

	const pathname = usePathname();
	const normalizedPathname = normalizePathname(pathname);
	const admin = isAdminPath(normalizedPathname, "");
	// Facets are only meaningful where a filtering surface exists: the library
	// and map listings, or anywhere the navbar search (with its Explore button)
	// is shown. Everywhere else we skip the request so lifting this provider to
	// the whole app doesn't fan facet queries out across every page.
	const filterSurfaceEnabled =
		!admin &&
		(normalizedPathname === "/lib" ||
			normalizedPathname.startsWith("/map") ||
			normalizedPathname.startsWith("/evidence") ||
			isLibraryFeatureEnabled(features, "navbarSearch"));

	const { data: noteData, isLoading: isNoteLoading } =
		useSWR<CollectionNoteGetResponse>(
			!admin && runtimeParams.collections.length === 1
				? `/collections/${runtimeParams.collections[0]}/note`
				: null,
			fetcher,
		);

	const handlePageChange = useCallback(
		(newPage: number) => {
			setParams({ page: newPage }, returnToListTop());
		},
		[setParams],
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value) setParams({ sort: value });
		},
		[setParams],
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value) setParams({ scope: value });
		},
		[setParams],
	);

	const handleSearchChange = useCallback(
		(text: string) => setParams({ search: text, page: 1 }),
		[setParams],
	);

	// What the results' search box holds and hasn't searched for yet (its wait, SearchBar), read when an action such
	// as Open in OpenScholar has to act on what the reader typed.
	const typedSearch = useRef<string | null>(null);
	const noteTypedSearch = useCallback((text: string | null) => {
		typedSearch.current = text;
	}, []);
	const readTypedSearch = useCallback(() => typedSearch.current, []);

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			setParams({ range: [start, end].join(end !== null ? "-" : "") });
		},
		[setParams],
	);

	const handleCollectionSelect = useCallback(
		(collectionId: string) => {
			setParams(
				{ collectionId: collectionId === params.collectionId ? "" : collectionId },
				returnToListTop(),
			);
		},
		[params.collectionId, setParams],
	);

	const handleAuthorSelect = useCallback(
		(author: string) => {
			setParams({ author: author === params.author ? "" : author, page: 1 });
		},
		[params.author, setParams],
	);

	const handleInstitutionSelect = useCallback(
		(institution: string | string[]) => {
			if (Array.isArray(institution)) {
				setParams({
					institution: Array.from(
						new Set([...params.institution, ...institution]),
					),
				});
			} else if (params.institution.includes(institution)) {
				setParams({
					institution: params.institution.filter(
						(i) => i !== institution,
					),
				});
			} else {
				setParams({
					institution: [...params.institution, institution],
				});
			}
		},
		[params.institution, setParams],
	);

	/** The map's circle for one institution, whose records may spell it more than one way: chooses every spelling, or unchooses them all. */
	const handleInstitutionToggle = useCallback(
		(names: string[]) => setParams({ institution: toggledNames(params.institution, names) }),
		[params.institution, setParams],
	);

	const handleCountrySelect = useCallback(
		(country: string | string[]) => setParams({ country: toggledPlaces(params.country, country) }),
		[params.country, setParams],
	);

	const handleAuthorCountrySelect = useCallback(
		(country: string | string[]) => setParams({ author_country: toggledPlaces(params.author_country, country) }),
		[params.author_country, setParams],
	);

	const handleTopicsChange = useCallback(
		(topics: string[]) => setParams({ topics, page: 1 }),
		[setParams],
	);

	const handleSourceSelect = useCallback(
		(source: string) =>
			setParams({
				sources: params.sources.includes(source)
					? params.sources.filter((value) => value !== source)
					: [...params.sources, source],
				page: 1,
			}),
		[params.sources, setParams],
	);

	const handleTypeSelect = useCallback(
		(type: string) =>
			setParams({
				type: params.type.includes(type)
					? params.type.filter((value) => value !== type)
					: [...params.type, type],
				page: 1,
			}),
		[params.type, setParams],
	);

	const handleStudySelect = useCallback(
		(study: string) =>
			setParams({
				study: params.study.includes(study)
					? params.study.filter((value) => value !== study)
					: [...params.study, study],
				page: 1,
			}),
		[params.study, setParams],
	);

	/** Drops every place chosen on the map, countries of either kind and institutions, and keeps the other filters. */
	const handleCountriesClear = useCallback(() => {
		setParams({ country: [], author_country: [], institution: [] });
	}, [setParams]);

	const handleClearFilters = useCallback(() => {
		setParams({
			author: "",
			institution: [],
			country: [],
			author_country: [],
			collections: [],
			range: "",
			topics: [],
			sources: [],
			type: [],
			study: [],
		});
	}, [setParams]);

	const { data: facetsData } = useSWR<FacetsGetResponse>(
		filterSurfaceEnabled ? buildFacetsQuery(runtimeParams) : null,
		fetcher,
		SWR_OPTIONS,
	);

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>(
		admin ? null : "/collections",
		fetcher,
		SWR_OPTIONS,
	);

	const { data: sourcesData, error: sourcesError } = useSWR<SourcesGetResponse>(
		!admin && filters.sources.enabled ? "/sources" : null,
		fetcher,
		SWR_OPTIONS,
	);

	const selectedCollections = runtimeParams.collections;

	const hierarchy = useMemo(() => {
		if (!collectionsData) return [];
		return buildHierarchy(collectionsData.collections as Collection[]);
	}, [collectionsData]);

	const handleCheckboxChange = useCallback(
		(key: string) => {
			let newSelectedCollections: string[];

			if (key === "") {
				newSelectedCollections = [];
			} else {
				const alreadySelected = selectedCollections.includes(key);

				if (alreadySelected) {
					const collectionToDeselect = recursiveFind(key, hierarchy);
					const descendantKeys = collectionToDeselect
						? getDescendantKeys(collectionToDeselect)
						: [];
					newSelectedCollections = selectedCollections.filter(
						(k: string) => k !== key && !descendantKeys.includes(k),
					);
				} else {
					newSelectedCollections = [...selectedCollections, key];
				}
			}

			setParams({ collections: newSelectedCollections, page: 1 });
		},
		[selectedCollections, hierarchy, setParams],
	);

	return {
		queryParams: runtimeParams,
		searchParams,
		pathName: pathname,
		handlePageChange,
		handleSortChange,
		handleScopeChange,
		handleSearchChange,
		noteTypedSearch,
		readTypedSearch,
		handleRangeChange,
		handleCollectionSelect,
		handleAuthorSelect,
		handleInstitutionSelect,
		handleInstitutionToggle,
		handleCountrySelect,
		handleAuthorCountrySelect,
		handleCountriesClear,
		handleTopicsChange,
		handleSourceSelect,
		handleTypeSelect,
		handleStudySelect,
		handleClearFilters,
		handleCheckboxChange,
		collectionsData,
		// Undefined while the names load; a library whose names can't load offers no source filter.
		sources: sourcesData?.sources ?? (sourcesError ? [] : undefined),
		collectionsError,
		isCollectionsLoading,
		hierarchy,
		selectedCollections,
		facetDistribution: facetsData?.facetDistribution,
		facetTotals: facetsData?.totals,
		noteData,
		isNoteLoading,
	};
}

/** Every one of `names` added, or, if any is chosen already, every one taken away. */
function toggledNames(current: string[], names: string[]) {
	if (names.some((name) => current.includes(name))) return current.filter((chosen) => !names.includes(chosen));
	return [...new Set([...current, ...names])];
}

/**
 * The places chosen after choosing `place`: a chosen place is dropped with the places inside it, any other added. A list
 * (a place with the region path leading to it) is judged by its last place, and adds the whole path.
 */
function toggledPlaces(current: string[], place: string | string[]) {
	const last = Array.isArray(place) ? place[place.length - 1] : place;
	if (current.includes(last)) return current.filter((chosen) => chosen !== last && !chosen.startsWith(last));
	return [...new Set([...current, ...(Array.isArray(place) ? place : [place])])];
}
