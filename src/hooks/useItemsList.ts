import { useContext, useEffect, useMemo } from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
import { fetcher, buildItemsQuery } from "@/lib/utils";
import { listingParams } from "@/lib/searchParams";
import { CacheContext, useLastFetchedData } from "@/context/Providers";
import { ItemsGetResponse } from "@/app/api/items/types";
import { useFiltersContext } from "@/context/FiltersProvider";

/**
 * The page-specific items results: the SWR for the current query, the
 * per-pathname results cache, and the "snap back to the last page" clamp. Kept
 * out of {@link useFilters} so the heavy items search only runs on pages that
 * actually render a results grid, not everywhere the filter provider lives.
 */
function useItemsResults(
	params: any,
	handlePageChange: (page: number) => void,
	userData?: any
) {
	const pathname = usePathname();
	const { setLastFetchedData } = useLastFetchedData();
	const { cacheItems, getCachedItems } = useContext(CacheContext);

	const itemsQuery = useMemo(
		() =>
			// A record opened from the list adds where to go back to. Leaving it out keeps the list's address while
			// the reader is on the record, so Back finds the list it left instead of loading it again.
			userData
				? buildItemsQuery({ ...listingParams(params), collectionId: params.collectionId }, `/user/items/${userData.id}`)
				: buildItemsQuery(listingParams(params), "/items"),
		[params, userData]
	);

	const {
		data: fetchedItemsData,
		error: itemsError,
		isLoading: isItemsLoading,
		isValidating: isItemsFetching,
		mutate: revalidateResults,
	} = useSWR<ItemsGetResponse>(itemsQuery, fetcher, {
		keepPreviousData: true,
		shouldRetryOnError: false,
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		// A reader's own list changes whenever they bookmark or collect a
		// record elsewhere, so it reloads each time its page opens; the
		// library's list keeps what it already loaded.
		revalidateIfStale: Boolean(userData),
		onSuccess: (data) => {
			// A list with no results has no last page to go back to; page 1 stays.
			if (data.totalPages > 0 && data.totalPages < params.page) {
				handlePageChange(data.totalPages);
			}
			setLastFetchedData(data);
			document.dispatchEvent(
				new Event("ZoteroItemUpdated", {
					bubbles: true,
					cancelable: true,
				})
			);
		},
	});

	useEffect(() => {
		if (fetchedItemsData) {
			cacheItems(pathname, fetchedItemsData);
		}
	}, [cacheItems, fetchedItemsData, pathname]);

	const itemsData = fetchedItemsData ?? getCachedItems(pathname);

	return {
		itemsData,
		itemsError,
		isItemsLoading,
		isItemsFetching,
		revalidateResults,
	};
}

/**
 * The full library state for a results-bearing page: the shared filter slice
 * (from the app-level {@link useFiltersContext}) plus this page's items results.
 *
 * The filter slice is shared/hoisted, so the navbar and the listing read the
 * exact same params/collections/facets without duplicate fetches or remount
 * flashes; only the items search is owned per page here.
 */
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
	const filters = useFiltersContext();
	const results = useItemsResults(
		filters.queryParams,
		filters.handlePageChange,
		userData
	);

	return {
		...filters,
		...results,
		// User/profile pages run against a private items source and don't show
		// the public facet distribution.
		facetDistribution: userData ? undefined : filters.facetDistribution,
		userData,
		config,
	};
}
