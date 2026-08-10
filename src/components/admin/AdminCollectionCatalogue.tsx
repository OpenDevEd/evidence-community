"use client";

import { useDraggable, useDroppable } from "@dnd-kit/react";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	Archive,
	ChevronRight,
	Cloud,
	Folder,
	FolderInput,
	FolderOpen,
	FolderPlus,
	GripVertical,
	LoaderCircle,
	Lock,
	Pencil,
	RotateCcw,
	Search,
	Settings2,
	Trash2,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { Dropdown } from "@/components/nextui/Dropdown";
import { Tooltip } from "@/components/nextui/Tooltip";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { itemCollectionSourceIsAssignable } from "@/lib/admin/item-collection-policy";
import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

import {
	COLLECTION_DRAG_TYPE,
	type CollectionDragData,
	type CollectionDropDestination,
	RECORD_DRAG_TYPE,
	useAdminDragState,
} from "./AdminDragDropProvider";
import { adminCollectionPath } from "./AdminCollectionPicker";
import {
	adminCollectionBranchKey,
	adminCollectionCatalogueReducer,
	flattenAdminCollectionCatalogue,
	type AdminCollectionCatalogueRow,
	useAdminCollectionCatalogue,
} from "./useAdminCollectionCatalogue";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";
import {
	ADMIN_COLLECTION_EXPANSION_EVENT,
	ADMIN_COLLECTION_FOCUS_EVENT,
	ADMIN_COLLECTION_INVALIDATION_EVENT,
	type AdminCollectionFocusRequest,
} from "./admin-collection-events";

const MAX_VISUAL_DEPTH = 8;
const ROW_HEIGHT = 36;

function useDebouncedValue(value: string, delay: number) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timeout);
	}, [delay, value]);
	return debounced;
}

function useResolvedCataloguePath(key: string | null, generation: number) {
	const { entries, retry: retryEntry } = useResolvedAdminCollections(
		key ? [key] : [],
	);
	const entry = entries[0];
	const ancestorKeys = useMemo(
		() => entry?.ancestors.map(({ key: ancestorKey }) => ancestorKey) ?? [],
		[entry],
	);
	const { entries: ancestors, retry: retryAncestors } =
		useResolvedAdminCollections(ancestorKeys);
	useEffect(() => {
		if (generation === 0 || !key) return;
		retryEntry();
		retryAncestors();
	}, [generation, key, retryAncestors, retryEntry]);
	return useMemo(
		() => ({ ancestorKeys, ancestors, entry }),
		[ancestorKeys, ancestors, entry],
	);
}

function RootDropZone({ active }: { active: boolean }) {
	const destination: CollectionDropDestination = {
		position: "root",
		targetCollection: null,
	};
	const { isDropTarget, ref } = useDroppable({
		accept: COLLECTION_DRAG_TYPE,
		data: destination,
		disabled: !active,
		id: "admin-collection-drop:root",
		type: "admin-collection-root",
	});
	if (!active) return null;
	return (
		<div
			ref={ref}
			className={`mx-2 flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed text-[11px] ${
				isDropTarget
					? "border-accent bg-accent/[0.12] text-accent-700 dark:bg-accent/20 dark:text-accent-300"
					: "border-black/15 text-black/40 dark:border-white/15 dark:text-white/40"
			}`}
			data-collection-drop="root"
		>
			<FolderInput aria-hidden size={13} />
			Move to top level
		</div>
	);
}

function EdgeDropZone({
	depth,
	entry,
	position,
}: {
	depth: number;
	entry: AdminCollectionCatalogEntry;
	position: "after" | "before";
}) {
	const destination: CollectionDropDestination = {
		position,
		targetCollection: entry.key,
	};
	const { isDropTarget, ref } = useDroppable({
		accept: COLLECTION_DRAG_TYPE,
		data: { ...destination, targetEntry: entry, targetName: entry.name },
		id: `admin-collection-drop:${position}:${entry.key}`,
		type: `admin-collection-${position}`,
	});
	return (
		<div
			ref={ref}
			aria-hidden
			className={`pointer-events-none absolute inset-x-0 z-20 h-1/4 ${
				position === "before" ? "top-0" : "bottom-0"
			}`}
			data-collection-drop={`${position}:${entry.key}`}
		>
			{isDropTarget ? (
				<span
					className={`absolute h-0.5 rounded-full bg-accent ${
						position === "before" ? "top-0" : "bottom-0"
					}`}
					style={{ left: 8 + depth * 12, right: 4 }}
				/>
			) : null}
		</div>
	);
}

