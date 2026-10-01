"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import type { AdminCollectionSearchState } from "@/lib/admin/collection-catalog-contract";
import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

import {
	getAdminCollectionChildren,
	searchAdminCollectionCatalog,
} from "./admin-api";

export type AdminCollectionCatalogueBranch = {
	error: string | null;
	items: AdminCollectionCatalogEntry[];
	loadingMore: boolean;
	loadMoreError: string | null;
	nextCursor: string | null;
	revealed: AdminCollectionCatalogEntry[];
	requestId: number;
	status: "error" | "idle" | "loading" | "ready";
};

export type AdminCollectionCatalogueState = {
	branches: Map<string, AdminCollectionCatalogueBranch>;
	entries: Map<string, AdminCollectionCatalogEntry>;
	generation: number;
	search: {
		context: string;
		error: string | null;
		items: AdminCollectionCatalogEntry[];
		loadingMore: boolean;
		loadMoreError: string | null;
		nextCursor: string | null;
		requestId: number;
		status: "error" | "idle" | "loading" | "ready";
	};
};

export type AdminCollectionCatalogueRow =
	| {
			depth: number;
			entry: AdminCollectionCatalogEntry;
			kind: "collection";
			positionInSet?: number;
			revealed: boolean;
			setSize: number;
	  }
	| {
			branchKey: string;
			depth: number;
			kind: "empty" | "error" | "loadMore" | "loading";
			parentCollection: string | null;
			positionInSet?: number;
			retryMode?: "more" | "refresh";
			setSize: number;
			sourceConnectionKey: string;
	  }
	| {
			kind: "source";
			positionInSet: number;
			setSize: number;
			source: AdminSource;
	  };

const EMPTY_SEARCH: AdminCollectionCatalogueState["search"] = {
	context: "",
	error: null,
	items: [],
	loadingMore: false,
	loadMoreError: null,
	nextCursor: null,
	requestId: 0,
	status: "idle",
};

const INITIAL_STATE: AdminCollectionCatalogueState = {
	branches: new Map(),
	entries: new Map(),
	generation: 0,
	search: EMPTY_SEARCH,
};

type CatalogueAction =
	| {
			branchKey: string;
			cursor: string | null;
			generation: number;
			requestId: number;
			type: "branchStart";
	  }
	| {
			branchKey: string;
			cursor: string | null;
			error: string;
			generation: number;
			requestId: number;
			type: "branchError";
	  }
	| {
			branchKey: string;
			cursor: string | null;
			generation: number;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
			requestId: number;
			type: "branchSuccess";
	  }
	| { entries: AdminCollectionCatalogEntry[]; type: "reveal" }
	| { type: "invalidate" }
	| {
			context: string;
			cursor: string | null;
			generation: number;
			requestId: number;
			type: "searchStart";
	  }
	| {
			context: string;
			cursor: string | null;
			error: string;
			generation: number;
			requestId: number;
			type: "searchError";
	  }
	| {
			context: string;
			cursor: string | null;
			generation: number;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
			requestId: number;
			type: "searchSuccess";
	  };

export function adminCollectionBranchKey(
	sourceConnectionKey: string,
	parentCollection: string | null,
) {
	return `${sourceConnectionKey}\u0000${parentCollection ?? "root"}`;
}

export function mergeAdminCollectionCatalogueEntries(
	current: readonly AdminCollectionCatalogEntry[],
	next: readonly AdminCollectionCatalogEntry[],
) {
	const nextByKey = new Map(next.map((entry) => [entry.key, entry]));
	const currentKeys = new Set(current.map(({ key }) => key));
	return [
		...current.map((entry) => nextByKey.get(entry.key) ?? entry),
		...next.filter(({ key }) => !currentKeys.has(key)),
	];
}

function branchForReveal(
	branches: Map<string, AdminCollectionCatalogueBranch>,
	entry: AdminCollectionCatalogEntry,
) {
	const key = adminCollectionBranchKey(
		entry.sourceConnectionKey,
		entry.parentCollection,
	);
	const current = branches.get(key) ?? {
		error: null,
		items: [],
		loadingMore: false,
		loadMoreError: null,
		nextCursor: null,
		revealed: [],
		requestId: 0,
		status: "idle" as const,
	};
	const canonical = current.items.some(
		({ key: itemKey }) => itemKey === entry.key,
	);
	branches.set(key, {
		...current,
		items: canonical
			? mergeAdminCollectionCatalogueEntries(current.items, [entry])
			: current.items,
		revealed: canonical
			? current.revealed.filter(
					({ key: itemKey }) => itemKey !== entry.key,
				)
			: mergeAdminCollectionCatalogueEntries(current.revealed, [entry]),
	});
}

