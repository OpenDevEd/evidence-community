"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AdminItemColumnId } from "@/lib/admin/item-list-contract";
import { resolveAdminSelection } from "@/lib/admin/selection";
import type {
	AdminItemDetail,
	AdminItemListRow,
	AdminItemViewFilters,
} from "@/lib/admin/types";

import { getAdminItems } from "./admin-api";

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Could not load records";
}

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
		filters: JSON.stringify(filters.filters),
		requestedColumns: JSON.stringify(requestedColumns),
		search: filters.query,
		sorting: JSON.stringify([
			{ column: filters.sort, direction: filters.sortDirection },
		]),
	});
}

export function useAdminItemList(
	detail: AdminItemDetail | null,
	requestedColumns: readonly AdminItemColumnId[],
	initialFilters: AdminItemViewFilters,
) {
	const [filters, setFilters] =
		useState<AdminItemViewFilters>(initialFilters);
	const [items, setItems] = useState<AdminItemListRow[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [bulkKeys, setBulkKeys] = useState<Set<string>>(new Set());
	const requestId = useRef(0);
	const requestController = useRef<AbortController | null>(null);
	const detailRef = useRef(detail);
	detailRef.current = detail;

	useEffect(() => {
		const next = writeAdminItemViewFilters(
			new URLSearchParams(window.location.search),
			filters,
		);
		const search = next.toString();
		const href = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
		window.history.replaceState(window.history.state, "", href);
	}, [filters]);

	useEffect(() => {
		const restore = () =>
			setFilters(
				parseAdminItemViewFilters(
					new URLSearchParams(window.location.search),
				),
			);
		window.addEventListener("popstate", restore);
		return () => window.removeEventListener("popstate", restore);
	}, []);

	const loadItems = useCallback(
		async (cursor: string | null = null, append = false) => {
			const currentRequest = ++requestId.current;
			requestController.current?.abort();
			const controller = new AbortController();
			requestController.current = controller;
			setLoading(true);
			try {
				const page = await getAdminItems(
					buildListSearchParams(filters, cursor, requestedColumns),
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
					setSelectedKey((current) =>
						resolveAdminSelection(
							current,
							visibleKeys,
							detailRef.current,
							page.items[0]?.key ?? null,
						),
					);
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
				const message = errorMessage(loadError);
				setError(message);
				toast.error(message);
			} finally {
				if (currentRequest === requestId.current) setLoading(false);
			}
		},
		[filters, requestedColumns],
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
