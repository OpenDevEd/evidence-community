"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Folder01Icon, FolderOpenIcon, Loading03Icon, SquareLock01Icon, Search01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { useDebouncedValue } from "@/hooks/useDebounce";
import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

import {
	getAdminCollectionChildren,
	searchAdminCollectionCatalog,
} from "./admin-api";
import { ADMIN_COLLECTION_INVALIDATION_EVENT } from "./admin-collection-events";
import { rememberAdminCollections } from "./admin-collection-resolution-cache";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";

type CollectionPathEntry = { key: string; name: string };
type CollectionPage = { items: AdminCollectionCatalogEntry[]; nextCursor: string | null };

/** Three rows' worth of room for a list that is still loading for the first time. */
const FIRST_LOAD_HEIGHT = 3 * 54;

// Pages loaded this session, by what was asked, so a picker reopens or goes
// back to a folder with its list already there. Cleared when collections change.
const pages = new Map<string, CollectionPage>();
const preloads = new Map<string, Promise<void>>();
// Counts invalidations, so an answer to a request made before one is not cached after it.
let cacheGeneration = 0;
if (typeof window !== "undefined") {
	window.addEventListener(ADMIN_COLLECTION_INVALIDATION_EVENT, () => {
		cacheGeneration += 1;
		pages.clear();
	});
}

// No stand-in values, so a source named "all" can't share a page with a search across every source.
const pageKey = (query: string, sourceKey: string | null, parent: string | null) => JSON.stringify([query, sourceKey, parent]);
// A long session of searches would otherwise keep every page it ever loaded.
const MAX_CACHED_PAGES = 100;

function storePage(key: string, page: CollectionPage, generation: number) {
	if (generation !== cacheGeneration) return;
	pages.delete(key);
	pages.set(key, page);
	if (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value!);
	rememberAdminCollections(page.items);
}

/** Loads a source's top level before a picker opens, so it opens with its list instead of a spinner. */
export function preloadAdminCollections(sourceConnectionKey: string) {
	const key = pageKey("", sourceConnectionKey, null);
	if (pages.has(key) || preloads.has(key)) return;
	const generation = cacheGeneration;
	preloads.set(
		key,
		getAdminCollectionChildren({ cursor: null, pageSize: 50, parentCollection: null, sourceConnectionKey })
			.then((page) => storePage(key, page, generation))
			.catch(() => undefined)
			.finally(() => preloads.delete(key)),
	);
}

function uniqueEntries(
	current: AdminCollectionCatalogEntry[],
	next: AdminCollectionCatalogEntry[],
) {
	const entries = new Map(current.map((entry) => [entry.key, entry]));
	for (const entry of next) entries.set(entry.key, entry);
	return [...entries.values()];
}

export function adminCollectionPath(
	entry: AdminCollectionCatalogEntry,
	sources: readonly AdminSource[],
) {
	const source =
		sources.find(({ key }) => key === entry.sourceConnectionKey)?.label ??
		entry.sourceConnectionKey;
	return [source, ...entry.ancestors.map(({ name }) => name)].join(" › ");
}

/**
 * A chosen collection as a chip, its full path in its name for screen
 * readers. One whose name another chosen collection shares shows its path, so
 * the two can be told apart.
 */
function SelectionChip({
	entry,
	locked,
	onRemove,
	showPath,
	sources,
}: {
	entry: AdminCollectionCatalogEntry;
	locked: boolean;
	onRemove: (key: string) => void;
	showPath: boolean;
	sources: readonly AdminSource[];
}) {
	const reduceMotion = useReducedMotion();
	const path = adminCollectionPath(entry, sources);
	return (
		<motion.li
			animate={{ opacity: 1, scale: 1 }}
			aria-label={`${entry.name}, ${path}`}
			className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-black/[0.05] pe-1 ps-2 text-xs font-medium text-black/75 dark:bg-white/[0.07] dark:text-white/80"
			exit={{ opacity: 0, scale: 0.92 }}
			initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
			layout={reduceMotion ? false : "position"}
			transition={{ duration: reduceMotion ? 0 : 0.16 }}
		>
			<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 text-black/35 dark:text-white/35" size={12} />
			<span className="min-w-0 max-w-56">
				<TruncatedText text={showPath ? `${path} › ${entry.name}` : entry.name} />
			</span>
			{locked ? (
				<HugeiconsIcon icon={SquareLock01Icon} aria-label={entry.deleted ? "Deleted" : "Read only"} className="me-1 shrink-0 text-black/30 dark:text-white/30" size={11} />
			) : (
				<button
					aria-label={`Remove ${entry.name}, ${path}`}
					className="grid size-5 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.07] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.08] dark:hover:text-white/75"
					onClick={() => onRemove(entry.key)}
					type="button"
				>
					<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={11} />
				</button>
			)}
		</motion.li>
	);
}