export function adminCollectionCatalogueReducer(
	state: AdminCollectionCatalogueState,
	action: CatalogueAction,
): AdminCollectionCatalogueState {
	if (action.type === "invalidate") {
		return {
			branches: new Map(),
			entries: new Map(),
			generation: state.generation + 1,
			search: EMPTY_SEARCH,
		};
	}
	if (action.type === "reveal") {
		const branches = new Map(state.branches);
		const entries = new Map(state.entries);
		for (const entry of action.entries) {
			entries.set(entry.key, entry);
			const destinationBranchKey = adminCollectionBranchKey(
				entry.sourceConnectionKey,
				entry.parentCollection,
			);
			for (const [branchKey, branch] of branches) {
				if (branchKey === destinationBranchKey) continue;
				const items = branch.items.filter(
					({ key }) => key !== entry.key,
				);
				const revealed = branch.revealed.filter(
					({ key }) => key !== entry.key,
				);
				if (
					items.length !== branch.items.length ||
					revealed.length !== branch.revealed.length
				) {
					branches.set(branchKey, { ...branch, items, revealed });
				}
			}
			branchForReveal(branches, entry);
		}
		return { ...state, branches, entries };
	}
	if (action.generation !== state.generation) return state;
	if (action.type === "branchStart") {
		const branches = new Map(state.branches);
		const current = branches.get(action.branchKey) ?? {
			error: null,
			items: [],
			loadingMore: false,
			loadMoreError: null,
			nextCursor: null,
			revealed: [],
			requestId: 0,
			status: "idle" as const,
		};
		branches.set(action.branchKey, {
			...current,
			error: action.cursor ? current.error : null,
			loadingMore: Boolean(action.cursor),
			loadMoreError: null,
			nextCursor: action.cursor ? current.nextCursor : null,
			requestId: action.requestId,
			status: action.cursor ? current.status : "loading",
		});
		return { ...state, branches };
	}
	if (action.type === "branchError") {
		const branches = new Map(state.branches);
		const current = branches.get(action.branchKey);
		if (!current || current.requestId !== action.requestId) return state;
		branches.set(action.branchKey, {
			...current,
			error: action.cursor ? current.error : action.error,
			loadingMore: false,
			loadMoreError: action.cursor ? action.error : null,
			status: action.cursor ? "ready" : "error",
		});
		return { ...state, branches };
	}
	if (action.type === "branchSuccess") {
		const branches = new Map(state.branches);
		const current = branches.get(action.branchKey);
		if (!current || current.requestId !== action.requestId) return state;
		const items = mergeAdminCollectionCatalogueEntries(
			action.cursor ? current.items : [],
			action.items,
		);
		const loadedKeys = new Set(items.map(({ key }) => key));
		branches.set(action.branchKey, {
			error: null,
			items,
			loadingMore: false,
			loadMoreError: null,
			nextCursor: action.nextCursor,
			revealed: current.revealed.filter(
				({ key }) => !loadedKeys.has(key),
			),
			requestId: action.requestId,
			status: "ready",
		});
		const entries = new Map(state.entries);
		for (const entry of action.items) entries.set(entry.key, entry);
		return { ...state, branches, entries };
	}
	if (action.type === "searchStart") {
		return {
			...state,
			search: {
				context: action.context,
				error: null,
				items:
					action.cursor && state.search.context === action.context
						? state.search.items
						: [],
				nextCursor:
					action.cursor && state.search.context === action.context
						? state.search.nextCursor
						: null,
				loadingMore: Boolean(action.cursor),
				loadMoreError: null,
				requestId: action.requestId,
				status: action.cursor ? state.search.status : "loading",
			},
		};
	}
	if (action.type === "searchError") {
		if (
			state.search.context !== action.context ||
			state.search.requestId !== action.requestId
		) {
			return state;
		}
		return {
			...state,
			search: {
				...state.search,
				error: action.cursor ? state.search.error : action.error,
				loadingMore: false,
				loadMoreError: action.cursor ? action.error : null,
				status: action.cursor ? "ready" : "error",
			},
		};
	}
	if (
		state.search.context !== action.context ||
		state.search.requestId !== action.requestId
	) {
		return state;
	}
	const items = mergeAdminCollectionCatalogueEntries(
		action.cursor ? state.search.items : [],
		action.items,
	);
	const entries = new Map(state.entries);
	for (const entry of action.items) entries.set(entry.key, entry);
	return {
		...state,
		entries,
		search: {
			context: action.context,
			error: null,
			items,
			loadingMore: false,
			loadMoreError: null,
			nextCursor: action.nextCursor,
			requestId: action.requestId,
			status: "ready",
		},
	};
}

