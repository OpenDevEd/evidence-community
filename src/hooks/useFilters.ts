import { useCallback, useMemo } from "react";
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

	const handleCountrySelect = useCallback(
		(country: string | string[]) => {
			const currentValues = params.country;
			if (Array.isArray(country)) {
				const lastOne = country[country.length - 1];
				if (currentValues.includes(lastOne)) {
					setParams({
						country: currentValues.filter(
							(c) => c !== lastOne && !c.startsWith(lastOne),
						),
					});
				} else {
					setParams({
						country: Array.from(
							new Set([...currentValues, ...country]),
						),
					});
				}
			} else if (currentValues.includes(country)) {
				setParams({
					country: currentValues.filter((c) => {
						const sameCountry = c === country;
						const isDescendant =
							!sameCountry && c.startsWith(country);
						return !sameCountry && !isDescendant;
					}),
				});
			} else {
				setParams({ country: [...currentValues, country] });
			}
		},
		[params.country, setParams],
	);

	const handleTopicsChange = useCallback(
		(topics: string[]) => setParams({ topics, page: 1 }),
		[setParams],
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

	const handleClearFilters = useCallback(() => {
		setParams({
			author: "",
			institution: [],
			country: [],
			collections: [],
			range: "",
			topics: [],
			type: [],
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
		handleRangeChange,
		handleCollectionSelect,
		handleAuthorSelect,
		handleInstitutionSelect,
		handleCountrySelect,
		handleTopicsChange,
		handleTypeSelect,
		handleClearFilters,
		handleCheckboxChange,
		collectionsData,
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