function CollectionActions({
	entry,
	onCreate,
	onDelete,
	onEdit,
	onMove,
}: {
	entry: AdminCollectionCatalogEntry;
	onCreate: (parentCollection: AdminCollectionCatalogEntry | null) => void;
	onDelete: (collection: AdminCollectionCatalogEntry) => void;
	onEdit: (collection: AdminCollectionCatalogEntry) => void;
	onMove: (collection: AdminCollectionCatalogEntry) => void;
}) {
	return (
		<Dropdown placement="bottom-end">
			<DropdownTrigger>
				<button
					aria-label={`Manage ${entry.name}`}
					className="grid size-7 shrink-0 place-items-center rounded-md text-black/40 hover:bg-black/[0.06] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/40 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
					type="button"
				>
					<Settings2 aria-hidden size={14} />
				</button>
			</DropdownTrigger>
			<DropdownMenu
				aria-label={`Actions for ${entry.name}`}
				onAction={(key) => {
					if (key === "create") onCreate(entry);
					if (key === "rename") onEdit(entry);
					if (key === "move") onMove(entry);
					if (key === "delete") onDelete(entry);
				}}
			>
				<DropdownItem
					key="create"
					startContent={<FolderPlus aria-hidden size={14} />}
				>
					New inside
				</DropdownItem>
				<DropdownItem
					key="rename"
					startContent={<Pencil aria-hidden size={14} />}
				>
					Rename
				</DropdownItem>
				<DropdownItem
					key="move"
					startContent={<FolderInput aria-hidden size={14} />}
				>
					Move
				</DropdownItem>
				<DropdownItem
					key="delete"
					color="danger"
					startContent={<Trash2 aria-hidden size={14} />}
				>
					Delete
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}

type CollectionRowProps = {
	busy: boolean;
	depth: number;
	editable: boolean;
	entry: AdminCollectionCatalogEntry;
	expanded: boolean;
	focused: boolean;
	hierarchyEnabled: boolean;
	onCreate: (parentCollection: AdminCollectionCatalogEntry | null) => void;
	onDelete: (collection: AdminCollectionCatalogEntry) => void;
	onEdit: (collection: AdminCollectionCatalogEntry) => void;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onMove: (collection: AdminCollectionCatalogEntry) => void;
	onRestore: (collection: AdminCollectionCatalogEntry) => void;
	onSelect: (key: string) => void;
	onToggle: (entry: AdminCollectionCatalogEntry) => void;
	path?: string;
	positionInSet?: number;
	selected: boolean;
	setSize: number;
	view: "active" | "deleted";
};

function CollectionRow({
	busy,
	depth,
	editable,
	entry,
	expanded,
	focused,
	hierarchyEnabled,
	onCreate,
	onDelete,
	onEdit,
	onFocus,
	onKeyDown,
	onMove,
	onRestore,
	onSelect,
	onToggle,
	path,
	positionInSet,
	selected,
	setSize,
	view,
}: CollectionRowProps) {
	const movesEnabled =
		editable && view === "active" && hierarchyEnabled && !busy;
	const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
	const {
		activeCollectionKey,
		activeRecordCount,
		activeRecordSourceConnectionKey,
	} = useAdminDragState();
	const invalidCollectionTarget = Boolean(
		activeCollectionKey &&
		(activeCollectionKey === entry.key ||
			entry.ancestors.some(({ key }) => key === activeCollectionKey)),
	);
	const acceptsCollection =
		movesEnabled &&
		Boolean(activeCollectionKey) &&
		!invalidCollectionTarget;
	const acceptsRecords =
		editable &&
		view === "active" &&
		!busy &&
		activeRecordCount > 0 &&
		activeRecordSourceConnectionKey !== null &&
		itemCollectionSourceIsAssignable(
			activeRecordSourceConnectionKey,
			entry.sourceConnectionKey,
		);
	const insideDestination: CollectionDropDestination = {
		position: "inside",
		targetCollection: entry.key,
	};
	const { isDropTarget, ref: insideRef } = useDroppable({
		accept: [COLLECTION_DRAG_TYPE, RECORD_DRAG_TYPE],
		data: {
			...insideDestination,
			targetEntry: entry,
			targetName: entry.name,
		},
		disabled: !acceptsCollection && !acceptsRecords,
		id: `admin-collection-inside:${entry.key}`,
		type: "admin-collection-inside",
	});
	const { handleRef, isDragging, ref } = useDraggable<CollectionDragData>({
		data: {
			collection: entry,
			kind: "collection",
		},
		disabled: !movesEnabled,
		id: `admin-collection:${entry.key}`,
		type: COLLECTION_DRAG_TYPE,
	});
	useEffect(() => {
		if (
			!hierarchyEnabled ||
			!entry.hasChildren ||
			!isDropTarget ||
			expanded
		) {
			return;
		}
		const timeout = window.setTimeout(() => onToggle(entry), 650);
		return () => window.clearTimeout(timeout);
	}, [entry, expanded, hierarchyEnabled, isDropTarget, onToggle]);

	const Icon = selected || expanded ? FolderOpen : Folder;
	return (
		<div
			ref={hierarchyEnabled ? ref : undefined}
			className={`group relative flex h-full items-center rounded-lg pr-1 text-[13px] ${
				isDragging ? "opacity-35" : ""
			} ${
				selected
					? "font-medium text-black dark:text-white"
					: "text-black/60 dark:text-white/60"
			} ${
				isDropTarget
					? "bg-accent/15 ring-1 ring-inset ring-accent/55 dark:bg-accent/25"
					: selected
						? "bg-accent/[0.12] dark:bg-accent/20"
						: "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
			}`}
			data-collection-drop-highlight={isDropTarget ? entry.key : undefined}
			data-collection-key={entry.key}
			style={{ paddingLeft: 4 + visualDepth * 12 }}
		>
			{acceptsCollection ? (
				<>
					<EdgeDropZone
						depth={visualDepth}
						entry={entry}
						position="before"
					/>
					<EdgeDropZone
						depth={visualDepth}
						entry={entry}
						position="after"
					/>
				</>
			) : null}
			{acceptsCollection || acceptsRecords ? (
				<div
					ref={insideRef}
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-1/4 z-10 h-1/2"
					data-collection-drop={`inside:${entry.key}`}
					data-record-collection-drop={
						acceptsRecords ? entry.key : undefined
					}
				/>
			) : null}
			{entry.hasChildren && hierarchyEnabled ? (
				<button
					aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
					className="relative z-30 grid size-6 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/70"
					onClick={() => onToggle(entry)}
					type="button"
				>
					<ChevronRight
						aria-hidden
						className={expanded ? "rotate-90" : ""}
						size={13}
					/>
				</button>
			) : movesEnabled ? (
				<button
					ref={handleRef}
					aria-label={`Drag ${entry.name}`}
					className="relative z-30 grid size-6 shrink-0 touch-none place-items-center rounded-md text-black/30 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 dark:text-white/30"
					data-collection-drag-handle={entry.key}
					type="button"
				>
					<GripVertical aria-hidden size={13} />
				</button>
			) : (
				<span className="size-6 shrink-0" />
			)}
			<button
				aria-disabled={view === "deleted" && !editable}
				aria-expanded={
					entry.hasChildren && hierarchyEnabled ? expanded : undefined
				}
				aria-level={depth + 1}
				aria-posinset={positionInSet}
				aria-selected={selected}
				aria-setsize={setSize}
				className="relative z-30 flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
				id={`admin-catalogue-collection:${entry.key}`}
				onClick={() => {
					if (view === "active") onSelect(entry.key);
					else if (editable) onRestore(entry);
				}}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				role="treeitem"
				tabIndex={focused ? 0 : -1}
				type="button"
			>
				<Icon
					aria-hidden
					className={
						selected
							? "text-accent-700 dark:text-accent-300"
							: "opacity-55"
					}
					size={14}
				/>
				<span className="min-w-0 flex-1 truncate">
					<span className="block truncate">{entry.name}</span>
					{path ? (
						<span className="block truncate text-[10px] font-normal opacity-50">
							{path}
						</span>
					) : null}
				</span>
				{!editable ? (
					<Lock
						aria-label="Collection editing unavailable"
						className="shrink-0 opacity-35"
						size={11}
					/>
				) : null}
			</button>
			{view === "deleted" && editable ? (
				<Tooltip content={`Restore ${entry.name}`}>
					<button
						aria-label={`Restore ${entry.name}`}
						className="relative z-30 grid size-7 shrink-0 place-items-center rounded-md text-black/40 hover:bg-black/[0.06] dark:text-white/40 dark:hover:bg-white/[0.07]"
						onClick={() => onRestore(entry)}
						type="button"
					>
						<RotateCcw aria-hidden size={13} />
					</button>
				</Tooltip>
			) : view === "active" && editable ? (
				<div className="relative z-30 flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
					{entry.hasChildren && hierarchyEnabled ? (
						<button
							ref={handleRef}
							aria-label={`Drag ${entry.name}`}
							className="grid size-7 shrink-0 touch-none place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/75 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
							data-collection-drag-handle={entry.key}
							type="button"
						>
							<GripVertical aria-hidden size={14} />
						</button>
					) : null}
					<CollectionActions
						entry={entry}
						onCreate={onCreate}
						onDelete={onDelete}
						onEdit={onEdit}
						onMove={onMove}
					/>
				</div>
			) : null}
		</div>
	);
}

type CatalogueProps = {
	busy: boolean;
	onCreate: (parentCollection: AdminCollectionCatalogEntry | null) => void;
	onDelete: (collection: AdminCollectionCatalogEntry) => void;
	onEdit: (collection: AdminCollectionCatalogEntry) => void;
	onMove: (collection: AdminCollectionCatalogEntry) => void;
	onRestore: (collection: AdminCollectionCatalogEntry) => void;
	onSelect: (key: string) => void;
	selectedCollection: string | null;
	sources: AdminSource[];
};

type CatalogueStatusRow = Exclude<
	AdminCollectionCatalogueRow,
	{ kind: "collection" } | { kind: "source" }
>;

export function AdminCollectionCatalogue({
	busy,
	onCreate,
	onDelete,
	onEdit,
	onMove,
	onRestore,
	onSelect,
	selectedCollection,
	sources,
}: CatalogueProps) {
	"use no memo";
	const { identity } = useLibraryConfig();
	const {
		invalidate: catalogueInvalidate,
		loadChildren,
		loadSearch,
		reveal,
		state: catalogueState,
	} = useAdminCollectionCatalogue();
	const { activeCollectionKey } = useAdminDragState();
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query.trim(), 250);
	const [view, setView] = useState<"active" | "deleted">("active");
	const editableSourceKeys = useMemo(
		() =>
			new Set(
				sources
					.filter(({ readOnly }) => !readOnly)
					.map(({ key }) => key),
			),
		[sources],
	);
	const [expandedSources, setExpandedSources] = useState(
		() => new Set([NATIVE_SOURCE_CONNECTION_KEY]),
	);
	const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
		new Set(),
	);
	const [focusedId, setFocusedId] = useState<string>(
		`source:${NATIVE_SOURCE_CONNECTION_KEY}`,
	);
	const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
	const [pendingFocusEntry, setPendingFocusEntry] =
		useState<AdminCollectionCatalogEntry | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const pendingStatusFocus = useRef<{
		branchKey: string;
		intent: "first" | "status";
		parentCollection: string | null;
		sourceConnectionKey: string;
		waiting: boolean;
	} | null>(null);
	const restoredExpansion = useRef(false);
	const scrolledSelection = useRef("");
	const storageKey = `admin.collection-catalogue.expanded:${identity.baseUrl}`;
	useEffect(() => {
		const cancelStaleStatusTransfer = (event: FocusEvent) => {
			const pending = pendingStatusFocus.current;
			if (!pending?.waiting) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.dataset.catalogueStatusBranch === pending.branchKey
			) {
				return;
			}
			pendingStatusFocus.current = null;
		};
		document.addEventListener("focusin", cancelStaleStatusTransfer);
		return () =>
			document.removeEventListener("focusin", cancelStaleStatusTransfer);
	}, []);
	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(storageKey);
			if (saved) {
				const parsed = JSON.parse(saved) as {
					collections?: string[];
					sources?: string[];
				};
				setExpandedSources(
					new Set([
						NATIVE_SOURCE_CONNECTION_KEY,
						...(parsed.sources ?? []),
					]),
				);
				setExpandedCollections(new Set(parsed.collections ?? []));
			}
		} catch {
			// Expansion persistence is optional; catalogue navigation remains usable.
		}
		restoredExpansion.current = true;
	}, [storageKey]);

	useEffect(() => {
		if (!restoredExpansion.current) return;
		try {
			window.localStorage.setItem(
				storageKey,
				JSON.stringify({
					collections: [...expandedCollections],
					sources: [...expandedSources],
				}),
			);
		} catch {
			// Expansion persistence is optional; catalogue navigation remains usable.
		}
	}, [expandedCollections, expandedSources, storageKey]);

	useEffect(() => {
		const expand = (event: Event) => {
			const keys = (event as CustomEvent<string[]>).detail;
			if (!Array.isArray(keys)) return;
			setExpandedCollections((current) => new Set([...current, ...keys]));
		};
		window.addEventListener(ADMIN_COLLECTION_EXPANSION_EVENT, expand);
		return () =>
			window.removeEventListener(
				ADMIN_COLLECTION_EXPANSION_EVENT,
				expand,
			);
	}, []);

	useEffect(() => {
		const handleInvalidation = () => {
			scrolledSelection.current = "";
			setPendingFocusEntry(null);
			catalogueInvalidate();
		};
		window.addEventListener(
			ADMIN_COLLECTION_INVALIDATION_EVENT,
			handleInvalidation,
		);
		return () =>
			window.removeEventListener(
				ADMIN_COLLECTION_INVALIDATION_EVENT,
				handleInvalidation,
			);
	}, [catalogueInvalidate]);

	useEffect(() => {
		const handleFocus = (event: Event) => {
			const request = (event as CustomEvent<AdminCollectionFocusRequest>)
				.detail;
			if (!request || typeof request.key !== "string") return;
			setPendingFocusEntry(request.entry ?? null);
			setPendingFocusKey(request.key);
		};
		window.addEventListener(ADMIN_COLLECTION_FOCUS_EVENT, handleFocus);
		return () =>
			window.removeEventListener(
				ADMIN_COLLECTION_FOCUS_EVENT,
				handleFocus,
			);
	}, []);

	useEffect(() => {
		if (!pendingFocusEntry) return;
		reveal([pendingFocusEntry]);
		setExpandedSources(
			(current) =>
				new Set([...current, pendingFocusEntry.sourceConnectionKey]),
		);
		setExpandedCollections(
			(current) =>
				new Set([
					...current,
					...pendingFocusEntry.ancestors.map(({ key }) => key),
				]),
		);
	}, [pendingFocusEntry, reveal]);

	const selectedKey =
		selectedCollection && selectedCollection !== "all"
			? selectedCollection
			: null;
	const selectedPath = useResolvedCataloguePath(
		selectedKey,
		catalogueState.generation,
	);
	useEffect(() => {
		if (!selectedPath.entry) return;
		reveal([...selectedPath.ancestors, selectedPath.entry]);
		setExpandedSources(
			(current) =>
				new Set([...current, selectedPath.entry!.sourceConnectionKey]),
		);
		setExpandedCollections(
			(current) => new Set([...current, ...selectedPath.ancestorKeys]),
		);
	}, [reveal, selectedPath]);
	const pendingFocusPath = useResolvedCataloguePath(
		pendingFocusEntry ? null : pendingFocusKey,
		catalogueState.generation,
	);
	useEffect(() => {
		if (!pendingFocusPath.entry) return;
		reveal([...pendingFocusPath.ancestors, pendingFocusPath.entry]);
		setExpandedSources(
			(current) =>
				new Set([
					...current,
					pendingFocusPath.entry!.sourceConnectionKey,
				]),
		);
		setExpandedCollections(
			(current) =>
				new Set([...current, ...pendingFocusPath.ancestorKeys]),
		);
	}, [pendingFocusPath, reveal]);

	const searchMode = view === "deleted" || debouncedQuery.length > 0;
	useEffect(() => {
		if (!searchMode) return;
		void loadSearch({
			query: debouncedQuery,
			sourceConnectionKey: null,
			state: view === "deleted" ? "deleted" : "active",
		});
	}, [
		catalogueState.generation,
		debouncedQuery,
		loadSearch,
		searchMode,
		view,
	]);

	useEffect(() => {
		if (searchMode) return;
		const expandedRootBranches = [...expandedSources].map((sourceKey) => ({
			branch: catalogueState.branches.get(
				adminCollectionBranchKey(sourceKey, null),
			),
			sourceKey,
		}));
		const capacity = Math.max(
			0,
			4 -
				expandedRootBranches.filter(
					({ branch }) => branch?.status === "loading",
				).length,
		);
		for (const { sourceKey } of expandedRootBranches
			.filter(({ branch }) => !branch || branch.status === "idle")
			.slice(0, capacity)) {
			void loadChildren(sourceKey, null);
		}
	}, [catalogueState.branches, expandedSources, loadChildren, searchMode]);

	const catalogueTreeState = useMemo(
		() =>
			pendingFocusEntry
				? adminCollectionCatalogueReducer(catalogueState, {
						entries: [pendingFocusEntry],
						type: "reveal",
					})
				: catalogueState,
		[catalogueState, pendingFocusEntry],
	);
	const treeRows = useMemo(
		() =>
			flattenAdminCollectionCatalogue(
				catalogueTreeState,
				sources,
				expandedSources,
				expandedCollections,
			),
		[catalogueTreeState, expandedCollections, expandedSources, sources],
	);
	useEffect(() => {
		if (searchMode) return;
		const expandedChildBranches = treeRows.flatMap((row) => {
			if (
				row.kind !== "collection" ||
				!row.entry.hasChildren ||
				!expandedCollections.has(row.entry.key)
			) {
				return [];
			}
			return [
				{
					branch: catalogueState.branches.get(
						adminCollectionBranchKey(
							row.entry.sourceConnectionKey,
							row.entry.key,
						),
					),
					entry: row.entry,
				},
			];
		});
		const capacity = Math.max(
			0,
			4 -
				expandedChildBranches.filter(
					({ branch }) => branch?.status === "loading",
				).length,
		);
		const missing = expandedChildBranches
			.filter(({ branch }) => !branch || branch.status === "idle")
			.slice(0, capacity)
			.map(({ entry }) => entry);
		for (const entry of missing) {
			void loadChildren(entry.sourceConnectionKey, entry.key);
		}
	}, [
		catalogueState.branches,
		expandedCollections,
		loadChildren,
		searchMode,
		treeRows,
	]);

	const rows = useMemo<AdminCollectionCatalogueRow[]>(() => {
		if (!searchMode) return treeRows;
		const searchSetSize = catalogueState.search.nextCursor
			? -1
			: catalogueState.search.items.length;
		const resultRows: AdminCollectionCatalogueRow[] =
			catalogueState.search.items.map((entry, index) => ({
				depth: 0,
				entry,
				kind: "collection",
				positionInSet: index + 1,
				revealed: false,
				setSize: searchSetSize,
			}));
		const statusPosition = resultRows.length + 1;
		if (
			catalogueState.search.status === "loading" ||
			catalogueState.search.loadingMore
		) {
			resultRows.push({
				branchKey: "search",
				depth: 0,
				kind: "loading",
				parentCollection: null,
				positionInSet: statusPosition,
				setSize: -1,
				sourceConnectionKey: "all",
			});
		} else if (
			catalogueState.search.status === "error" ||
			catalogueState.search.loadMoreError
		) {
			resultRows.push({
				branchKey: "search",
				depth: 0,
				kind: "error",
				parentCollection: null,
				positionInSet: statusPosition,
				retryMode: catalogueState.search.loadMoreError
					? "more"
					: "refresh",
				setSize: -1,
				sourceConnectionKey: "all",
			});
		} else if (catalogueState.search.nextCursor) {
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
	}, [catalogueState.search, searchMode, treeRows, view]);
	const rowId = useCallback((row: AdminCollectionCatalogueRow) => {
		if (row.kind === "source") return `source:${row.source.key}`;
		if (row.kind === "collection") return `collection:${row.entry.key}`;
		return `status:${row.branchKey}`;
	}, []);
	const registerRowFocus = (id: string) => {
		if (selectedKey) scrolledSelection.current = selectedKey;
		setFocusedId(id);
	};
	const focusableRows = useMemo(
		() =>
			rows.filter(
				(row) =>
					row.kind === "source" ||
					row.kind === "collection" ||
					row.kind === "loading" ||
					row.kind === "loadMore" ||
					row.kind === "error",
			),
		[rows],
	);
	const pendingTreeFocus = useRef<string | null>(null);
	useEffect(() => {
		const id = pendingTreeFocus.current;
		if (!id) return;
		const target = document.getElementById(`admin-catalogue-${id}`);
		if (!target) return;
		target.focus({ preventScroll: true });
		pendingTreeFocus.current = null;
	});
	useEffect(() => {
		if (
			focusableRows.length > 0 &&
			!focusableRows.some((row) => rowId(row) === focusedId)
		) {
			setFocusedId(rowId(focusableRows[0]!));
		}
	}, [focusableRows, focusedId, rowId]);
	const focusedIndex = rows.findIndex((row) => rowId(row) === focusedId);
	const pendingFocusIndex = rows.findIndex(
		(row) =>
			row.kind === "collection" &&
			row.entry.key === pendingFocusKey &&
			(!pendingFocusEntry ||
				(row.entry.parentCollection ===
					pendingFocusEntry.parentCollection &&
					row.entry.revision === pendingFocusEntry.revision)),
	);
	// eslint-disable-next-line react-hooks/incompatible-library
	const virtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: () => ROW_HEIGHT,
		getItemKey: (index) => rowId(rows[index]!),
		getScrollElement: () => scrollRef.current,
		overscan: 8,
		rangeExtractor: (range) => {
			const indexes = new Set(defaultRangeExtractor(range));
			if (focusedIndex >= 0) indexes.add(focusedIndex);
			if (pendingFocusIndex >= 0) indexes.add(pendingFocusIndex);
			return [...indexes].sort((left, right) => left - right);
		},
	});
	useEffect(() => {
		if (!selectedKey || searchMode) return;
		if (scrolledSelection.current === selectedKey) return;
		const index = rows.findIndex(
			(row) => row.kind === "collection" && row.entry.key === selectedKey,
		);
		if (index < 0) return;
		scrolledSelection.current = selectedKey;
		virtualizer.scrollToIndex(index, { align: "center" });
	}, [rows, searchMode, selectedKey, virtualizer]);
	const focusRow = (target: AdminCollectionCatalogueRow | undefined) => {
		if (!target) return;
		const id = rowId(target);
		const rowIndex = rows.indexOf(target);
		if (rowIndex >= 0)
			virtualizer.scrollToIndex(rowIndex, { align: "auto" });
		pendingTreeFocus.current = id;
		registerRowFocus(id);
		const mountedTarget = document.getElementById(`admin-catalogue-${id}`);
		if (mountedTarget) {
			mountedTarget.focus({ preventScroll: true });
			pendingTreeFocus.current = null;
		}
	};
	const focusRelative = (currentId: string, offset: number) => {
		const index = focusableRows.findIndex(
			(row) => rowId(row) === currentId,
		);
		focusRow(
			focusableRows[
				Math.max(0, Math.min(focusableRows.length - 1, index + offset))
			],
		);
	};
	const focusBoundary = (position: "end" | "start") =>
		focusRow(
			position === "start" ? focusableRows[0] : focusableRows.at(-1),
		);
	const focusParent = (entry: AdminCollectionCatalogEntry) => {
		const parent = entry.parentCollection
			? focusableRows.find(
					(row) =>
						row.kind === "collection" &&
						row.entry.key === entry.parentCollection,
				)
			: focusableRows.find(
					(row) =>
						row.kind === "source" &&
						row.source.key === entry.sourceConnectionKey,
				);
		focusRow(parent);
	};
	const focusSourceChild = (sourceConnectionKey: string) =>
		focusRow(
			focusableRows.find(
				(row) =>
					row.kind === "collection" &&
					row.entry.sourceConnectionKey === sourceConnectionKey &&
					row.entry.parentCollection === null,
			),
		);
	const focusCollectionChild = (parentCollection: string) =>
		focusRow(
			focusableRows.find(
				(row) =>
					row.kind === "collection" &&
					row.entry.parentCollection === parentCollection,
			),
		);
	const pendingFocusBranch = pendingFocusEntry
		? catalogueState.branches.get(
				adminCollectionBranchKey(
					pendingFocusEntry.sourceConnectionKey,
					pendingFocusEntry.parentCollection,
				),
			)
		: null;
	const pendingFocusCanSettle =
		!pendingFocusEntry ||
		(pendingFocusBranch?.status === "ready" &&
			!pendingFocusBranch.loadingMore);
	useEffect(() => {
		if (!pendingFocusKey || busy) return;
		const rowIndex = rows.findIndex(
			(row) =>
				row.kind === "collection" &&
				row.entry.key === pendingFocusKey &&
				(!pendingFocusEntry ||
					(row.entry.parentCollection ===
						pendingFocusEntry.parentCollection &&
						row.entry.revision === pendingFocusEntry.revision)),
		);
		if (rowIndex < 0) {
			if (
				searchMode &&
				(catalogueState.search.status === "ready" ||
					catalogueState.search.status === "error") &&
				!catalogueState.search.loadingMore
			) {
				document
					.querySelector<HTMLElement>(
						'[aria-label="Search collections"]',
					)
					?.focus({ preventScroll: true });
				setPendingFocusKey(null);
				setPendingFocusEntry(null);
			}
			return;
		}
		virtualizer.scrollToIndex(rowIndex, { align: "center" });
		let secondFrame = 0;
		const firstFrame = window.requestAnimationFrame(() => {
			secondFrame = window.requestAnimationFrame(() => {
				const target =
					document.querySelector<HTMLElement>(
						`[data-collection-drag-handle="${pendingFocusKey}"]`,
					) ??
					document.getElementById(
						`admin-catalogue-collection:${pendingFocusKey}`,
					);
				if (!target) return;
				target.focus({ preventScroll: true });
				if (pendingFocusCanSettle) {
					setPendingFocusKey(null);
					setPendingFocusEntry(null);
				}
			});
		});
		return () => {
			window.cancelAnimationFrame(firstFrame);
			window.cancelAnimationFrame(secondFrame);
		};
	}, [
		busy,
		catalogueState.search.loadingMore,
		catalogueState.search.status,
		pendingFocusEntry,
		pendingFocusCanSettle,
		pendingFocusKey,
		rows,
		searchMode,
		virtualizer,
	]);

	const toggleSource = (key: string) => {
		setExpandedSources((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	const toggleCollection = useCallback(
		(entry: AdminCollectionCatalogEntry) => {
			setExpandedCollections((current) => {
				const next = new Set(current);
				if (next.has(entry.key)) next.delete(entry.key);
				else next.add(entry.key);
				return next;
			});
			if (!expandedCollections.has(entry.key))
				void loadChildren(entry.sourceConnectionKey, entry.key);
		},
		[expandedCollections, loadChildren],
	);

	const loadMore = (row: CatalogueStatusRow) => {
		const retryingMore = row.kind === "error" && row.retryMode === "more";
		const more = row.kind === "loadMore" || retryingMore;
		const requestOptions = more
			? { force: retryingMore, more: true }
			: { force: true };
		pendingStatusFocus.current = {
			branchKey: row.branchKey,
			intent: more ? "status" : "first",
			parentCollection: row.parentCollection,
			sourceConnectionKey: row.sourceConnectionKey,
			waiting: true,
		};
		if (searchMode) {
			void loadSearch(
				{
					query: debouncedQuery,
					sourceConnectionKey: null,
					state: view === "deleted" ? "deleted" : "active",
				},
				requestOptions,
			);
			return;
		}
		void loadChildren(
			row.sourceConnectionKey,
			row.parentCollection,
			requestOptions,
		);
	};
	useEffect(() => {
		const pending = pendingStatusFocus.current;
		if (!pending?.waiting) return;
		const status = rows.find(
			(row) =>
				row.kind !== "collection" &&
				row.kind !== "source" &&
				row.kind !== "empty" &&
				row.branchKey === pending.branchKey,
		);
		if (status?.kind === "loading") return;
		pendingStatusFocus.current = null;
		if (status?.kind === "error") {
			focusRow(status);
			return;
		}
		if (pending.intent === "status" && status) {
			focusRow(status);
			return;
		}
		const loaded = rows.filter(
			(
				row,
			): row is Extract<
				AdminCollectionCatalogueRow,
				{ kind: "collection" }
			> =>
				row.kind === "collection" &&
				(pending.branchKey === "search" ||
					(row.entry.sourceConnectionKey ===
						pending.sourceConnectionKey &&
						row.entry.parentCollection ===
							pending.parentCollection)),
		);
		const loadedTarget =
			pending.intent === "first" ? loaded[0] : loaded.at(-1);
		if (loadedTarget) {
			focusRow(loadedTarget);
			return;
		}
		const branchOwner = pending.parentCollection
			? focusableRows.find(
					(row) =>
						row.kind === "collection" &&
						row.entry.key === pending.parentCollection,
				)
			: focusableRows.find(
					(row) =>
						row.kind === "source" &&
						row.source.key === pending.sourceConnectionKey,
				);
		if (branchOwner) {
			focusRow(branchOwner);
			return;
		}
		document
			.querySelector<HTMLElement>('[aria-label="Search collections"]')
			?.focus({ preventScroll: true });
	}, [focusRow, focusableRows, rows]);

	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label="Collection catalogue"
		>
			<div className="flex shrink-0 items-center gap-1.5 px-2 pb-2 pt-1">
				<label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-black/[0.045] px-2.5 text-black/45 focus-within:ring-2 focus-within:ring-focus/40 dark:bg-white/[0.055] dark:text-white/45">
					<Search aria-hidden className="shrink-0" size={13} />
					<input
						aria-label="Search collections"
						className="min-w-0 flex-1 bg-transparent text-xs text-black outline-none placeholder:text-black/35 dark:text-white dark:placeholder:text-white/35"
						onChange={(event) => setQuery(event.target.value)}
						placeholder={
							view === "deleted"
								? "Search deleted"
								: "Search collections"
						}
						value={query}
					/>
					{query ? (
						<button
							aria-label="Clear collection search"
							className="grid size-5 place-items-center rounded text-black/35 hover:text-black/70 dark:text-white/35 dark:hover:text-white/70"
							onClick={() => setQuery("")}
							type="button"
						>
							<X aria-hidden size={12} />
						</button>
					) : null}
				</label>
				<Tooltip
					content={
						view === "deleted"
							? "Show active collections"
							: "Show deleted collections"
					}
				>
					<button
						aria-label={
							view === "deleted"
								? "Show active collections"
								: "Show deleted collections"
						}
						aria-pressed={view === "deleted"}
						className={`grid size-8 shrink-0 place-items-center rounded-lg ${view === "deleted" ? "bg-accent/[0.12] text-accent-700 dark:bg-accent/20 dark:text-accent-300" : "text-black/40 hover:bg-black/[0.05] dark:text-white/40 dark:hover:bg-white/[0.06]"}`}
						onClick={() =>
							setView((current) =>
								current === "active" ? "deleted" : "active",
							)
						}
						type="button"
					>
						<Archive aria-hidden size={14} />
					</button>
				</Tooltip>
			</div>
			<div
				ref={scrollRef}
				className="min-h-0 flex-1 overflow-y-auto px-2"
				role="tree"
				aria-label={
					view === "deleted" ? "Deleted collections" : "Collections"
				}
			>
				<div
					className="relative w-full"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const row = rows[virtualRow.index]!;
						const id = rowId(row);
						return (
							<div
								key={virtualRow.key}
								ref={virtualizer.measureElement}
								className="absolute left-0 top-0 w-full py-px"
								data-index={virtualRow.index}
								style={{
									height: ROW_HEIGHT,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{row.kind === "source" ? (
									<button
										aria-expanded={expandedSources.has(
											row.source.key,
										)}
										aria-level={1}
										aria-posinset={row.positionInSet}
										aria-selected={false}
										aria-setsize={row.setSize}
										className="flex h-full w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] font-medium text-black/50 hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/50 dark:hover:bg-white/[0.04]"
										id={`admin-catalogue-${id}`}
										onClick={() =>
											toggleSource(row.source.key)
										}
										onFocus={() => registerRowFocus(id)}
										onKeyDown={(event) => {
											if (event.key === "ArrowDown") {
												event.preventDefault();
												focusRelative(id, 1);
											}
											if (event.key === "ArrowUp") {
												event.preventDefault();
												focusRelative(id, -1);
											}
											if (event.key === "Home") {
												event.preventDefault();
												focusBoundary("start");
											}
											if (event.key === "End") {
												event.preventDefault();
												focusBoundary("end");
											}
											if (event.key === "ArrowRight") {
												event.preventDefault();
												if (
													expandedSources.has(
														row.source.key,
													)
												)
													focusSourceChild(
														row.source.key,
													);
												else
													toggleSource(
														row.source.key,
													);
											}
											if (
												event.key === "ArrowLeft" &&
												expandedSources.has(
													row.source.key,
												)
											) {
												event.preventDefault();
												toggleSource(row.source.key);
											}
										}}
										role="treeitem"
										tabIndex={focusedId === id ? 0 : -1}
										type="button"
									>
										<ChevronRight
											aria-hidden
											className={
												expandedSources.has(
													row.source.key,
												)
													? "rotate-90"
													: ""
											}
											size={13}
										/>
										{row.source.key ===
										NATIVE_SOURCE_CONNECTION_KEY ? (
											<Folder aria-hidden size={14} />
										) : row.source.readOnly ? (
											<Lock aria-hidden size={13} />
										) : (
											<Cloud aria-hidden size={13} />
										)}
										<span className="truncate">
											{row.source.label}
										</span>
									</button>
								) : row.kind === "collection" ? (
									<CollectionRow
										busy={busy}
										depth={searchMode ? 0 : row.depth}
										editable={editableSourceKeys.has(
											row.entry.sourceConnectionKey,
										)}
										entry={row.entry}
										expanded={expandedCollections.has(
											row.entry.key,
										)}
										focused={focusedId === id}
										hierarchyEnabled={!searchMode}
										onCreate={onCreate}
										onDelete={onDelete}
										onEdit={onEdit}
										onFocus={() => registerRowFocus(id)}
										onKeyDown={(event) => {
											if (event.key === "ArrowDown") {
												event.preventDefault();
												focusRelative(id, 1);
											}
											if (event.key === "ArrowUp") {
												event.preventDefault();
												focusRelative(id, -1);
											}
											if (event.key === "Home") {
												event.preventDefault();
												focusBoundary("start");
											}
											if (event.key === "End") {
												event.preventDefault();
												focusBoundary("end");
											}
											if (
												!searchMode &&
												event.key === "ArrowRight" &&
												row.entry.hasChildren
											) {
												event.preventDefault();
												if (
													expandedCollections.has(
														row.entry.key,
													)
												)
													focusCollectionChild(
														row.entry.key,
													);
												else
													toggleCollection(row.entry);
											}
											if (
												!searchMode &&
												event.key === "ArrowLeft"
											) {
												event.preventDefault();
												if (
													expandedCollections.has(
														row.entry.key,
													)
												)
													toggleCollection(row.entry);
												else focusParent(row.entry);
											}
										}}
										onMove={onMove}
										onRestore={onRestore}
										onSelect={onSelect}
										onToggle={toggleCollection}
										path={
											searchMode
												? adminCollectionPath(
														row.entry,
														sources,
													)
												: undefined
										}
										positionInSet={row.positionInSet}
										selected={
											selectedCollection === row.entry.key
										}
										setSize={row.setSize}
										view={view}
									/>
								) : row.kind === "empty" ? (
									<div className="flex h-full items-center px-3 text-[11px] text-black/35 dark:text-white/35">
										{view === "deleted"
											? "No deleted collections"
											: "No collections here"}
									</div>
								) : (
									<button
										aria-disabled={row.kind === "loading"}
										className={`flex h-full w-full items-center gap-2 rounded-lg px-3 text-left text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${row.kind === "loading" ? "cursor-wait text-black/35 dark:text-white/35" : "text-accent-700 hover:bg-accent/[0.08] dark:text-accent-300"}`}
										aria-level={row.depth + 1}
										aria-posinset={row.positionInSet}
										aria-selected={false}
										aria-setsize={row.setSize}
										data-catalogue-status-branch={
											row.branchKey
										}
										id={`admin-catalogue-${id}`}
										onClick={() => {
											if (row.kind !== "loading")
												loadMore(row);
										}}
										onFocus={() => {
											registerRowFocus(id);
											pendingStatusFocus.current = {
												branchKey: row.branchKey,
												intent:
													row.kind === "loadMore"
														? "status"
														: "first",
												parentCollection:
													row.parentCollection,
												sourceConnectionKey:
													row.sourceConnectionKey,
												waiting: row.kind === "loading",
											};
										}}
										onKeyDown={(event) => {
											if (event.key === "ArrowDown") {
												event.preventDefault();
												focusRelative(id, 1);
											}
											if (event.key === "ArrowUp") {
												event.preventDefault();
												focusRelative(id, -1);
											}
											if (event.key === "Home") {
												event.preventDefault();
												focusBoundary("start");
											}
											if (event.key === "End") {
												event.preventDefault();
												focusBoundary("end");
											}
										}}
										role="treeitem"
										tabIndex={focusedId === id ? 0 : -1}
										type="button"
									>
										{row.kind === "loading" ? (
											<>
												<LoaderCircle
													aria-hidden
													className="animate-spin"
													size={13}
												/>
												Loading
											</>
										) : row.kind === "error" ? (
											"Try again"
										) : (
											"Load more"
										)}
									</button>
								)}
							</div>
						);
					})}
				</div>
			</div>
			<RootDropZone
				active={!searchMode && Boolean(activeCollectionKey)}
			/>
		</section>
	);
}