/**
 * The status row under a branch, if any. A branch loading its first page has
 * none (its owner's chevron spins), and a branch without children shows
 * nothing because the missing chevron already says so.
 */
function branchStatus(branch: AdminCollectionCatalogueBranch): {
	kind: "error" | "loadMore" | "loading";
	positionInSet?: number;
	retryMode?: "more" | "refresh";
} | null {
	const positionInSet = branch.revealed.length
		? undefined
		: branch.items.length + 1;
	if (branch.loadingMore) return { kind: "loading", positionInSet };
	if (branch.status === "error" || branch.loadMoreError) {
		return {
			kind: "error",
			positionInSet,
			retryMode: branch.loadMoreError ? "more" : "refresh",
		};
	}
	return branch.nextCursor ? { kind: "loadMore", positionInSet } : null;
}

export function flattenAdminCollectionCatalogue(
	state: AdminCollectionCatalogueState,
	sources: readonly AdminSource[],
	expandedSources: ReadonlySet<string>,
	expandedCollections: ReadonlySet<string>,
) {
	const rows: AdminCollectionCatalogueRow[] = [];
	const visit = (
		sourceConnectionKey: string,
		parentCollection: string | null,
		depth: number,
	) => {
		const branchKey = adminCollectionBranchKey(
			sourceConnectionKey,
			parentCollection,
		);
		const branch = state.branches.get(branchKey);
		// The owner's chevron spins while a branch loads; no row stands in.
		if (!branch) return;
		const visibleEntries = [
			...branch.items.map((entry) => ({ entry, revealed: false })),
			...branch.revealed.map((entry) => ({ entry, revealed: true })),
		];
		const setSize =
			branch.nextCursor || branch.revealed.length > 0
				? -1
				: visibleEntries.length;
		for (const [index, { entry, revealed }] of visibleEntries.entries()) {
			rows.push({
				depth,
				entry,
				kind: "collection",
				positionInSet: revealed ? undefined : index + 1,
				revealed,
				setSize,
			});
			if (entry.hasChildren && expandedCollections.has(entry.key)) {
				visit(sourceConnectionKey, entry.key, depth + 1);
			}
		}
		const status = branchStatus(branch);
		if (status) {
			rows.push({
				branchKey,
				depth,
				parentCollection,
				setSize: -1,
				sourceConnectionKey,
				...status,
			});
		}
	};

	for (const [index, source] of sources.entries()) {
		rows.push({
			kind: "source",
			positionInSet: index + 1,
			setSize: sources.length,
			source,
		});
		if (expandedSources.has(source.key)) visit(source.key, null, 1);
	}
	return rows;
}

function errorMessage(error: unknown) {
	return error instanceof Error
		? error.message
		: "Collections could not be loaded.";
}

