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

export function useItemsList(userData?: any) {
	const searchParamsFromParams = useSearchParams();

	const pathName = usePathname();

	const searchParams = Object.fromEntries(
		searchParamsFromParams.entries()
	) as any;

	const { setLastFetchedData } = useLastFetchedData();

	const { itemsCache } = useContext(CacheContext);

	const paramsState = useParamsState(searchParams);
	const { router, pathname, createQueryString } = paramsState;

	const queryParams = defaultParams(searchParams);

	const itemsQuery = buildItemsQuery(
		queryParams,
		userData ? `/user/items/${userData.id}` : "/items"
	);

	const handlePageChange = useCallback(
		(newPage: number) => {
			router.push(
				createQueryString(pathname, [["page", String(newPage)]])
			);
		},
		[router, pathname, createQueryString]
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["sort", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["scope", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleSearchChange = useCallback(
		(text: string) =>
			router.push(
				createQueryString(pathname, [
					["search", text],
					["page", "1"],
				])
			),
		[router, pathname, createQueryString]
	);

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			router.push(
				createQueryString(pathname, [
					["range", [start, end].join(end !== null ? "-" : "")],
				])
			);
		},
		[router, pathname, createQueryString]
	);

	const handleCollectionSelect = (collectionId: string) => {
		if (collectionId === queryParams.collectionId) {
			router.push(createQueryString(pathname, [["collectionId", ""]]));
		} else {
			router.push(
				createQueryString(pathname, [["collectionId", collectionId]])
			);
		}
	};

	const handleAuthorSelect = (author: string) => {
		if (author === queryParams.author) {
			router.push(createQueryString(pathname, [["author", ""]]));
		} else {
			router.push(createQueryString(pathname, [["author", author]]));
		}
	};

	const handleInstitutionSelect = (institution: string) => {
		if (institution === queryParams.institution) {
			router.push(createQueryString(pathname, [["institution", ""]]));
		} else {
			router.push(
				createQueryString(pathname, [["institution", institution]])
			);
		}
	};

	const handleClearFilters = () => {
		console.log("handleClearFilters");
		router.push(
			createQueryString(pathname, [
				["author", ""],
				["institution", ""],
				["collections", ""],
			])
		);
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
		itemsCache.current[pathName] = fetchedItemsData;
	}

	const itemsData = itemsCache.current[pathName];

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

		router.push(
			createQueryString(pathname, [
				["collections", newSelectedCollections.join(",")],
				["page", "1"],
			])
		);
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
		queryParams,
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
		pathName,
		handleClearFilters,
		userData,
	};
}
