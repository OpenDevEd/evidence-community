"use client";

import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from "react";

import type { AdminCollectionSearchState } from "@/lib/admin/collection-catalog-contract";
import { ADMIN_COLLECTION_PAGE_SIZE, NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import type {
	AdminCollectionCatalogEntry,
	AdminCollectionCatalogPage,
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

type AdminCollectionSearchInput = {
	query: string;
	sourceConnectionKey: string | null;
	state: AdminCollectionSearchState;
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
			/** A list already shown is read again for a change someone else made: it stays as it is until the answer. */
			quiet?: boolean;
			requestId: number;
			type: "branchStart";
	  }
	| {
			branchKey: string;
			cursor: string | null;
			error: string;
			generation: number;
			quiet?: boolean;
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
			quiet?: boolean;
			requestId: number;
			type: "searchStart";
	  }
	| {
			context: string;
			cursor: string | null;
			error: string;
			generation: number;
			quiet?: boolean;
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

/** Stops the request a key has under way and starts another in its place. */
function takeOver(controllers: Map<string, { context: string; controller: AbortController }>, requestKey: string, context: string) {
	controllers.get(requestKey)?.controller.abort();
	const controller = new AbortController();
	controllers.set(requestKey, { context, controller });
	return controller;
}

/** Forgets a request once it has ended, unless another has taken its place. */
function release(controllers: Map<string, { context: string; controller: AbortController }>, requestKey: string, controller: AbortController) {
	if (controllers.get(requestKey)?.controller === controller) controllers.delete(requestKey);
}

/** A list read again from its first page through as many rows as it had loaded, so it never comes back shorter. */
async function readThrough(read: (cursor: string | null) => Promise<AdminCollectionCatalogPage>, loaded: number) {
	const items: AdminCollectionCatalogEntry[] = [];
	let cursor: string | null = null;
	do {
		const page = await read(cursor);
		items.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor && items.length < loaded);
	return { items, nextCursor: cursor };
}

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
		branches.set(
			action.branchKey,
			action.quiet
				? { ...current, requestId: action.requestId }
				: {
						...current,
						error: action.cursor ? current.error : null,
						loadingMore: Boolean(action.cursor),
						loadMoreError: null,
						nextCursor: action.cursor ? current.nextCursor : null,
						requestId: action.requestId,
						status: action.cursor ? current.status : "loading",
					},
		);
		return { ...state, branches };
	}
	if (action.type === "branchError") {
		const branches = new Map(state.branches);
		const current = branches.get(action.branchKey);
		if (!current || current.requestId !== action.requestId) return state;
		// A quiet read that failed leaves the branch as it was, and the next change reads it again. It took over
		// whatever the branch was reading, so a "load more" it stopped is offered again.
		if (action.quiet) {
			branches.set(action.branchKey, { ...current, loadingMore: false });
			return { ...state, branches };
		}
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
		if (action.quiet) return { ...state, search: { ...state.search, requestId: action.requestId } };
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
		if (action.quiet) return { ...state, search: { ...state.search, loadingMore: false } };
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

/** Whether the first page of this search has yet to land: it has not started, or it is under way. */
export function adminCollectionSearchWaiting(
	search: AdminCollectionCatalogueState["search"],
	input: AdminCollectionSearchInput,
) {
	return search.context !== JSON.stringify(input) || search.status === "loading";
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

/** The rows a search shows: its results, then a row for loading, an error, more to load, or no results. */
export function flattenAdminCollectionSearch(
	search: AdminCollectionCatalogueState["search"],
) {
	const searchSetSize = search.nextCursor ? -1 : search.items.length;
	const resultRows: AdminCollectionCatalogueRow[] = search.items.map(
		(entry, index) => ({
			depth: 0,
			entry,
			kind: "collection",
			positionInSet: index + 1,
			revealed: false,
			setSize: searchSetSize,
		}),
	);
	const statusPosition = resultRows.length + 1;
	if (search.status === "loading" || search.loadingMore) {
		resultRows.push({
			branchKey: "search",
			depth: 0,
			kind: "loading",
			parentCollection: null,
			positionInSet: statusPosition,
			setSize: -1,
			sourceConnectionKey: "all",
		});
	} else if (search.status === "error" || search.loadMoreError) {
		resultRows.push({
			branchKey: "search",
			depth: 0,
			kind: "error",
			parentCollection: null,
			positionInSet: statusPosition,
			retryMode: search.loadMoreError ? "more" : "refresh",
			setSize: -1,
			sourceConnectionKey: "all",
		});
	} else if (search.nextCursor) {
		resultRows.push({
			branchKey: "search",
			depth: 0,
			kind: "loadMore",
			parentCollection: null,
			positionInSet: statusPosition,
			setSize: -1,
			sourceConnectionKey: "all",
		});
	} else if (resultRows.length === 0) {
		resultRows.push({
			branchKey: "search",
			depth: 0,
			kind: "empty",
			parentCollection: null,
			positionInSet: 1,
			setSize: 1,
			sourceConnectionKey: "all",
		});
	}
	return resultRows;
}

function errorMessage(error: unknown) {
	return error instanceof Error
		? error.message
		: "Collections could not be loaded.";
}

/**
 * The first page of the library's own collections as the admin page was served, so the tree has its rows and its
 * height from the first paint. Null when it could not be read with the page.
 */
export const FirstCollections = createContext<AdminCollectionCatalogPage | null>(null);

/** The pages a tree has already started from. A tree opened again later starts empty and reads its own. */
const started = new WeakSet<AdminCollectionCatalogPage>();

function stateWith(first: AdminCollectionCatalogPage | null): AdminCollectionCatalogueState {
	if (!first || started.has(first)) return INITIAL_STATE;
	// "idle": its rows are shown, and the tree reads the branch again as it reads any branch it has not read itself,
	// so a collection made since the page was served shows.
	const root: AdminCollectionCatalogueBranch = { error: null, items: first.items, loadingMore: false, loadMoreError: null, nextCursor: first.nextCursor, revealed: [], requestId: 0, status: "idle" };
	return {
		...INITIAL_STATE,
		branches: new Map([[adminCollectionBranchKey(NATIVE_SOURCE_CONNECTION_KEY, null), root]]),
		entries: new Map(first.items.map((entry) => [entry.key, entry])),
	};
}

export function useAdminCollectionCatalogue() {
	const first = useContext(FirstCollections);
	const [state, dispatch] = useReducer(
		adminCollectionCatalogueReducer,
		first,
		stateWith,
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
						pageSize: ADMIN_COLLECTION_PAGE_SIZE,
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

	// The page it came with is used once: by the time this tree is opened again it is out of date.
	useEffect(() => {
		if (first) started.add(first);
	}, [first]);

	const loadSearch = useCallback(
		async (
			input: AdminCollectionSearchInput,
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
						pageSize: ADMIN_COLLECTION_PAGE_SIZE,
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
	/**
	 * Reads a branch again through everything it has loaded, for a change someone else made. It takes over whatever the
	 * branch was reading, so no change is skipped because a read was under way. A branch on screen shows nothing as
	 * loading and stays as it is when the read fails; one still loading its first page carries on loading.
	 */
	const rereadBranch = useCallback(async (branchKey: string, branch: AdminCollectionCatalogueBranch) => {
		const [sourceConnectionKey = "", parent = "root"] = branchKey.split("\u0000");
		const parentCollection = parent === "root" ? null : parent;
		const quiet = branch.status === "ready";
		const requestKey = `branch:${branchKey}`;
		const controller = takeOver(controllers.current, requestKey, "again");
		const request = { branchKey, cursor: null, generation: stateRef.current.generation, quiet, requestId: ++requestSequence.current };
		dispatch({ ...request, type: "branchStart" });
		try {
			const read = await readThrough(
				(cursor) => getAdminCollectionChildren({ cursor, pageSize: ADMIN_COLLECTION_PAGE_SIZE, parentCollection, sourceConnectionKey }, controller.signal),
				branch.items.length,
			);
			dispatch({ ...request, ...read, type: "branchSuccess" });
		} catch (error) {
			dispatch({ ...request, error: errorMessage(error), type: "branchError" });
		} finally {
			release(controllers.current, requestKey, controller);
		}
	}, []);
	/** Reads the search results on screen again, the same way. */
	const rereadSearch = useCallback(async () => {
		const { context, items, status } = stateRef.current.search;
		if (status !== "ready") return;
		const controller = takeOver(controllers.current, "search", `${context}\u0000again`);
		const request = { context, cursor: null, generation: stateRef.current.generation, quiet: true, requestId: ++requestSequence.current };
		dispatch({ ...request, type: "searchStart" });
		try {
			const input = JSON.parse(context) as AdminCollectionSearchInput;
			const read = await readThrough((cursor) => searchAdminCollectionCatalog({ cursor, pageSize: ADMIN_COLLECTION_PAGE_SIZE, ...input }, controller.signal), items.length);
			dispatch({ ...request, ...read, type: "searchSuccess" });
		} catch (error) {
			dispatch({ ...request, error: errorMessage(error), type: "searchError" });
		} finally {
			release(controllers.current, "search", controller);
		}
	}, []);
	/**
	 * Reads everything the tree shows again where it is, for a change someone else made: nothing collapses, nothing
	 * shows as loading, and it is done once every read has answered, so a change that comes meanwhile is read after.
	 */
	const refresh = useCallback(
		() =>
			Promise.all([
				rereadSearch(),
				...[...stateRef.current.branches]
					.filter(([, branch]) => branch.status === "ready" || branch.status === "loading")
					.map(([branchKey, branch]) => rereadBranch(branchKey, branch)),
			]),
		[rereadBranch, rereadSearch],
	);
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
		refresh,
		reveal,
		state,
	};
}
