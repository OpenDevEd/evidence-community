import { useCallback, useContext, useMemo } from "react";
import { fetcher, buildItemsQuery, buildFacetsQuery } from "@/lib/utils";
import { CacheContext, useLastFetchedData } from "@/context/Providers";
import { ItemsGetResponse } from "@/app/api/items/types";
import { FacetsGetResponse } from "@/app/api/facets/types";
import useSWR from "swr";
import { usePathname, useSearchParams } from "next/navigation";
import {
	Collection,
	CollectionsGetResponse,
} from "@/app/api/collections/types";
import { getDescendantKeys } from "@/lib/collections";
import { recursiveFind } from "@/lib/collections";
import { buildHierarchy } from "@/lib/collections";
import { searchParamsLoader } from "@/lib/searchParams";
import { useQueryStates } from "nuqs";
import { CollectionNoteGetResponse } from "@/app/api/collections/[id]/note/types";

export function useItemsList(
	userData?: any,
	config: {
		paginationSiblings?: number;
		disableViewSwitch?: boolean;
		interactionsStyle?: "one-line" | "multi-line";
	} = {
		interactionsStyle: "multi-line",
	}
) {
	const [params, setParams] = useQueryStates(searchParamsLoader);

	// Raw search params only needed for atom feed serialization
	const rawSearchParams = useSearchParams();
	const searchParams = useMemo(
		() => Object.fromEntries(rawSearchParams.entries()) as Record<string, string>,
		[rawSearchParams]
	);

	const pathname = usePathname();

	const { setLastFetchedData } = useLastFetchedData();

	const { itemsCache } = useContext(CacheContext);

	// Use nuqs params as single source of truth for query building
	const itemsQuery = useMemo(
		() => buildItemsQuery(params, userData ? `/user/items/${userData.id}` : "/items"),
		[params, userData]
	);

	// Facets are only rendered on public pages; profile pages skip the request.
	const facetsQuery = useMemo(
		() => (userData ? null : buildFacetsQuery(params)),
		[params, userData]
	);

	const { data: noteData, isLoading: isNoteLoading } = useSWR<CollectionNoteGetResponse>(
		params.collections.length === 1
			? `/collections/${params.collections[0]}/note`
			: null,
		fetcher
	);

	const handlePageChange = useCallback(
		(newPage: number) => {
			setParams({
				page: newPage,
			});
		},
		[setParams]
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value)
				setParams({
					sort: value,
				});
		},
		[setParams]
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value)
				setParams({
					scope: value,
				});
		},
		[setParams]
	);

	const handleSearchChange = useCallback(
		(text: string) =>
			setParams({
				search: text,
				page: 1,
			}),
		[setParams]
	);

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			setParams({
				range: [start, end].join(end !== null ? "-" : ""),
			});
		},
		[setParams]
	);

	const handleCollectionSelect = useCallback((collectionId: string) => {
		if (collectionId === params.collectionId) {
			setParams({ collectionId: "" });
		} else {
			setParams({ collectionId });
		}
	}, [params.collectionId, setParams]);

	const handleAuthorSelect = useCallback((author: string) => {
		if (author === params.author) {
			setParams({ author: "" });
		} else {
			setParams({ author });
		}
	}, [params.author, setParams]);

	const handleInstitutionSelect = useCallback((institution: string | string[]) => {
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
	}, [params.institution, setParams]);

	const genericCountrySelect = useCallback((
		country: string | string[],
		key: "country" | "author_country"
	) => {
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
					[key]: Array.from(new Set([...currentValues, ...country])),
				});
			}
		} else if (currentValues.includes(country)) {
			setParams({
				[key]: currentValues.filter((c) => {
					const sameCountry = c === country;
					const isDescendant = !sameCountry && c.startsWith(country);
					return !sameCountry && !isDescendant;
				}),
			});
		} else {
			setParams({
				[key]: [...currentValues, country],
			});
		}
	}, [params.country, params.author_country, setParams]);

	const handleCountrySelect = useCallback((country: string | string[]) => {
		genericCountrySelect(country, "country");
	}, [genericCountrySelect]);

	const handleAuthorCountrySelect = useCallback((country: string | string[]) => {
		genericCountrySelect(country, "author_country");
	}, [genericCountrySelect]);

	const handleClearFilters = useCallback(() => {
		setParams({
			author: "",
			institution: [],
			country: [],
			collections: [],
			author_country: [],
		});
	}, [setParams]);

	const {
		data: fetchedItemsData,
		error: itemsError,
		isLoading: isItemsLoading,
		isValidating: isItemsFetching,
		mutate: revalidateResults,
	} = useSWR<ItemsGetResponse>(itemsQuery, fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
		onSuccess: (data) => {
			if (data.totalPages < params.page) {
				handlePageChange(data.totalPages);
			}
			setLastFetchedData(data);
			document.dispatchEvent(new Event('ZoteroItemUpdated', { bubbles: true, cancelable: true }))
		},
	});

	if (fetchedItemsData) {
		itemsCache.current[pathname] = fetchedItemsData;
	}

	const itemsData = itemsCache.current[pathname];

	const { data: facetsData } = useSWR<FacetsGetResponse>(facetsQuery, fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
	});

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
	});

	const selectedCollections = params.collections;

	const hierarchy = useMemo(() => {
		if (!collectionsData) return [];
		return buildHierarchy(collectionsData.collections as Collection[]);
	}, [collectionsData]);

	const handleCheckboxChange = useCallback((key: string) => {
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
					(k: string) => k !== key && !descendantKeys.includes(k)
				);
			} else {
				newSelectedCollections = [...selectedCollections, key];
			}
		}

		setParams({
			collections: newSelectedCollections,
			page: 1,
		});
	}, [selectedCollections, hierarchy, setParams]);

	return {
		itemsData,
		facetDistribution: facetsData?.facetDistribution,
		itemsError,
		isItemsLoading,
		isItemsFetching,
		revalidateResults,
		handlePageChange,
		handleSortChange,
		handleScopeChange,
		handleSearchChange,
		handleRangeChange,
		queryParams: params,
		collectionsData,
		collectionsError,
		isCollectionsLoading,
		hierarchy,
		handleCheckboxChange,
		selectedCollections,
		searchParams,
		handleCollectionSelect,
		handleAuthorSelect,
		handleInstitutionSelect,
		pathName: pathname,
		handleClearFilters,
		handleCountrySelect,
		handleAuthorCountrySelect,
		userData,
		config,
		noteData,
		isNoteLoading,
	};
}
