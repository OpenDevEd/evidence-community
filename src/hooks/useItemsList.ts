import { useCallback, useContext, useMemo } from "react";
import { fetcher, buildItemsQuery, defaultParams } from "@/lib/utils";
import { CacheContext, useLastFetchedData } from "@/context/Providers";
import { useParamsState } from "@/hooks/useParamsState";
import { ItemsGetResponse } from "@/app/api/items/types";
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
import { useQueryStates } from 'nuqs'

export function useItemsList(userData?: any) {
	const [params, setParams] = useQueryStates(searchParamsLoader);

	const searchParamsFromParams = useSearchParams();

	const pathname = usePathname();

	const searchParams = Object.fromEntries(
		searchParamsFromParams.entries()
	) as any;

	const { setLastFetchedData } = useLastFetchedData();

	const { itemsCache } = useContext(CacheContext);

	const queryParams = defaultParams(searchParams);

	const itemsQuery = buildItemsQuery(
		queryParams,
		userData ? `/user/items/${userData.id}` : "/items"
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

	const handleCollectionSelect = (collectionId: string) => {
		if (collectionId === queryParams.collectionId) {
			setParams({
				collectionId: "",
			});
		} else {
			setParams({
				collectionId: collectionId,
			});
		}
	};

	const handleAuthorSelect = (author: string) => {
		if (author === queryParams.author) {
			setParams({
				author: "",
			});
		} else {
			setParams({
				author: author,
			});
		}
	};

	const handleInstitutionSelect = (institution: string) => {
		if (institution === queryParams.institution) {
			setParams({
				institution: "",
			});
		} else {
			setParams({
				institution: institution,
			});
		}
	};

	const handleCountrySelect = (country: string) => {
		if (country === queryParams.country) {
			setParams({
				country: "",
			});
		} else {
			setParams({
				country: country,
			});
		}
	}

	const handleClearFilters = () => {
		setParams({
			author: "",
			institution: "",
			country: "",
			collections: [],
		});
	};

	const {
		data: fetchedItemsData,
		error: itemsError,
		isLoading: isItemsLoading,
		isValidating: isItemsFetching,
		mutate: revalidateResults,
	} = useSWR<ItemsGetResponse>(itemsQuery, fetcher, {
		keepPreviousData: true,
		onSuccess: (data) => {
			if (data.totalPages < queryParams.page) {
				handlePageChange(data.totalPages);
			}
			setLastFetchedData(data);
		},
	});

	if (fetchedItemsData) {
		itemsCache.current[pathname] = fetchedItemsData;
	}

	const itemsData = itemsCache.current[pathname];

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher, {
		keepPreviousData: true,
	});

	const selectedCollections = queryParams.collections;

	const hierarchy = useMemo(() => {
		if (!collectionsData) return [];
		return buildHierarchy(collectionsData.collections as Collection[]);
	}, [collectionsData]);

	const handleCheckboxChange = (key: string) => {
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
	};

	return {
		itemsData,
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
		userData,
	};
}