export function useAdminCollectionCatalogue() {
	const [state, dispatch] = useReducer(
		adminCollectionCatalogueReducer,
		INITIAL_STATE,
	);
	const stateRef = useRef(state);
	stateRef.current = state;
	const controllers = useRef(
		new Map<string, { context: string; controller: AbortController }>(),
	);
	const requestSequence = useRef(0);

	useEffect(
		() => () => {
			for (const owner of controllers.current.values()) {
				owner.controller.abort();
			}
		},
		[],
	);

	const loadChildren = useCallback(
		async (
			sourceConnectionKey: string,
			parentCollection: string | null,
			options: { force?: boolean; more?: boolean } = {},
		) => {
			const branchKey = adminCollectionBranchKey(
				sourceConnectionKey,
				parentCollection,
			);
			const snapshot = stateRef.current;
			const branch = snapshot.branches.get(branchKey);
			const cursor = options.more ? (branch?.nextCursor ?? null) : null;
			if (options.more && !cursor) return;
			if (options.more && branch?.loadingMore && !options.force) return;
			if (
				!options.force &&
				!options.more &&
				(branch?.status === "loading" || branch?.status === "ready")
			) {
				return;
			}
			const requestKey = `branch:${branchKey}`;
			const requestContext = cursor ?? "first";
			const activeOwner = controllers.current.get(requestKey);
			if (activeOwner && !options.force) return;
			activeOwner?.controller.abort();
			const controller = new AbortController();
			controllers.current.set(requestKey, {
				context: requestContext,
				controller,
			});
			const generation = snapshot.generation;
			const requestId = ++requestSequence.current;
			dispatch({
				branchKey,
				cursor,
				generation,
				requestId,
				type: "branchStart",
			});
			try {
				const page = await getAdminCollectionChildren(
					{
						cursor,
						pageSize: 50,
						parentCollection,
						sourceConnectionKey,
					},
					controller.signal,
				);
				dispatch({
					branchKey,
					cursor,
					generation,
					items: page.items,
					nextCursor: page.nextCursor,
					requestId,
					type: "branchSuccess",
				});
			} catch (error) {
				if (!controller.signal.aborted) {
					dispatch({
						branchKey,
						cursor,
						error: errorMessage(error),
						generation,
						requestId,
						type: "branchError",
					});
				}
			} finally {
				if (
					controllers.current.get(requestKey)?.controller ===
					controller
				) {
					controllers.current.delete(requestKey);
				}
			}
		},
		[],
	);

	const loadSearch = useCallback(
		async (
			input: {
				query: string;
				sourceConnectionKey: string | null;
				state: AdminCollectionSearchState;
			},
			options: { force?: boolean; more?: boolean } = {},
		) => {
			const context = JSON.stringify(input);
			const snapshot = stateRef.current;
			const current = snapshot.search;
			const cursor = options.more ? current.nextCursor : null;
			if (options.more && (!cursor || current.context !== context))
				return;
			if (options.more && current.loadingMore && !options.force) {
				return;
			}
			if (
				!options.force &&
				!options.more &&
				current.context === context &&
				(current.status === "loading" || current.status === "ready")
			) {
				return;
			}
			const requestKey = "search";
			const requestContext = `${context}\u0000${cursor ?? "first"}`;
			const activeOwner = controllers.current.get(requestKey);
			if (activeOwner?.context === requestContext && !options.force) {
				return;
			}
			activeOwner?.controller.abort();
			const controller = new AbortController();
			controllers.current.set(requestKey, {
				context: requestContext,
				controller,
			});
			const generation = snapshot.generation;
			const requestId = ++requestSequence.current;
			dispatch({
				context,
				cursor,
				generation,
				requestId,
				type: "searchStart",
			});
			try {
				const page = await searchAdminCollectionCatalog(
					{
						cursor,
						pageSize: 50,
						...input,
					},
					controller.signal,
				);
				dispatch({
					context,
					cursor,
					generation,
					items: page.items,
					nextCursor: page.nextCursor,
					requestId,
					type: "searchSuccess",
				});
			} catch (error) {
				if (!controller.signal.aborted) {
					dispatch({
						context,
						cursor,
						error: errorMessage(error),
						generation,
						requestId,
						type: "searchError",
					});
				}
			} finally {
				if (
					controllers.current.get(requestKey)?.controller ===
					controller
				) {
					controllers.current.delete(requestKey);
				}
			}
		},
		[],
	);

	const invalidate = useCallback(() => {
		for (const owner of controllers.current.values()) {
			owner.controller.abort();
		}
		controllers.current.clear();
		stateRef.current = adminCollectionCatalogueReducer(stateRef.current, {
			type: "invalidate",
		});
		dispatch({ type: "invalidate" });
	}, []);
	const reveal = useCallback((entries: AdminCollectionCatalogEntry[]) => {
		stateRef.current = adminCollectionCatalogueReducer(stateRef.current, {
			entries,
			type: "reveal",
		});
		dispatch({ entries, type: "reveal" });
	}, []);

	return {
		invalidate,
		loadChildren,
		loadSearch,
		reveal,
		state,
	};
}
