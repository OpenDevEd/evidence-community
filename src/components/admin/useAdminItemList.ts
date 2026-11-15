"use client";

import { debounce, parseAsString, useQueryState, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { toast } from "sonner";

import type { AdminItemColumnId } from "@/lib/admin/item-list-contract";
import type {
	AdminItemListPage,
	AdminItemListRow,
	AdminItemViewFilters,
} from "@/lib/admin/types";

import { adminErrorMessage, getAdminItems } from "./admin-api";
import { oneAtATime, until } from "./admin-live";


import { adminItemViewParsers, paramsFromView, viewFromParams } from "@/lib/admin/item-filter-state";

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

/** How many rows that arrived above the ones on screen a read goes on past, to keep those on screen in the list. */
const MOST_ARRIVALS = 200;

/**
 * How many rows to read to keep what is on screen: as many as are shown, and one more for each row that arrived above
 * the last of them read so far. Rows that arrive above push the ones a person is reading, or has ticked, further down.
 * A new row after the last shown one is a row moving up from below, as when a shown record leaves the view, and
 * doesn't count. Past MOST_ARRIVALS, as in an import of thousands, the list shows the newest and lets the rest go.
 */
function rowsToKeep(read: readonly AdminItemListRow[], shown: readonly AdminItemListRow[]) {
	const known = new Set(shown.map(({ key }) => key));
	const lastKnown = read.findLastIndex(({ key }) => known.has(key));
	const above = lastKnown < 0 ? read : read.slice(0, lastKnown);
	const arrived = above.filter(({ key }) => !known.has(key)).length;
	return shown.length + Math.min(arrived, MOST_ARRIVALS);
}

/**
 * The rows on screen read again from the top, with where the next page starts. `shown` is asked after every page, so
 * rows the person loads by scrolling while this reads are read too and the list never comes back shorter.
 */
export async function readLoadedRows(read: (cursor: string | null) => Promise<AdminItemListPage>, shown: () => readonly AdminItemListRow[]) {
	const rows: AdminItemListRow[] = [];
	let cursor: string | null = null;
	do {
		const page = await read(cursor);
		rows.push(...page.items);
		cursor = page.hasMore ? page.nextCursor : null;
	} while (cursor && rows.length < rowsToKeep(rows, shown()));
	return { rows, cursor };
}

const sameRow = (shown: AdminItemListRow | undefined, row: AdminItemListRow) => (shown && JSON.stringify(shown) === JSON.stringify(row) ? shown : row);

/** Rows read again, with every row that didn't change kept as the object on screen, and `before` itself when none did. */
function keepShownRows(before: AdminItemListRow[], rows: readonly AdminItemListRow[]) {
	const shown = new Map(before.map((row) => [row.key, row]));
	const next = rows.map((row) => sameRow(shown.get(row.key), row));
	return next.length === before.length && next.every((row, index) => row === before[index]) ? before : next;
}

/** The ticked rows that are still in the list: the same set when all of them are. */
function stillListed(ticked: Set<string>, rows: readonly AdminItemListRow[]) {
	const listed = new Set(rows.map(({ key }) => key));
	const kept = new Set([...ticked].filter((key) => listed.has(key)));
	return kept.size === ticked.size ? ticked : kept;
}

function keepVisibleSelection(current: string | null, visibleKeys: ReadonlySet<string>, fallback: string | null) {
 return current && visibleKeys.has(current) ? current : fallback;
}

function selectingReviewQueue(filters: AdminItemViewFilters, pinned: boolean) {
 return filters.reviewQueue && !pinned;
}

// The address follows the view a moment after it settles, not on every keystroke: each write makes the router write
// too, and Safari refuses more than 100 address changes in ten seconds.
const ADDRESS_FOLLOWS_AFTER_MS = 150;

export function useAdminItemList(
	requestedColumns: readonly AdminItemColumnId[],
    linkPicking = false,
    selectionPinned = false,
    canReview = true,
) {
	// The view lives in the address: a reload, Back and Forward, and a link all bring it back.
	const [{ review, filters: columnFilters, search, sort, direction }, setParams] = useQueryStates(adminItemViewParsers, { history: "replace", limitUrlUpdates: debounce(ADDRESS_FOLLOWS_AFTER_MS) });
	// Only an Editor or Owner has a review queue, so an old link to it opens a Creator on every record.
	const filters = useMemo(() => viewFromParams({ review: canReview ? review : null, filters: columnFilters, search, sort, direction }), [canReview, review, columnFilters, search, sort, direction]);
	// The view as last set, which can be ahead of the one drawn: two changes made in one moment each build on the
	// one before, as with React's own state.
	const latest = useRef(filters);
	latest.current = filters;
	const setFilters = useCallback(
		(next: SetStateAction<AdminItemViewFilters>) => {
			latest.current = typeof next === "function" ? next(latest.current) : next;
			void setParams(paramsFromView(latest.current));
		},
		[setParams],
	);
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
	// Counts the times the list read itself again and came back different, so the table can keep the reader's place.
	const [placeHeld, setPlaceHeld] = useState(0);
	const requestId = useRef(0);
	const requestController = useRef<AbortController | null>(null);
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const selectionInitialized = useRef(selectedKey !== null);
	const setSelectedKey = useCallback(
		(key: string | null) => void setSelectedKeyInUrl(key),
		[setSelectedKeyInUrl],
	);

	// Picking a record to link shows every record, not only those waiting for review.
	const listParams = useCallback(
		(cursor: string | null) => buildListSearchParams(linkPicking ? { ...filters, reviewQueue: false } : filters, cursor, requestedColumns),
		[filters, linkPicking, requestedColumns],
	);

	const loadItems = useCallback(
		async (cursor: string | null = null, append = false) => {
			const currentRequest = ++requestId.current;
			requestController.current?.abort();
			const controller = new AbortController();
			requestController.current = controller;
			setLoading(true);
			try {
				const page = await getAdminItems(listParams(cursor), controller.signal);
				if (currentRequest !== requestId.current) return;
				setError(null);
				setItems((current) =>
					append ? mergeItemPages(current, page.items) : page.items,
				);
				if (!append) {
					const visibleKeys = new Set(
						page.items.map(({ key }) => key),
					);
					setBulkKeys((current) => stillListed(current, page.items));
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
		[filters, listParams, setSelectedKeyInUrl, selectionPinned],
	);

	useEffect(() => {
		setHasMore(false);
		setNextCursor(null);
		const timeout = setTimeout(() => void loadItems(), 220);
		return () => clearTimeout(timeout);
	}, [loadItems]);

	const latestListParams = useRef(listParams);
	latestListParams.current = listParams;
	const loadingRef = useRef(loading);
	loadingRef.current = loading;
	const readShownRows = useCallback(async () => {
		// A load under way lands first. It may have asked before the change that asked for this, so its answer can be
		// the older one, and read before it this one would be overwritten.
		await until(() => !loadingRef.current);
		// In pages the size the list loads in, so a list that has just loaded comes back with the same rows.
		const read = await readLoadedRows((cursor) => getAdminItems(listParams(cursor)), () => itemsRef.current).catch(() => null);
		// A read that failed waits for the next change, and one for a view the person has left is dropped.
		if (!read || listParams !== latestListParams.current) return;
		const next = keepShownRows(itemsRef.current, read.rows);
		if (next !== itemsRef.current) {
			setItems(next);
			setPlaceHeld((count) => count + 1);
			setBulkKeys((current) => stillListed(current, next));
		}
		setHasMore(read.cursor !== null);
		setNextCursor(read.cursor);
	}, [listParams]);
	const latestReadShownRows = useRef(readShownRows);
	latestReadShownRows.current = readShownRows;
	/**
	 * Reads the rows on screen again for a change someone else made, as far down as the list has been read. Nothing
	 * shows as loading, the open record stays open, and a row that didn't change stays the same row. Asked for by more
	 * than one part of the page, it reads once at a time.
	 */
	const [refreshItems] = useState(() => oneAtATime(() => latestReadShownRows.current()));

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
		placeHeld,
		refreshItems,
		selectedKey,
		setBulkKeys,
		setFilters,
		setItems,
		setSelectedKey,
	};
}
