"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Folder01Icon, FolderOpenIcon, Loading03Icon, LockIcon, Search01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

import {
	getAdminCollectionChildren,
	searchAdminCollectionCatalog,
} from "./admin-api";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";

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

function SelectionRow({
	entry,
	locked,
	onRemove,
	sources,
}: {
	entry: AdminCollectionCatalogEntry;
	locked: boolean;
	onRemove: (key: string) => void;
	sources: readonly AdminSource[];
}) {
	return (
		<div className="flex min-h-10 items-center gap-2 rounded-lg bg-black/[0.035] px-2.5 dark:bg-white/[0.045]">
			<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 text-black/35 dark:text-white/35" size={14} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs font-medium text-black/75 dark:text-white/80">
					{entry.name}
				</div>
				<div className="truncate text-[11px] text-black/40 dark:text-white/40">
					{adminCollectionPath(entry, sources)}
				</div>
			</div>
			{locked ? (
				<HugeiconsIcon icon={LockIcon} aria-label={entry.deleted ? "Deleted" : "Read only"} className="shrink-0 text-black/30 dark:text-white/30" size={12} />
			) : (
				<button
					aria-label={`Remove ${entry.name}, ${adminCollectionPath(entry, sources)}`}
					className="grid size-7 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
					onClick={() => onRemove(entry.key)}
					type="button"
				>
					<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={13} />
				</button>
			)}
		</div>
	);
}

function CollectionLoadingStatus() {
	return (
		<div
			aria-label="Loading collections"
			className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-card_light px-2.5 py-2 text-xs font-medium text-black/60 shadow-sm dark:border-white/[0.09] dark:bg-card dark:text-white/65"
			role="status"
		>
			<HugeiconsIcon icon={Loading03Icon} aria-hidden className="animate-spin motion-reduce:animate-none" size={14} />
			Loading
		</div>
	);
}

function CollectionLoadingIndicator() {
	return (
		<div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
			<CollectionLoadingStatus />
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
	const debouncedQuery = useDebouncedValue(query.trim(), 250);
	const [sourceKey, setSourceKey] = useState<string | null>(defaultSourceKey);
	const [path, setPath] = useState<CollectionPathEntry[]>([]);
	const [items, setItems] = useState<AdminCollectionCatalogEntry[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
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

	useEffect(() => {
		if (!autoFocus || loading) return;
		const frame = window.requestAnimationFrame(() => {
			pickerRef.current
				?.querySelector<HTMLInputElement>(
					'input[aria-label="Search collections"]',
				)
				?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [autoFocus, loading]);

	const loadPage = useCallback(
		async (
			cursor: string | null,
			append: boolean,
			signal?: AbortSignal,
		) => {
			const requestContext = contextKey;
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
			setNextCursor(null);
			setError(null);
			setLoading(false);
			setSourceSelectionPending(false);
			return;
		}
		const controller = new AbortController();
		const version = ++requestVersion.current;
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
				setSourceSelectionPending(false);
			})
			.finally(() => {
				if (version === requestVersion.current) setLoading(false);
			});
		return () => controller.abort();
	}, [allowedSourceSet, contextKey, debouncedQuery, loadPage, sourceKey]);

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
				if (contextKeyRef.current === requestContext)
					setLoadingMore(false);
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
		onSelectionChange(
			selectedKeys.filter((candidate) => candidate !== key),
		);
	};

	const navigateToPath = (nextPath: CollectionPathEntry[]) => {
		const nextParent = nextPath.at(-1)?.key ?? null;
		if (nextParent === activeParent) return;
		setLoading(true);
		setPath(nextPath);
		scrollRef.current?.scrollTo({ top: 0 });
	};

	const browseInto = (entry: AdminCollectionCatalogEntry) => {
		setQuery("");
		setSourceKey(entry.sourceConnectionKey);
		navigateToPath([
			...entry.ancestors,
			{ key: entry.key, name: entry.name },
		]);
	};

	const chooseSource = (key: string) => {
		if (key === sourceKey && activeParent === null) return;
		setLoading(true);
		setSourceSelectionPending(true);
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
				aria-label="Search collections"
				autoFocus={autoFocus}
				classNames={{
					input: "text-sm",
					inputWrapper: "h-9 min-h-9 rounded-lg",
				}}
				placeholder="Search collections"
				isDisabled={loading}
				startContent={
					<HugeiconsIcon icon={Search01Icon} aria-hidden className="text-black/35 dark:text-white/35" size={14} />
				}
				value={query}
				onClear={() => setQuery("")}
				onValueChange={setQuery}
			/>

			{selectionMode === "multiple" && selectedEntries.length > 0 ? (
				<div
					className="max-h-28 space-y-1 overflow-y-auto pr-1"
					inert={loading ? true : undefined}
				>
					{selectedEntries.map((entry) => (
						<SelectionRow
							key={entry.key}
							entry={entry}
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
				</div>
			) : null}
			{selectionMode === "multiple" && selectedEntriesError ? (
				<div
					className="flex min-h-9 items-center gap-2 rounded-lg bg-danger/10 px-2.5 text-xs text-danger"
					inert={loading ? true : undefined}
				>
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
							disabled={loading}
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
							disabled={loading}
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
									disabled={loading}
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
							className={`space-y-1 p-1.5 transition-opacity duration-150 motion-reduce:transition-none ${
								sourceSelectionPending
									? "pointer-events-none select-none opacity-40"
									: "opacity-100"
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
										<HugeiconsIcon icon={LockIcon} aria-label="Read only" className="opacity-35" size={12} />
									) : null}
									<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="opacity-35" size={13} />
								</button>
							))}
						</div>
					</div>
					{sourceSelectionPending ? (
						<CollectionLoadingIndicator />
					) : null}
				</div>
			) : (
				<div
					aria-busy={loading}
					className="relative rounded-xl bg-black/[0.02] dark:bg-white/[0.025]"
					data-admin-collection-picker-results
				>
					<div
						ref={scrollRef}
						className="max-h-[min(44vh,320px)] overflow-y-auto rounded-xl"
						data-admin-collection-picker-scroll
					>
						<div
							className={`transition-opacity duration-150 motion-reduce:transition-none ${
								loading || error
									? "pointer-events-none select-none opacity-40"
									: "opacity-100"
							}`}
							data-admin-collection-picker-content
							inert={loading || Boolean(error) ? true : undefined}
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
							{items.length === 0 && !loading && !error ? (
								<div className="grid place-items-center px-6 py-4 text-center text-xs text-black/40 dark:text-white/40">
									{debouncedQuery
										? "No matching collections"
										: "No collections here"}
								</div>
							) : (
								<div
									className="relative w-full"
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
																loadingMore
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
															{loadingMore
																? "Loading"
																: "Load more"}
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
					{loading ? (
						items.length > 0 || showTopLevel ? (
							<CollectionLoadingIndicator />
						) : (
							<div className="flex justify-center py-2">
								<CollectionLoadingStatus />
							</div>
						)
					) : error ? (
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
