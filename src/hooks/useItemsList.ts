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

import collectionsDataJSON from "@/../public/collections.json";
import hierarchyDataJSON from "@/../public/hierarchy.json";

export function useItemsList(userData?: any, config: {
	paginationSiblings?: number,
	disableViewSwitch?: boolean,
	interactionsStyle?: "one-line" | "multi-line",
} = {
	interactionsStyle: "multi-line",
}) {
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

	const handleInstitutionSelect = (institution: string | string[]) => {
		if (Array.isArray(institution)) {
			setParams({
				institution: Array.from(new Set([...queryParams.institution, ...institution]))
			});
		} else if (queryParams.institution.includes(institution)) {
			setParams({
				institution: queryParams.institution.filter((i) => i !== institution),
			});
		} else {
			setParams({
				institution: [...queryParams.institution, institution],
			});
		}
	};

	function genericCountrySelect(country: string | string[], key: keyof typeof queryParams) {
		const queryParam = queryParams[key] as string[];
		if (Array.isArray(country)) {
			const lastOne = country[country.length - 1];
			if (queryParam.includes(lastOne)) {
				setParams({
					[key]: queryParam.filter((c) => c !== lastOne && !c.startsWith(lastOne))
				});
			} else {
				setParams({
					[key]: Array.from(new Set([...queryParam, ...country]))
				});
			}
		} else if (queryParam.includes(country)) {
			setParams({
				[key]: queryParam.filter((c) => {
					const sameCountry = c === country;
					const isDescendant = !sameCountry && c.startsWith(country);
					return !sameCountry && !isDescendant;
				})
			});
		} else {
			setParams({
				[key]: [...queryParam, country],
			});
		}
	}

	const handleCountrySelect = (country: string | string[]) => {
		genericCountrySelect(country, "country");
	}

	const handleAuthorCountrySelect = (country: string | string[]) => {
		genericCountrySelect(country, "author_country");
	}

	const handleClearFilters = () => {
		setParams({
			author: "",
			institution: [],
			country: [],
			collections: [],
			author_country: [],
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
		collectionsData,
		hierarchy,
		collectionsError,
		isCollectionsLoading
	} = useMemo(() => ({
		collectionsData: {
			collections: collectionsDataJSON as Collection[],
		},
		hierarchy: hierarchyDataJSON as Collection[],
		collectionsError: undefined,
		isCollectionsLoading: false
	}), []);

	const selectedCollections = queryParams.collections;

	const handleCheckboxChange = (key: string | string[], scroll?: boolean) => {
		let newSelectedCollections: string[] | undefined;

		if (key === "" || key === null || key.length === 0) {
			newSelectedCollections = [];
		} else if (!Array.isArray(key) || key.length === 1) {
			const singleKey = Array.isArray(key) ? key[0] : key;
			const alreadySelected = selectedCollections.includes(singleKey);

			if (alreadySelected) {
				const collectionToDeselect = recursiveFind(singleKey, hierarchy as Collection[]);

				const descendantKeys = collectionToDeselect
					? getDescendantKeys(collectionToDeselect)
					: [];
				newSelectedCollections = selectedCollections.filter(
					(k: string) => k !== singleKey && !descendantKeys.includes(k)
				);
			} else {
				newSelectedCollections = [...selectedCollections, singleKey];
			}
		} else if (Array.isArray(key)) {
			const allKeysIn = key.every((k) => selectedCollections.includes(k));
			if (allKeysIn) {
				newSelectedCollections = selectedCollections.filter(
					(k: string) => !key.includes(k)
				);
			} else {
				newSelectedCollections = Array.from(new Set([...selectedCollections, ...key]));
			}
		}

		setParams({
			collections: newSelectedCollections,
			page: 1,
		}, scroll !== undefined ? {
			scroll,
		} : undefined);
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
		handleAuthorCountrySelect,
		userData,
		config,
	};
}
