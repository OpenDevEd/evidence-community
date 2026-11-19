import { useCallback, useContext, useMemo } from "react";
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
import { FeatureFlagsContext } from "@/context/Providers";
import { isFeatureFlagEnabled } from "@/lib/feature-flags";
import { normalizePathname } from "@/lib/path";

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
export function useFilters() {
	const [params, setParams] = useQueryStates(searchParamsLoader);

	// Raw search params, only needed downstream for atom-feed serialization.
	const rawSearchParams = useSearchParams();
	const searchParams = useMemo(
		() =>
			Object.fromEntries(rawSearchParams.entries()) as Record<
				string,
				string
			>,
		[rawSearchParams]
	);

	const pathname = usePathname();
	const normalizedPathname = normalizePathname(pathname);
	const { featureFlags } = useContext(FeatureFlagsContext);

	// Facets are only meaningful where a filtering surface exists: the library
	// and map listings, or anywhere the navbar search (with its Explore button)
	// is shown. Everywhere else we skip the request so lifting this provider to
	// the whole app doesn't fan facet queries out across every page.
	const filterSurfaceEnabled =
		normalizedPathname === "/lib" ||
		normalizedPathname.startsWith("/map") ||
		isFeatureFlagEnabled(featureFlags ?? {}, "navbar-search");

	const { data: noteData, isLoading: isNoteLoading } =
		useSWR<CollectionNoteGetResponse>(
			params.collections.length === 1
				? `/collections/${params.collections[0]}/note`
				: null,
			fetcher
		);

	const handlePageChange = useCallback(
		(newPage: number) => {
			setParams({ page: newPage });
		},
		[setParams]
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value) setParams({ sort: value });
		},
		[setParams]
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value) setParams({ scope: value });
		},
		[setParams]
	);

	const handleSearchChange = useCallback(
		(text: string) => setParams({ search: text, page: 1, like: "", theme: -1, literal: false, wordsOnly: false }),
		[setParams]
	);

	const handleSemanticChange = useCallback(
		(change: { concept?: number; like?: string; theme?: number; literal?: boolean; wordsOnly?: boolean }) =>
			setParams({
				page: 1,
				...(change.concept !== undefined ? { like: "", theme: -1, literal: false, wordsOnly: false } : {}),
				...change,
			}),
		[setParams]
	);

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			setParams({ range: [start, end].join(end !== null ? "-" : "") });
		},
		[setParams]
	);

	const handleCollectionSelect = useCallback(
		(collectionId: string) => {
			if (collectionId === params.collectionId) {
				setParams({ collectionId: "" });
			} else {
				setParams({ collectionId });
			}
		},
		[params.collectionId, setParams]
	);

	const handleAuthorSelect = useCallback(
		(author: string) => {
			if (author === params.author) {
				setParams({ author: "" });
			} else {
				setParams({ author });
			}
		},
		[params.author, setParams]
	);

	const handleInstitutionSelect = useCallback(
		(institution: string | string[]) => {
			if (Array.isArray(institution)) {
				setParams({
					institution: Array.from(
						new Set([...params.institution, ...institution])
					),
				});
			} else if (params.institution.includes(institution)) {
				setParams({
					institution: params.institution.filter(
						(i) => i !== institution
					),
				});
			} else {
				setParams({
					institution: [...params.institution, institution],
				});
			}
		},
		[params.institution, setParams]
	);

	const genericCountrySelect = useCallback(
		(country: string | string[], key: "country" | "author_country") => {
			const currentValues = params[key];
			if (Array.isArray(country)) {
				const lastOne = country[country.length - 1];
				if (currentValues.includes(lastOne)) {
					setParams({
						[key]: currentValues.filter(
							(c) => c !== lastOne && !c.startsWith(lastOne)
						),
					});
				} else {
					setParams({
						[key]: Array.from(
							new Set([...currentValues, ...country])
						),
					});
				}
			} else if (currentValues.includes(country)) {
				setParams({
					[key]: currentValues.filter((c) => {
						const sameCountry = c === country;
						const isDescendant =
							!sameCountry && c.startsWith(country);
						return !sameCountry && !isDescendant;
					}),
				});
			} else {
				setParams({ [key]: [...currentValues, country] });
			}
		},
		[params.country, params.author_country, setParams]
	);

	const handleCountrySelect = useCallback(
		(country: string | string[]) => {
			genericCountrySelect(country, "country");
		},
		[genericCountrySelect]
	);

	const handleAuthorCountrySelect = useCallback(
		(country: string | string[]) => {
			genericCountrySelect(country, "author_country");
		},
		[genericCountrySelect]
	);

	const handleClearFilters = useCallback(() => {
		setParams({
			author: "",
			institution: [],
			country: [],
			collections: [],
			author_country: [],
			range: "",
		});
	}, [setParams]);

	const { data: facetsData } = useSWR<FacetsGetResponse>(
		filterSurfaceEnabled ? buildFacetsQuery(params) : null,
		fetcher,
		SWR_OPTIONS
	);

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher, SWR_OPTIONS);

	const selectedCollections = params.collections;

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
						(k: string) =>
							k !== key && !descendantKeys.includes(k)
					);
				} else {
					newSelectedCollections = [...selectedCollections, key];
				}
			}

			setParams({ collections: newSelectedCollections, page: 1 });
		},
		[selectedCollections, hierarchy, setParams]
	);

	return {
		queryParams: params,
		searchParams,
		pathName: pathname,
		handlePageChange,
		handleSortChange,
		handleScopeChange,
		handleSearchChange,
		handleSemanticChange,
		handleRangeChange,
		handleCollectionSelect,
		handleAuthorSelect,
		handleInstitutionSelect,
		handleCountrySelect,
		handleAuthorCountrySelect,
		handleClearFilters,
		handleCheckboxChange,
		collectionsData,
		collectionsError,
		isCollectionsLoading,
		hierarchy,
		selectedCollections,
		facetDistribution: facetsData?.facetDistribution,
		noteData,
		isNoteLoading,
	};
}
