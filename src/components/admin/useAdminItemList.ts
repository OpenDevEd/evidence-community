"use client";

import { useSearchParams } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AdminItemColumnId } from "@/lib/admin/item-list-contract";
import type {
	AdminItemListRow,
	AdminItemViewFilters,
} from "@/lib/admin/types";

import { adminErrorMessage, getAdminItems } from "./admin-api";


import {
	parseAdminItemViewFilters,
	writeAdminItemViewFilters,
} from "@/lib/admin/item-filter-state";

function mergeItemPages(
	current: readonly AdminItemListRow[],
	incoming: readonly AdminItemListRow[],
) {
	const next = [...current];
	const position = new Map(next.map(({ key }, index) => [key, index]));
	for (const row of incoming) {
		const existing = position.get(row.key);
		if (existing === undefined) {
			position.set(row.key, next.length);
			next.push(row);
		} else {
			next[existing] = row;
		}
	}
	return next;
}

function buildListSearchParams(
	filters: AdminItemViewFilters,
	cursor: string | null,
	requestedColumns: readonly AdminItemColumnId[],
) {
	return new URLSearchParams({
		...(cursor ? { cursor } : {}),
		...(filters.reviewQueue ? { review: "pending" } : {}),
		filters: JSON.stringify(filters.filters),
		requestedColumns: JSON.stringify(requestedColumns),
		search: filters.query,
		sorting: JSON.stringify([
			{ column: filters.sort, direction: filters.sortDirection },
		]),
	});
}

function keepVisibleSelection(current: string | null, visibleKeys: ReadonlySet<string>, fallback: string | null) {
 return current && visibleKeys.has(current) ? current : fallback;
}

function selectingReviewQueue(filters: AdminItemViewFilters, pinned: boolean) {
 return filters.reviewQueue && !pinned;
}

const ADDRESS_FOLLOWS_AFTER_MS = 150;
/** The filters an address holds, in one form to compare by. */
const addressFilters = (search: string) => JSON.stringify(parseAdminItemViewFilters(new URLSearchParams(search)));

export function useAdminItemList(
	requestedColumns: readonly AdminItemColumnId[],
	initialFilters: AdminItemViewFilters,
    linkPicking = false,
    selectionPinned = false,
) {
	const routeSearchParams = useSearchParams();
	const routeSearch = routeSearchParams.toString();
	const [filters, setFilters] =
		useState<AdminItemViewFilters>(initialFilters);
	const [items, setItems] = useState<AdminItemListRow[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedKey, setSelectedKeyInUrl] = useQueryState(
		"item",
		parseAsString.withOptions({ history: "push" }),
	);
	const [bulkKeys, setBulkKeys] = useState<Set<string>>(new Set());
	const requestId = useRef(0);
	const requestController = useRef<AbortController | null>(null);
	const selectionInitialized = useRef(selectedKey !== null);
	const setSelectedKey = useCallback(
		(key: string | null) => void setSelectedKeyInUrl(key),
		[setSelectedKeyInUrl],
	);

	// The filters as this hook last put them in the address, or found them there.
	const inAddress = useRef(JSON.stringify(initialFilters));
	// The browser's address is an outside system. It follows the filters a moment after they settle, not on every
	// keystroke: each write makes the router write too, and Safari refuses more than 100 address changes in ten seconds.
	useEffect(() => {
		const timer = setTimeout(() => {
			const next = writeAdminItemViewFilters(
				new URLSearchParams(window.location.search),
				filters,
			);
			const search = next.toString();
			const href = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
			if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
			try {
				window.history.replaceState(window.history.state, "", href);
				inAddress.current = addressFilters(search);
			} catch {
				// The browser refused another address change for now. The next change to the filters writes it.
			}
		}, ADDRESS_FOLLOWS_AFTER_MS);
		return () => clearTimeout(timer);
	}, [filters]);

	// Back and Forward: the filters follow the address the browser returned to, at once. A write still waiting for
	// the entry just left goes with them, so it cannot land in the entry returned to.
	useEffect(() => {
		const follow = () => {
			const returned = addressFilters(window.location.search);
			inAddress.current = returned;
			setFilters((current) => (JSON.stringify(current) === returned ? current : parseAdminItemViewFilters(new URLSearchParams(window.location.search))));
		};
		window.addEventListener("popstate", follow);
		return () => window.removeEventListener("popstate", follow);
	}, []);

	// The route reports the address back: this hook's own writes, sometimes late, and changes to other parameters.
	// Only an address the hook did not write is navigation, and only then do the filters follow it.
	useEffect(() => {
		const reported = addressFilters(routeSearch);
		if (reported !== addressFilters(window.location.search) || reported === inAddress.current) return;
		inAddress.current = reported;
		setFilters(parseAdminItemViewFilters(new URLSearchParams(routeSearch)));
	}, [routeSearch]);

	const loadItems = useCallback(
		async (cursor: string | null = null, append = false) => {
			const currentRequest = ++requestId.current;
			requestController.current?.abort();
			const controller = new AbortController();
			requestController.current = controller;
			setLoading(true);
			try {
				const page = await getAdminItems(
					buildListSearchParams(linkPicking ? {...filters, reviewQueue: false} : filters, cursor, requestedColumns),
					controller.signal,
				);
				if (currentRequest !== requestId.current) return;
				setError(null);
				setItems((current) =>
					append ? mergeItemPages(current, page.items) : page.items,
				);
				if (!append) {
					const visibleKeys = new Set(
						page.items.map(({ key }) => key),
					);
					setBulkKeys((current) => {
						const next = new Set(
							[...current].filter((key) => visibleKeys.has(key)),
						);
						return next.size === current.size ? current : next;
					});
					const firstVisibleKey = page.items[0]?.key ?? null;
					if (selectingReviewQueue(filters, selectionPinned)) {
						void setSelectedKeyInUrl((current) => keepVisibleSelection(current, visibleKeys, firstVisibleKey), { history: "replace" });
					} else if (!selectionInitialized.current && firstVisibleKey) {
						selectionInitialized.current = true;
						void setSelectedKeyInUrl(
							(current) => current ?? firstVisibleKey,
							{ history: "replace" },
						);
					}
				}
				setHasMore(page.hasMore);
				setNextCursor(page.nextCursor);
			} catch (loadError) {
				if (
					loadError instanceof DOMException &&
					loadError.name === "AbortError"
				) {
					return;
				}
				if (currentRequest !== requestId.current) return;
				const message = adminErrorMessage(loadError, "Could not load records");
				setError(message);
				toast.error(message);
			} finally {
				if (currentRequest === requestId.current) setLoading(false);
			}
		},
		[filters, requestedColumns, setSelectedKeyInUrl, linkPicking, selectionPinned],
	);

	useEffect(() => {
		setHasMore(false);
		setNextCursor(null);
		const timeout = setTimeout(() => void loadItems(), 220);
		return () => clearTimeout(timeout);
	}, [loadItems]);

	useEffect(
		() => () => {
			requestId.current += 1;
			requestController.current?.abort();
		},
		[],
	);

	return {
		bulkKeys,
		error,
		filters,
		hasMore,
		items,
		loading,
		loadItems,
		nextCursor,
		selectedKey,
		setBulkKeys,
		setFilters,
		setItems,
		setSelectedKey,
	};
}