/** A spinner that only shows when a first load takes long; a quick one shows nothing at all. */
function SlowLoading() {
	return (
		<div aria-label="Loading collections" className="grid h-full place-items-center" role="status">
			<span className="animate-fade-in [animation-delay:400ms] [animation-duration:300ms] [animation-fill-mode:both] motion-reduce:[animation-timing-function:steps(1,end)]">
				<HugeiconsIcon icon={Loading03Icon} aria-hidden className="animate-spin text-black/35 motion-reduce:animate-none dark:text-white/35" size={16} />
			</span>
		</div>
	);
}

function CollectionErrorStatus({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 px-6 py-3 text-center">
			<HugeiconsIcon icon={AlertCircleIcon} aria-hidden className="text-danger" size={17} />
			<p className="text-xs text-black/55 dark:text-white/55">
				{message}
			</p>
			<Button onPress={onRetry} size="xs" variant="transparent">
				Try again
			</Button>
		</div>
	);
}

function CollectionSelectionIndicator({ selected }: { selected: boolean }) {
	return (
		<span
			aria-hidden
			className={`grid size-4 shrink-0 place-items-center rounded-[5px] border-2 transition-colors ${
				selected
					? "border-accent bg-accent text-white"
					: "border-default bg-transparent text-transparent"
			}`}
		>
			{selected ? <HugeiconsIcon icon={Tick01Icon} size={11} strokeWidth={2.5} /> : null}
		</span>
	);
}

function CollectionResultRow({
	disabled,
	entry,
	onBrowse,
	onSelect,
	selected,
	selectionMode,
	sources,
}: {
	disabled: boolean;
	entry: AdminCollectionCatalogEntry;
	onBrowse: (entry: AdminCollectionCatalogEntry) => void;
	onSelect: (entry: AdminCollectionCatalogEntry) => void;
	selected: boolean;
	selectionMode: "multiple" | "single";
	sources: readonly AdminSource[];
}) {
	const path = adminCollectionPath(entry, sources);
	const opensCollection = entry.hasChildren;
	const selectionLabel = `${selectionMode === "multiple" && selected ? "Deselect" : "Select"} ${entry.name}, ${path}`;
	if (!opensCollection) {
		return (
			<button
				aria-label={selectionLabel}
				aria-pressed={selected}
				className={`flex h-full w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40 ${
					selected
						? "bg-accent/[0.12] dark:bg-accent/20"
						: "hover:bg-black/[0.04] dark:hover:bg-white/[0.045]"
				}`}
				data-admin-collection-result-row
				disabled={disabled}
				onClick={() => onSelect(entry)}
				type="button"
			>
				<CollectionSelectionIndicator selected={selected} />
				<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 opacity-45" size={14} />
				<CollectionResultLabel entry={entry} sources={sources} />
			</button>
		);
	}
	return (
		<div
			className={`group flex h-full min-w-0 items-center rounded-lg transition-colors ${
				selected
					? "bg-accent/[0.12] dark:bg-accent/20"
					: "hover:bg-black/[0.04] dark:hover:bg-white/[0.045]"
			}`}
			data-admin-collection-result-row
		>
			<button
				aria-label={selectionLabel}
				aria-pressed={selected}
				className="grid size-9 shrink-0 place-items-center rounded-lg text-black/40 outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/45"
				disabled={disabled}
				onClick={() => onSelect(entry)}
				type="button"
			>
				<CollectionSelectionIndicator selected={selected} />
			</button>
			<button
				aria-label={`${opensCollection ? "Open" : "Choose"} ${entry.name}, ${path}`}
				className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-lg pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
				disabled={disabled}
				onClick={() =>
					opensCollection ? onBrowse(entry) : onSelect(entry)
				}
				type="button"
			>
				<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 opacity-45" size={14} />
				<CollectionResultLabel entry={entry} sources={sources} />
				{opensCollection ? (
					<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="shrink-0 text-black/35 dark:text-white/35" size={14} />
				) : null}
			</button>
		</div>
	);
}

