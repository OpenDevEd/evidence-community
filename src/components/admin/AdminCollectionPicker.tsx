"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	AlertCircle,
	ArrowLeft,
	ChevronRight,
	Folder,
	FolderOpen,
	LoaderCircle,
	Lock,
	Search,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { Input } from "@/components/nextui/Input";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

import {
	getAdminCollectionChildren,
	resolveAdminCollectionCatalog,
	searchAdminCollectionCatalog,
} from "./admin-api";

type CollectionPathEntry = { key: string; name: string };

function useDebouncedValue(value: string, delay: number) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timeout);
	}, [delay, value]);
	return debounced;
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

function isLockedCollection(entry: AdminCollectionCatalogEntry) {
	return (
		entry.deleted ||
		entry.sourceConnectionKey !== NATIVE_SOURCE_CONNECTION_KEY
	);
}

function SelectionRow({
	entry,
	onRemove,
	sources,
}: {
	entry: AdminCollectionCatalogEntry;
	onRemove: (key: string) => void;
	sources: readonly AdminSource[];
}) {
	const locked = isLockedCollection(entry);
	return (
		<div className="flex min-h-10 items-center gap-2 rounded-lg bg-black/[0.035] px-2.5 dark:bg-white/[0.045]">
			<Folder
				aria-hidden
				className="shrink-0 text-black/35 dark:text-white/35"
				size={14}
			/>
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs font-medium text-black/75 dark:text-white/80">
					{entry.name}
				</div>
				<div className="truncate text-[11px] text-black/40 dark:text-white/40">
					{adminCollectionPath(entry, sources)}
				</div>
			</div>
			{locked ? (
				<Lock
					aria-label={entry.deleted ? "Deleted" : "Read only"}
					className="shrink-0 text-black/30 dark:text-white/30"
					size={12}
				/>
			) : (
				<button
					aria-label={`Remove ${entry.name}, ${adminCollectionPath(entry, sources)}`}
					className="grid size-7 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
					onClick={() => onRemove(entry.key)}
					type="button"
				>
					<X aria-hidden size={13} />
				</button>
			)}
		</div>
	);
}

