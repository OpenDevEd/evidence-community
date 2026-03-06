import { useCallback, useContext, useMemo } from "react";
import { fetcher, buildItemsQuery, defaultParams } from "@/lib/utils";
import { CacheContext, useLastFetchedData } from "@/context/Providers";
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
import { debounce, useQueryStates } from "nuqs";
import { Item } from "@/app/api/item/types";
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
	const [queryParams, setParams] = useQueryStates(searchParamsLoader);

	const searchParamsFromParams = useSearchParams();

	const pathname = usePathname();

	const searchParams = Object.fromEntries(
		searchParamsFromParams.entries()
	) as any;
	const dataQueryParams = defaultParams(searchParamsFromParams);

	const { setLastFetchedData } = useLastFetchedData();

	const { itemsCache } = useContext(CacheContext);

	const itemsQuery = buildItemsQuery(
		dataQueryParams,
		userData ? `/user/items/${userData.id}` : "/items"
	);
	const noteCollectionId =
		queryParams.collections.length === 1
			? queryParams.collections[0]
			: null;

	const { data: noteData, isLoading: isNoteLoading } = useSWR<CollectionNoteGetResponse>(
		noteCollectionId ? `/collections/${noteCollectionId}/note` : null,
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
			setParams(
				{
					search: text,
					page: 1,
				},
				{
					limitUrlUpdates:
						text === "" ? undefined : debounce(250),
				}
			),
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
				institution: Array.from(
					new Set([...queryParams.institution, ...institution])
				),
			});
		} else if (queryParams.institution.includes(institution)) {
			setParams({
				institution: queryParams.institution.filter(
					(i) => i !== institution
				),
			});
		} else {
			setParams({
				institution: [...queryParams.institution, institution],
			});
		}
	};

	function genericCountrySelect(
		country: string | string[],
		key: keyof typeof queryParams
	) {
		const queryParam = queryParams[key] as string[];
		if (Array.isArray(country)) {
			const lastOne = country[country.length - 1];
			if (queryParam.includes(lastOne)) {
				setParams({
					[key]: queryParam.filter(
						(c) => c !== lastOne && !c.startsWith(lastOne)
					),
				});
			} else {
				setParams({
					[key]: Array.from(new Set([...queryParam, ...country])),
				});
			}
		} else if (queryParam.includes(country)) {
			setParams({
				[key]: queryParam.filter((c) => {
					const sameCountry = c === country;
					const isDescendant = !sameCountry && c.startsWith(country);
					return !sameCountry && !isDescendant;
				}),
			});
		} else {
			setParams({
				[key]: [...queryParam, country],
			});
		}
	}

	const handleCountrySelect = (country: string | string[]) => {
		genericCountrySelect(country, "country");
	};

	const handleAuthorCountrySelect = (country: string | string[]) => {
		genericCountrySelect(country, "author_country");
	};

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
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		// Profile/user lists need to refresh when revisited after mutations done elsewhere.
		revalidateIfStale: Boolean(userData),
		onSuccess: (data) => {
			const boundedTotalPages = Math.max(1, data.totalPages || 1);
			if (boundedTotalPages < dataQueryParams.page) {
				handlePageChange(boundedTotalPages);
			}
			setLastFetchedData(data);
			document.dispatchEvent(new Event('ZoteroItemUpdated', { bubbles: true, cancelable: true }))
		},
	});

	if (fetchedItemsData) {
		itemsCache.current[itemsQuery] = fetchedItemsData;
	}

	const itemsData = fetchedItemsData ?? itemsCache.current[itemsQuery];

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