export function AdminCollectionPicker({
	allowedSourceKeys,
	allowTopLevel = false,
	autoFocus = false,
	disabledAncestorKey,
	initialSourceKey = null,
	lockDeletedSelections = true,
	onSelect,
	onSelectTopLevel,
	onSelectionChange,
	selectedKeys,
	selectionMode,
	sources,
}: {
	allowedSourceKeys?: readonly string[];
	allowTopLevel?: boolean;
	autoFocus?: boolean;
	disabledAncestorKey?: string;
	initialSourceKey?: string | null;
	lockDeletedSelections?: boolean;
	onSelect?: (entry: AdminCollectionCatalogEntry) => void;
	onSelectTopLevel?: (sourceConnectionKey: string) => void;
	onSelectionChange: (keys: string[]) => void;
	selectedKeys: readonly string[];
	selectionMode: "multiple" | "single";
	sources: readonly AdminSource[];
}) {
	"use no memo";

	const allowedSourceKeySignature =
		allowedSourceKeys === undefined
			? null
			: [...new Set(allowedSourceKeys)].sort().join("\u0000");
	const allowedSourceSet = useMemo(
		() =>
			allowedSourceKeySignature === null
				? null
				: new Set(
						allowedSourceKeySignature
							.split("\u0000")
							.filter(Boolean),
					),
		[allowedSourceKeySignature],
	);
	const availableSources = useMemo(
		() =>
			allowedSourceSet
				? sources.filter(({ key }) => allowedSourceSet.has(key))
				: sources,
		[allowedSourceSet, sources],
	);
	const defaultSourceKey =
		initialSourceKey &&
		availableSources.some(({ key }) => key === initialSourceKey)
			? initialSourceKey
			: availableSources.length === 1
				? availableSources[0]!.key
				: null;
	const [query, setQuery] = useState("");
	const typedQuery = useDebouncedValue(query.trim(), 250);
	// Only typing waits for a pause; a cleared search shows the folder at once.
	const debouncedQuery = query.trim() ? typedQuery : "";
	const [sourceKey, setSourceKey] = useState<string | null>(defaultSourceKey);
	const [path, setPath] = useState<CollectionPathEntry[]>([]);
	// A cached or preloaded top level opens at once; otherwise the first load is under way from the first frame.
	const initialPage = pages.get(pageKey("", defaultSourceKey, null));
	const [items, setItems] = useState<AdminCollectionCatalogEntry[]>(() => initialPage?.items ?? []);
	// The list the shown rows came from; rows from another folder or search stay inert until theirs arrive.
	const [itemsKey, setItemsKey] = useState<string | null>(() => (initialPage ? pageKey("", defaultSourceKey, null) : null));
	// A cached page is on screen while its first page is fetched again; Load more waits for it.
	const [refreshing, setRefreshing] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(() => initialPage?.nextCursor ?? null);
	const [loading, setLoading] = useState(() => Boolean(defaultSourceKey) && !initialPage);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const [sourceSelectionPending, setSourceSelectionPending] = useState(false);
	const requestVersion = useRef(0);
	const loadMoreController = useRef<AbortController | null>(null);
	const pickerRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const {
		entries: selectedEntries,
		error: selectedEntriesError,
		keySet: selectedSet,
		retry: retrySelectedEntries,
	} = useResolvedAdminCollections(selectedKeys);
	const activeParent = path.at(-1)?.key ?? null;
	const awaitingSource =
		!sourceKey && (!debouncedQuery || allowedSourceSet !== null);
	const showTopLevel =
		allowTopLevel && !debouncedQuery && activeParent === null;
	const contextKey = [
		debouncedQuery,
		sourceKey ?? "all",
		activeParent ?? "root",
		availableSources.map(({ key }) => key).join(","),
		reloadToken,
	].join("\u0000");
	const contextKeyRef = useRef(contextKey);
	contextKeyRef.current = contextKey;

	useEffect(
		() => () => {
			loadMoreController.current?.abort();
		},
		[],
	);

	// Focus moves to the search once, after the popover places its own; a load finishing later leaves it where the editor put it.
	useEffect(() => {
		if (!autoFocus) return;
		const frame = window.requestAnimationFrame(() => {
			pickerRef.current
				?.querySelector<HTMLInputElement>(
					'input[aria-label="Search collections"]',
				)
				?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [autoFocus]);

	const loadPage = useCallback(
		async (
			cursor: string | null,
			append: boolean,
			signal?: AbortSignal,
		) => {
			const requestContext = contextKey;
			const generation = cacheGeneration;
			if (!sourceKey && (!debouncedQuery || allowedSourceSet)) return;
			const page = debouncedQuery
				? await searchAdminCollectionCatalog(
						{
							cursor,
							pageSize: 50,
							query: debouncedQuery,
							sourceConnectionKey: sourceKey,
							state: "active",
						},
						signal,
					)
				: await getAdminCollectionChildren(
						{
							cursor,
							pageSize: 50,
							parentCollection: activeParent,
							sourceConnectionKey: sourceKey!,
						},
						signal,
					);
			if (contextKeyRef.current !== requestContext) return;
			const key = pageKey(debouncedQuery, sourceKey, activeParent);
			if (!append) {
				storePage(key, page, generation);
				setItemsKey(key);
			} else if (generation === cacheGeneration) rememberAdminCollections(page.items);
			setItems((current) =>
				append ? uniqueEntries(current, page.items) : page.items,
			);
			setNextCursor(page.nextCursor);
			setSourceSelectionPending(false);
		},
		[activeParent, contextKey, debouncedQuery, sourceKey],
	);

	useEffect(() => {
		loadMoreController.current?.abort();
		setLoadingMore(false);
		if (!sourceKey && (!debouncedQuery || allowedSourceSet)) {
			setItems([]);
			setItemsKey(pageKey(debouncedQuery, sourceKey, activeParent));
			setNextCursor(null);
			setError(null);
			setLoading(false);
			setSourceSelectionPending(false);
			return;
		}
		// A page seen before shows at once and is refreshed quietly behind it.
		const cachedKey = pageKey(debouncedQuery, sourceKey, activeParent);
		const cachedPage = pages.get(cachedKey);
		if (cachedPage) {
			setItems(cachedPage.items);
			setItemsKey(cachedKey);
			setNextCursor(cachedPage.nextCursor);
			setSourceSelectionPending(false);
		}
		const controller = new AbortController();
		const version = ++requestVersion.current;
		setError(null);
		setLoading(!cachedPage);
		setRefreshing(Boolean(cachedPage));
		void loadPage(null, false, controller.signal)
			.catch((caught: unknown) => {
				if (
					controller.signal.aborted ||
					version !== requestVersion.current
				)
					return;
				setError(
					caught instanceof Error
						? caught.message
						: "Collections could not be loaded.",
				);
				setSourceSelectionPending(false);
			})
			.finally(() => {
				if (version !== requestVersion.current) return;
				setLoading(false);
				setRefreshing(false);
			});
		return () => controller.abort();
	}, [activeParent, allowedSourceSet, contextKey, debouncedQuery, loadPage, sourceKey]);

	const loadMore = useCallback(() => {
		if (!nextCursor || loading || loadingMore || refreshing) return;
		loadMoreController.current?.abort();
		const controller = new AbortController();
		const requestContext = contextKey;
		loadMoreController.current = controller;
		setLoadingMore(true);
		void loadPage(nextCursor, true, controller.signal)
			.catch((caught: unknown) => {
				if (
					controller.signal.aborted ||
					contextKeyRef.current !== requestContext
				)
					return;
				setError(
					caught instanceof Error
						? caught.message
						: "More collections could not be loaded.",
				);
			})
			.finally(() => {
				if (contextKeyRef.current === requestContext)
					setLoadingMore(false);
			});
	}, [contextKey, loadPage, loading, loadingMore, nextCursor, refreshing]);

	// TanStack Virtual intentionally returns unstable callbacks; this component's
	// `use no memo` directive keeps React Compiler away from the virtualizer.
	// eslint-disable-next-line react-hooks/incompatible-library
	const virtualizer = useVirtualizer({
		count: items.length + (nextCursor ? 1 : 0),
		estimateSize: () => 54,
		getScrollElement: () => scrollRef.current,
		overscan: 6,
	});
	// The list's height follows what it shows, so it grows and shrinks smoothly
	// instead of jumping: the rows, a gap held for a first load, or the empty note.
	const topLevelHeight = showTopLevel ? 44 : 0;
	const stale = itemsKey !== pageKey(debouncedQuery, sourceKey, activeParent);
	const listHeight = topLevelHeight + (items.length ? virtualizer.getTotalSize() : loading ? FIRST_LOAD_HEIGHT : 56);

	const toggleEntry = (entry: AdminCollectionCatalogEntry) => {
		if (selectionMode === "single") {
			onSelectionChange([entry.key]);
			onSelect?.(entry);
			return;
		}
		const next = new Set(selectedSet);
		if (next.has(entry.key)) next.delete(entry.key);
		else next.add(entry.key);
		onSelectionChange([...next]);
	};

	const removeSelection = (key: string) => {
		onSelectionChange(
			selectedKeys.filter((candidate) => candidate !== key),
		);
	};

	/** Shows a page seen before in the same render as the move to it, so the old rows never show under the new place; false when there is none. */
	const showCachedPage = (key: string) => {
		const cached = pages.get(key);
		if (!cached) return false;
		setItems(cached.items);
		setItemsKey(key);
		setNextCursor(cached.nextCursor);
		return true;
	};

	/** Moves to a folder; `next` is the search and source it shows under when the same press changes them. */
	const navigateToPath = (nextPath: CollectionPathEntry[], next = { query: debouncedQuery, source: sourceKey }) => {
		const nextParent = nextPath.at(-1)?.key ?? null;
		if (nextParent === activeParent) return;
		setLoading(!showCachedPage(pageKey(next.query, next.source, nextParent)));
		setPath(nextPath);
		scrollRef.current?.scrollTo({ top: 0 });
	};

	const browseInto = (entry: AdminCollectionCatalogEntry) => {
		setQuery("");
		setSourceKey(entry.sourceConnectionKey);
		navigateToPath(
			[...entry.ancestors, { key: entry.key, name: entry.name }],
			{ query: "", source: entry.sourceConnectionKey },
		);
	};

	const chooseSource = (key: string) => {
		if (key === sourceKey && activeParent === null) return;
		const cached = showCachedPage(pageKey(debouncedQuery, key, null));
		setLoading(!cached);
		setSourceSelectionPending(!cached);
		setSourceKey(key);
		setPath([]);
	};

	return (
		<div
			ref={pickerRef}
			className="flex min-h-0 w-full flex-col gap-2"
			data-admin-collection-picker
		>
			<Input
				color="filled"
				aria-label="Search collections"
				autoFocus={autoFocus}
				classNames={{
					input: "text-sm",
					inputWrapper: "h-9 min-h-9 rounded-lg",
				}}
				placeholder="Search collections"
				startContent={
					<HugeiconsIcon icon={Search01Icon} aria-hidden className="text-black/35 dark:text-white/35" size={14} />
				}
				value={query}
				onClear={() => setQuery("")}
				onValueChange={setQuery}
			/>

			{selectionMode === "multiple" ? (
				// A long choice scrolls inside its own room, so the results below stay in view.
				<ul aria-label="Chosen collections" className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto empty:hidden">
					<AnimatePresence initial={false}>
						{selectedEntries.map((entry) => (
							<SelectionChip
								key={entry.key}
								entry={entry}
								showPath={selectedEntries.some((other) => other.key !== entry.key && other.name === entry.name)}
								locked={
									(lockDeletedSelections && entry.deleted) ||
									Boolean(
										allowedSourceSet &&
										!allowedSourceSet.has(
											entry.sourceConnectionKey,
										),
									)
								}
								onRemove={removeSelection}
								sources={sources}
							/>
						))}
					</AnimatePresence>
				</ul>
			) : null}
			{selectionMode === "multiple" && selectedEntriesError ? (
				<div className="flex min-h-9 items-center gap-2 rounded-lg bg-danger/10 px-2.5 text-xs text-danger">
					<HugeiconsIcon icon={AlertCircleIcon} aria-hidden className="shrink-0" size={13} />
					<span className="min-w-0 flex-1">
						Some selected collections could not be loaded.
					</span>
					<Button
						onPress={retrySelectedEntries}
						size="xs"
						variant="transparent"
					>
						Retry
					</Button>
				</div>
			) : null}

			{!debouncedQuery && sourceKey && !sourceSelectionPending ? (
				<div className="flex min-h-7 items-center gap-1 overflow-hidden px-0.5 text-xs text-black/45 dark:text-white/45">
					{availableSources.length > 1 ? (
						<button
							aria-label="Choose source"
							className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
							onClick={() => {
								setSourceKey(null);
								setPath([]);
							}}
							type="button"
						>
							<HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden size={13} />
						</button>
					) : null}
					{path.length > 0 ? (
						<button
							className="shrink-0 rounded-md px-1.5 py-1 font-medium hover:bg-black/[0.05] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
							onClick={() => navigateToPath([])}
							type="button"
						>
							{sources.find(({ key }) => key === sourceKey)
								?.label ?? sourceKey}
						</button>
					) : (
						<span
							aria-current="page"
							className="shrink-0 px-1.5 py-1 font-medium text-black/65 dark:text-white/65"
						>
							{sources.find(({ key }) => key === sourceKey)
								?.label ?? sourceKey}
						</span>
					)}
					{path.map((entry, index) => (
						<div
							key={entry.key}
							className="flex min-w-0 items-center"
						>
							<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="shrink-0" size={11} />
							{index === path.length - 1 ? (
								<span
									aria-current="page"
									className="min-w-0 truncate px-1.5 py-1 text-black/65 dark:text-white/65"
								>
									{entry.name}
								</span>
							) : (
								<button
									className="min-w-0 truncate rounded-md px-1.5 py-1 hover:bg-black/[0.05] hover:text-black/75 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
									onClick={() =>
										navigateToPath(path.slice(0, index + 1))
									}
									type="button"
								>
									{entry.name}
								</button>
							)}
						</div>
					))}
				</div>
			) : null}

			{awaitingSource || sourceSelectionPending ? (
				<div
					aria-busy={sourceSelectionPending}
					className="relative rounded-xl bg-black/[0.02] dark:bg-white/[0.025]"
					data-admin-collection-picker-sources
				>
					<div
						className="max-h-[min(44vh,288px)] overflow-y-auto rounded-xl"
						data-admin-collection-picker-source-scroll
					>
						<div
							className={`space-y-1 p-1.5 transition-opacity duration-200 motion-reduce:transition-none ${
								sourceSelectionPending ? "opacity-50 delay-300" : "opacity-100"
							}`}
							data-admin-collection-picker-source-content
							inert={sourceSelectionPending ? true : undefined}
						>
							{availableSources.map((source) => (
								<button
									key={source.key}
									className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-black/70 hover:bg-black/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/75 dark:hover:bg-white/[0.055]"
									onClick={() => chooseSource(source.key)}
									type="button"
								>
									<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 opacity-45" size={15} />
									<span className="min-w-0 flex-1 truncate">
										{source.label}
									</span>
									{source.readOnly ? (
										<HugeiconsIcon icon={SquareLock01Icon} aria-label="Read only" className="opacity-35" size={12} />
									) : null}
									<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="opacity-35" size={13} />
								</button>
							))}
						</div>
					</div>
				</div>
			) : (
				<div
					aria-busy={loading}
					className="relative rounded-xl bg-black/[0.02] dark:bg-white/[0.025]"
					data-admin-collection-picker-results
				>
					<div
						ref={scrollRef}
						className="overflow-y-auto rounded-xl transition-[height] duration-200 ease-out motion-reduce:transition-none"
						data-admin-collection-picker-scroll
						style={{ height: `min(44vh, 320px, ${listHeight}px)` }}
					>
						<div
							className={`transition-opacity duration-200 motion-reduce:transition-none ${
								error ? "pointer-events-none select-none opacity-40" : loading ? "opacity-50 delay-300" : "opacity-100"
							}`}
							data-admin-collection-picker-content
							// Only rows from another list need guarding; a first load shows none, and its status stays readable.
							inert={error || (stale && items.length > 0) ? true : undefined}
						>
							{showTopLevel ? (
								<button
									className="sticky top-0 z-10 flex min-h-11 w-full items-center gap-2 border-b border-black/[0.06] bg-card_light px-3 text-left text-sm font-medium text-black/70 hover:bg-black/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:border-white/[0.06] dark:bg-card dark:text-white/75 dark:hover:bg-white/[0.045]"
									onClick={() =>
										sourceKey &&
										onSelectTopLevel?.(sourceKey)
									}
									type="button"
								>
									<HugeiconsIcon icon={FolderOpenIcon} aria-hidden className="text-accent" size={15} />
									Top level
								</button>
							) : null}
							{items.length === 0 && loading ? (
								<div style={{ height: FIRST_LOAD_HEIGHT }}>
									<SlowLoading />
								</div>
							) : items.length === 0 && !error ? (
								<div className="grid place-items-center px-6 py-4 text-center text-xs text-black/40 dark:text-white/40">
									{debouncedQuery
										? "No matching collections"
										: "No collections here"}
								</div>
							) : (
								<div
									className="relative w-full animate-fade-in [animation-duration:200ms] motion-reduce:animate-none"
									// The rows cross-fade when the list they show changes, not when a folder starts loading.
									key={itemsKey ?? "first"}
									style={{
										height: virtualizer.getTotalSize(),
									}}
								>
									{virtualizer
										.getVirtualItems()
										.map((virtualRow) => {
											const entry =
												items[virtualRow.index];
											if (!entry) {
												return (
													<div
														key="load-more"
														className="absolute left-0 top-0 flex w-full items-center justify-center"
														style={{
															height: virtualRow.size,
															transform: `translateY(${virtualRow.start}px)`,
														}}
													>
														<Button
															isDisabled={
																loadingMore || refreshing
															}
															onPress={loadMore}
															size="xs"
															startContent={
																loadingMore ? (
																	<HugeiconsIcon
																		icon={Loading03Icon}
																		aria-hidden
																		className="animate-spin"
																		size={14}
																	/>
																) : undefined
															}
															variant="transparent"
														>
															Load more
														</Button>
													</div>
												);
											}
											const selected = selectedSet.has(
												entry.key,
											);
											const disabled =
												entry.deleted ||
												entry.key ===
													disabledAncestorKey ||
												entry.ancestors.some(
													({ key }) =>
														key ===
														disabledAncestorKey,
												);
											return (
												<div
													key={entry.key}
													className="absolute left-0 top-0 w-full px-1 py-0.5"
													style={{
														height: virtualRow.size,
														transform: `translateY(${virtualRow.start}px)`,
													}}
												>
													<CollectionResultRow
														disabled={disabled}
														entry={entry}
														onBrowse={browseInto}
														onSelect={toggleEntry}
														selected={selected}
														selectionMode={
															selectionMode
														}
														sources={sources}
													/>
												</div>
											);
										})}
								</div>
							)}
						</div>
					</div>
					{error ? (
						items.length > 0 || showTopLevel ? (
							<div className="absolute inset-0 z-20 grid place-items-center">
								<CollectionErrorStatus
									message={error}
									onRetry={() =>
										setReloadToken((current) => current + 1)
									}
								/>
							</div>
						) : (
							<CollectionErrorStatus
								message={error}
								onRetry={() =>
									setReloadToken((current) => current + 1)
								}
							/>
						)
					) : null}
				</div>
			)}
		</div>
	);
}

function CollectionResultLabel({
	entry,
	sources,
}: {
	entry: AdminCollectionCatalogEntry;
	sources: readonly AdminSource[];
}) {
	return (
		<span className="min-w-0 flex-1 overflow-hidden">
			<span className="block truncate text-xs font-medium text-black/75 dark:text-white/80">
				{entry.name}
			</span>
			<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
				{adminCollectionPath(entry, sources)}
			</span>
		</span>
	);
}