export function AdminCollectionPicker({
	allowTopLevel = false,
	autoFocus = false,
	disabledAncestorKey,
	editableOnly = false,
	includeDeleted = false,
	onSelect,
	onSelectTopLevel,
	onSelectionChange,
	selectedKeys,
	selectionMode,
	sources,
}: {
	allowTopLevel?: boolean;
	autoFocus?: boolean;
	disabledAncestorKey?: string;
	editableOnly?: boolean;
	includeDeleted?: boolean;
	onSelect?: (entry: AdminCollectionCatalogEntry) => void;
	onSelectTopLevel?: () => void;
	onSelectionChange: (keys: string[]) => void;
	selectedKeys: readonly string[];
	selectionMode: "multiple" | "single";
	sources: readonly AdminSource[];
}) {
	"use no memo";

	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query.trim(), 250);
	const [sourceKey, setSourceKey] = useState<string | null>(
		editableOnly ? NATIVE_SOURCE_CONNECTION_KEY : null,
	);
	const [path, setPath] = useState<CollectionPathEntry[]>([]);
	const [items, setItems] = useState<AdminCollectionCatalogEntry[]>([]);
	const [selectedEntries, setSelectedEntries] = useState<
		AdminCollectionCatalogEntry[]
	>([]);
	const [selectedEntriesError, setSelectedEntriesError] = useState(false);
	const [selectedEntriesReloadToken, setSelectedEntriesReloadToken] =
		useState(0);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const requestVersion = useRef(0);
	const loadMoreController = useRef<AbortController | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const selectedSignature = selectedKeys.join("\u0000");
	const stableSelectedKeys = useMemo(
		() => (selectedSignature ? selectedSignature.split("\u0000") : []),
		[selectedSignature],
	);
	const selectedSet = useMemo(
		() => new Set(stableSelectedKeys),
		[stableSelectedKeys],
	);
	const activeParent = path.at(-1)?.key ?? null;
	const showTopLevel =
		allowTopLevel && !debouncedQuery && activeParent === null;
	const contextKey = [
		debouncedQuery,
		sourceKey ?? "all",
		activeParent ?? "root",
		String(editableOnly),
		String(includeDeleted),
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

	const loadPage = useCallback(
		async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
			const requestContext = contextKey;
			const page = debouncedQuery
				? await searchAdminCollectionCatalog(
						{
							cursor,
							editableOnly,
							includeDeleted,
							pageSize: 50,
							query: debouncedQuery,
							sourceConnectionKey: sourceKey,
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
			setItems((current) =>
				append ? uniqueEntries(current, page.items) : page.items,
			);
			setNextCursor(page.nextCursor);
		},
		[
			activeParent,
			contextKey,
			debouncedQuery,
			editableOnly,
			includeDeleted,
			sourceKey,
		],
	);

	useEffect(() => {
		loadMoreController.current?.abort();
		setLoadingMore(false);
		if (!debouncedQuery && !sourceKey) {
			setItems([]);
			setNextCursor(null);
			setError(null);
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		const version = ++requestVersion.current;
		setItems([]);
		setNextCursor(null);
		setError(null);
		setLoading(true);
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
			})
			.finally(() => {
				if (version === requestVersion.current) setLoading(false);
			});
		return () => controller.abort();
	}, [contextKey, debouncedQuery, loadPage, sourceKey]);

	useEffect(() => {
		if (!stableSelectedKeys.length) {
			setSelectedEntries([]);
			setSelectedEntriesError(false);
			return;
		}
		setSelectedEntries((current) =>
			current.filter(({ key }) => selectedSet.has(key)),
		);
		setSelectedEntriesError(false);
		const controller = new AbortController();
		const chunks = Array.from(
			{ length: Math.ceil(stableSelectedKeys.length / 100) },
			(_, index) =>
				stableSelectedKeys.slice(index * 100, index * 100 + 100),
		);
		void Promise.allSettled(
			chunks.map((keys) =>
				resolveAdminCollectionCatalog(keys, controller.signal),
			),
		).then((responses) => {
			if (controller.signal.aborted) return;
			const resolved = responses.flatMap((response) =>
				response.status === "fulfilled" ? response.value.items : [],
			);
			setSelectedEntries((current) => {
				const entries = new Map(current.map((entry) => [entry.key, entry]));
				for (const entry of resolved) entries.set(entry.key, entry);
				return stableSelectedKeys.flatMap((key) => {
					const entry = entries.get(key);
					return entry ? [entry] : [];
				});
			});
			setSelectedEntriesError(
				responses.some((response) => response.status === "rejected"),
			);
		});
		return () => controller.abort();
	}, [selectedEntriesReloadToken, selectedSet, stableSelectedKeys]);

	const loadMore = useCallback(() => {
		if (!nextCursor || loading || loadingMore) return;
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
				if (contextKeyRef.current === requestContext) setLoadingMore(false);
			});
	}, [contextKey, loadPage, loading, loadingMore, nextCursor]);

	// TanStack Virtual intentionally returns unstable callbacks; this component's
	// `use no memo` directive keeps React Compiler away from the virtualizer.
	// eslint-disable-next-line react-hooks/incompatible-library
	const virtualizer = useVirtualizer({
		count: items.length + (nextCursor ? 1 : 0),
		estimateSize: () => 54,
		getScrollElement: () => scrollRef.current,
		overscan: 6,
	});

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
		onSelectionChange(selectedKeys.filter((candidate) => candidate !== key));
	};

	const browseInto = (entry: AdminCollectionCatalogEntry) => {
		setQuery("");
		setSourceKey(entry.sourceConnectionKey);
		setPath([...entry.ancestors, { key: entry.key, name: entry.name }]);
		scrollRef.current?.scrollTo({ top: 0 });
	};

	const chooseSource = (key: string) => {
		setSourceKey(key);
		setPath([]);
	};

	return (
		<div
			className="flex min-h-0 w-full flex-col gap-2"
			data-admin-collection-picker
		>
			<Input
				aria-label="Search collections"
				autoFocus={autoFocus}
				classNames={{
					input: "text-sm",
					inputWrapper: "h-9 min-h-9 rounded-lg",
				}}
				placeholder="Search collections"
				startContent={
					<Search
						aria-hidden
						className="text-black/35 dark:text-white/35"
						size={14}
					/>
				}
				value={query}
				onClear={() => setQuery("")}
				onValueChange={setQuery}
			/>

			{selectionMode === "multiple" && selectedEntries.length > 0 ? (
				<div className="max-h-28 space-y-1 overflow-y-auto pr-1">
					{selectedEntries.map((entry) => (
						<SelectionRow
							key={entry.key}
							entry={entry}
							onRemove={removeSelection}
							sources={sources}
						/>
					))}
				</div>
			) : null}
			{selectionMode === "multiple" && selectedEntriesError ? (
				<div className="flex min-h-9 items-center gap-2 rounded-lg bg-danger/10 px-2.5 text-xs text-danger">
					<AlertCircle aria-hidden className="shrink-0" size={13} />
					<span className="min-w-0 flex-1">
						Some selected collections could not be loaded.
					</span>
					<Button
						onPress={() =>
							setSelectedEntriesReloadToken((current) => current + 1)
						}
						size="xs"
						variant="transparent"
					>
						Retry
					</Button>
				</div>
			) : null}

			{!debouncedQuery && sourceKey ? (
				<div className="flex min-h-7 items-center gap-1 overflow-hidden px-0.5 text-xs text-black/45 dark:text-white/45">
					{!editableOnly ? (
						<button
							aria-label="Choose source"
							className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.06] dark:hover:text-white/75"
							onClick={() => {
								setSourceKey(null);
								setPath([]);
							}}
							type="button"
						>
							<ArrowLeft aria-hidden size={13} />
						</button>
					) : null}
					<button
						className="shrink-0 rounded-md px-1.5 py-1 font-medium hover:bg-black/[0.05] hover:text-black/75 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
						onClick={() => setPath([])}
						type="button"
					>
						{sources.find(({ key }) => key === sourceKey)?.label ??
							sourceKey}
					</button>
					{path.map((entry, index) => (
						<div key={entry.key} className="flex min-w-0 items-center">
							<ChevronRight aria-hidden className="shrink-0" size={11} />
							<button
								className="min-w-0 truncate rounded-md px-1.5 py-1 hover:bg-black/[0.05] hover:text-black/75 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
								onClick={() => setPath(path.slice(0, index + 1))}
								type="button"
							>
								{entry.name}
							</button>
						</div>
					))}
				</div>
			) : null}

			{!debouncedQuery && !sourceKey ? (
				<div className="max-h-72 min-h-48 space-y-1 overflow-y-auto rounded-xl bg-black/[0.02] p-1.5 dark:bg-white/[0.025]">
					{sources.map((source) => (
						<button
							key={source.key}
							className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-black/70 hover:bg-black/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/75 dark:hover:bg-white/[0.055]"
							onClick={() => chooseSource(source.key)}
							type="button"
						>
							<Folder aria-hidden className="shrink-0 opacity-45" size={15} />
							<span className="min-w-0 flex-1 truncate">{source.label}</span>
							{source.readOnly ? (
								<Lock aria-label="Read only" className="opacity-35" size={12} />
							) : null}
							<ChevronRight aria-hidden className="opacity-35" size={13} />
						</button>
					))}
				</div>
			) : (
				<div
					ref={scrollRef}
					className="relative max-h-[min(44vh,320px)] min-h-48 overflow-y-auto rounded-xl bg-black/[0.02] dark:bg-white/[0.025]"
					data-admin-collection-picker-results
				>
					{showTopLevel ? (
						<button
							className="sticky top-0 z-10 flex min-h-11 w-full items-center gap-2 border-b border-black/[0.06] bg-card_light px-3 text-left text-sm font-medium text-black/70 hover:bg-black/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:border-white/[0.06] dark:bg-card dark:text-white/75 dark:hover:bg-white/[0.045]"
							onClick={onSelectTopLevel}
							type="button"
						>
							<FolderOpen aria-hidden className="text-accent" size={15} />
							Top level
						</button>
					) : null}
					{loading ? (
						<div className="grid min-h-48 place-items-center text-black/40 dark:text-white/40">
							<LoaderCircle aria-label="Loading collections" className="animate-spin" size={15} />
						</div>
					) : error ? (
						<div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
							<AlertCircle aria-hidden className="text-danger" size={17} />
							<p className="text-xs text-black/55 dark:text-white/55">{error}</p>
							<Button
								onPress={() => setReloadToken((current) => current + 1)}
								size="xs"
								variant="transparent"
							>
								Try again
							</Button>
						</div>
					) : items.length === 0 ? (
						<div className="grid min-h-48 place-items-center px-6 text-center text-xs text-black/40 dark:text-white/40">
							{debouncedQuery
								? "No matching collections"
								: "No collections here"}
						</div>
					) : (
						<div
							className="relative w-full"
							style={{ height: virtualizer.getTotalSize() }}
						>
							{virtualizer.getVirtualItems().map((virtualRow) => {
								const entry = items[virtualRow.index];
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
												isDisabled={loadingMore}
												onPress={loadMore}
												size="xs"
												startContent={
													loadingMore ? (
														<LoaderCircle aria-hidden className="animate-spin" size={14} />
													) : undefined
												}
												variant="transparent"
											>
												{loadingMore ? "Loading" : "Load more"}
											</Button>
										</div>
									);
								}
								const selected = selectedSet.has(entry.key);
								const disabled =
									entry.deleted ||
									(editableOnly && isLockedCollection(entry)) ||
									entry.key === disabledAncestorKey ||
									entry.ancestors.some(
										({ key }) => key === disabledAncestorKey,
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
										<div
											className={`flex h-full min-w-0 items-center rounded-lg transition-colors ${
												selected
													? "bg-accent/[0.12] dark:bg-accent/20"
													: "hover:bg-black/[0.04] dark:hover:bg-white/[0.045]"
											}`}
										>
											{selectionMode === "multiple" ? (
											<Checkbox
												aria-label={`${entry.name}, ${adminCollectionPath(entry, sources)}`}
													className="m-0 min-w-0 flex-1 p-2"
													classNames={{ label: "min-w-0 flex-1" }}
													isDisabled={disabled}
													isSelected={selected}
													onValueChange={() => toggleEntry(entry)}
													size="sm"
												>
													<CollectionResultLabel entry={entry} sources={sources} />
												</Checkbox>
											) : (
												<button
													aria-pressed={selected}
													className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
													disabled={disabled}
													onClick={() => toggleEntry(entry)}
													type="button"
												>
													<Folder aria-hidden className="shrink-0 opacity-45" size={14} />
													<CollectionResultLabel entry={entry} sources={sources} />
												</button>
											)}
										{entry.hasChildren ? (
											<button
												aria-label={`Browse inside ${entry.name}, ${adminCollectionPath(entry, sources)}`}
												className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-30 dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
												disabled={disabled}
													onClick={() => browseInto(entry)}
													type="button"
												>
													<ChevronRight aria-hidden size={14} />
												</button>
											) : null}
										</div>
									</div>
								);
							})}
						</div>
					)}
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
