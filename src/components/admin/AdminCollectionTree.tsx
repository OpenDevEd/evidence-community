"use client";

import { useDraggable, useDroppable } from "@dnd-kit/react";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import {
	ChevronRight,
	Folder,
	FolderOpen,
	FolderInput,
	FolderPlus,
	GripVertical,
	Lock,
	Pencil,
	Settings2,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo } from "react";

import { Dropdown } from "@/components/nextui/Dropdown";
import {
	collectionSubtreeKeys,
	type NativeCollectionDropDestination,
} from "@/lib/admin/collection-tree";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import type { AdminCollection } from "@/lib/admin/types";

import {
	COLLECTION_DRAG_TYPE,
	type CollectionDragData,
	RECORD_DRAG_TYPE,
	useAdminDragState,
} from "./AdminDragDropProvider";

function EdgeDropZone({
	depth,
	destination,
	position,
}: {
	depth: number;
	destination: NativeCollectionDropDestination;
	position: "after" | "before";
}) {
	const { isDropTarget, ref } = useDroppable({
		accept: COLLECTION_DRAG_TYPE,
		data: destination,
		id: `admin-collection-drop:${position}:${destination.targetCollection}`,
		type: `admin-collection-${position}`,
	});

	return (
		<div
			ref={ref}
			aria-hidden
			data-collection-drop={`${position}:${destination.targetCollection}`}
			className={`pointer-events-none absolute inset-x-0 z-20 h-1/4 ${
				position === "before" ? "top-0" : "bottom-0"
			}`}
		>
			{isDropTarget ? (
				<span
					className={`absolute h-0.5 rounded-full bg-accent ${
						position === "before" ? "top-0" : "bottom-0"
					}`}
					style={{ left: 6 + depth * 12, right: 4 }}
				/>
			) : null}
		</div>
	);
}

function RootDropZone({ active }: { active: boolean }) {
	const destination: NativeCollectionDropDestination = {
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
			data-collection-drop="root"
			className={`mx-1 mt-1 flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed text-[11px] transition-colors ${
				isDropTarget
					? "border-accent bg-accent/[0.12] text-accent-700 dark:bg-accent/20 dark:text-accent-300"
					: "border-black/15 text-black/40 dark:border-white/15 dark:text-white/40"
			}`}
		>
			<FolderInput aria-hidden size={13} />
			Move to top level
		</div>
	);
}

function CollectionRow({
	activeCollection,
	collections,
	depth,
	entry,
	expanded,
	invalidTargets,
	movesEnabled,
	recordDropsEnabled,
	onCreate,
	onDelete,
	onEdit,
	onExpand,
	onMove,
	onSelect,
	onToggle,
	selectedCollection,
}: {
	activeCollection: string | null;
	collections: AdminCollection[];
	depth: number;
	entry: AdminCollection;
	expanded: Set<string>;
	invalidTargets: ReadonlySet<string>;
	movesEnabled: boolean;
	recordDropsEnabled: boolean;
	onCreate: (parentCollection: string | null) => void;
	onDelete: (collection: AdminCollection) => void;
	onEdit: (collection: AdminCollection) => void;
	onExpand: (key: string) => void;
	onMove: (collection: AdminCollection) => void;
	onSelect: (key: string) => void;
	onToggle: (key: string) => void;
	selectedCollection: string | null;
}) {
	const editable = entry.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY;
	const hasChildren = collections.some(
		(candidate) =>
			!candidate.deleted && candidate.parentCollection === entry.key,
	);
	const isExpanded = expanded.has(entry.key);
	const { activeRecordCount } = useAdminDragState();
	const acceptsCollectionDrop =
		movesEnabled &&
		Boolean(activeCollection) &&
		editable &&
		!invalidTargets.has(entry.key);
	const acceptsRecordDrop =
		recordDropsEnabled && activeRecordCount > 0 && editable;
	const acceptsInsideDrop = acceptsCollectionDrop || acceptsRecordDrop;
	const { handleRef, isDragging, ref } = useDraggable<CollectionDragData>({
		data: {
			collectionKey: entry.key,
			kind: "collection",
			name: entry.name,
		},
		disabled: !movesEnabled || !editable,
		id: `admin-collection:${entry.key}`,
		type: COLLECTION_DRAG_TYPE,
	});
	const insideDestination: NativeCollectionDropDestination = {
		position: "inside",
		targetCollection: entry.key,
	};
	const { isDropTarget: isInsideDropTarget, ref: insideDropRef } =
		useDroppable({
			accept: [COLLECTION_DRAG_TYPE, RECORD_DRAG_TYPE],
			data: insideDestination,
			disabled: !acceptsInsideDrop,
			id: `admin-collection-expand:${entry.key}`,
			type: "admin-collection-inside-expansion",
		});

	useEffect(() => {
		if (!hasChildren || !isInsideDropTarget || isExpanded) return;
		const timeout = window.setTimeout(() => onExpand(entry.key), 650);
		return () => window.clearTimeout(timeout);
	}, [entry.key, hasChildren, isExpanded, isInsideDropTarget, onExpand]);

	return (
		<div>
			<div
				ref={ref}
				data-collection-key={entry.key}
				className={`group relative flex min-h-9 items-center rounded-lg pr-1 text-[13px] transition-[background-color,color,opacity] ${
					isDragging ? "opacity-35" : ""
				} ${
					selectedCollection === entry.key
						? "bg-accent/[0.12] font-medium text-black dark:bg-accent/20 dark:text-white"
						: "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.04]"
				}`}
				style={{ paddingLeft: 6 + depth * 12 }}
			>
				{acceptsCollectionDrop ? (
					<>
						<EdgeDropZone
							depth={depth}
							destination={{
								position: "before",
								targetCollection: entry.key,
							}}
							position="before"
						/>
						<div
							ref={insideDropRef}
							aria-hidden
							data-collection-drop={`inside:${entry.key}`}
							className={`pointer-events-none absolute inset-x-0 top-1/4 z-10 h-1/2 rounded-md transition-colors ${
								isInsideDropTarget
									? "bg-accent/15 ring-1 ring-inset ring-accent/55 dark:bg-accent/25"
									: ""
							}`}
						/>
						<EdgeDropZone
							depth={depth}
							destination={{
								position: "after",
								targetCollection: entry.key,
							}}
							position="after"
						/>
					</>
				) : null}
				{acceptsRecordDrop ? (
					<div
						ref={insideDropRef}
						aria-hidden
						data-record-collection-drop={entry.key}
						className={`pointer-events-none absolute inset-0 z-10 rounded-lg transition-colors ${
							isInsideDropTarget
								? "bg-accent/15 ring-1 ring-inset ring-accent/55 dark:bg-accent/25"
								: ""
						}`}
					/>
				) : null}
				{hasChildren ? (
					<button
						aria-controls={`admin-collection-children-${entry.key}`}
						aria-expanded={isExpanded}
						aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.name}`}
						className="relative z-30 grid size-6 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.05] hover:text-black/70 dark:text-white/35 dark:hover:bg-white/[0.06] dark:hover:text-white/70"
						onClick={() => onToggle(entry.key)}
						type="button"
					>
						<ChevronRight
							aria-hidden
							className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
							size={13}
						/>
					</button>
				) : editable ? (
					<button
						ref={handleRef}
						aria-disabled={!movesEnabled}
						aria-label={`Drag ${entry.name}`}
						className={`relative z-30 grid size-6 shrink-0 touch-none place-items-center rounded-md text-black/35 opacity-0 transition-[background-color,color,opacity] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus group-focus-within:opacity-100 group-hover:opacity-100 dark:text-white/35 ${
							movesEnabled
								? "cursor-grab hover:bg-black/[0.05] hover:text-black/75 active:cursor-grabbing dark:hover:bg-white/[0.06] dark:hover:text-white/75"
								: "cursor-wait opacity-25"
						}`}
						data-collection-drag-handle={entry.key}
						title={`Drag ${entry.name}`}
						type="button"
					>
						<GripVertical aria-hidden size={13} />
					</button>
				) : (
					<span className="size-6 shrink-0" />
				)}
				<button
					aria-pressed={selectedCollection === entry.key}
					className={`relative z-30 flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left transition-[padding] ${
						editable
							? hasChildren
								? "group-focus-within:pr-14 group-hover:pr-14"
								: "group-focus-within:pr-7 group-hover:pr-7"
							: ""
					}`}
					onClick={() => onSelect(entry.key)}
					type="button"
				>
					{selectedCollection === entry.key || isExpanded ? (
						<FolderOpen
							aria-hidden
							className={`shrink-0 ${
								selectedCollection === entry.key
									? "text-accent-700 dark:text-accent-300"
									: "opacity-55"
							}`}
							size={14}
							strokeWidth={1.8}
						/>
					) : (
						<Folder
							aria-hidden
							className="shrink-0 opacity-55"
							size={14}
							strokeWidth={1.8}
						/>
					)}
					<span className="truncate">{entry.name}</span>
					{!editable ? (
						<Lock
							aria-label="Read only"
							className="ml-auto shrink-0 opacity-35"
							size={11}
						/>
					) : null}
				</button>
				{editable ? (
					<div className="pointer-events-none absolute right-1 z-30 flex items-center opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
						{hasChildren ? (
							<button
								ref={handleRef}
								aria-disabled={!movesEnabled}
								aria-label={`Drag ${entry.name}`}
								className={`grid size-7 shrink-0 touch-none place-items-center rounded-md text-black/35 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 ${
									movesEnabled
										? "cursor-grab hover:bg-black/[0.05] hover:text-black/75 active:cursor-grabbing dark:hover:bg-white/[0.06] dark:hover:text-white/75"
										: "cursor-wait opacity-25"
								}`}
								data-collection-drag-handle={entry.key}
								title={`Drag ${entry.name}`}
								type="button"
							>
								<GripVertical aria-hidden size={14} />
							</button>
						) : null}
						<Dropdown placement="bottom-end">
							<DropdownTrigger>
								<button
									aria-label={`Manage ${entry.name}`}
									className="grid size-7 shrink-0 place-items-center rounded-md text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/40 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
									type="button"
								>
									<Settings2 aria-hidden size={14} />
								</button>
							</DropdownTrigger>
							<DropdownMenu
								aria-label={`Actions for ${entry.name}`}
								onAction={(key) => {
									if (key === "create") onCreate(entry.key);
									if (key === "rename") onEdit(entry);
									if (key === "move") onMove(entry);
									if (key === "delete") onDelete(entry);
								}}
							>
								<DropdownItem
									key="create"
									startContent={
										<FolderPlus aria-hidden size={14} />
									}
								>
									New inside
								</DropdownItem>
								<DropdownItem
									key="rename"
									startContent={
										<Pencil aria-hidden size={14} />
									}
								>
									Rename
								</DropdownItem>
								<DropdownItem
									key="move"
									startContent={
										<FolderInput aria-hidden size={14} />
									}
								>
									Move
								</DropdownItem>
								<DropdownItem
									key="delete"
									color="danger"
									startContent={
										<Trash2 aria-hidden size={14} />
									}
								>
									Delete
								</DropdownItem>
							</DropdownMenu>
						</Dropdown>
					</div>
				) : null}
			</div>
			{hasChildren && isExpanded ? (
				<div id={`admin-collection-children-${entry.key}`}>
					<CollectionRows
						activeCollection={activeCollection}
						collections={collections}
						depth={depth + 1}
						expanded={expanded}
						invalidTargets={invalidTargets}
						movesEnabled={movesEnabled}
						recordDropsEnabled={recordDropsEnabled}
						onCreate={onCreate}
						onDelete={onDelete}
						onEdit={onEdit}
						onExpand={onExpand}
						onMove={onMove}
						onSelect={onSelect}
						onToggle={onToggle}
						parentCollection={entry.key}
						selectedCollection={selectedCollection}
					/>
				</div>
			) : null}
		</div>
	);
}

function CollectionRows({
	activeCollection,
	collections,
	depth = 0,
	expanded,
	invalidTargets,
	movesEnabled,
	recordDropsEnabled,
	onCreate,
	onDelete,
	onEdit,
	onExpand,
	onMove,
	onSelect,
	onToggle,
	parentCollection = null,
	selectedCollection,
}: {
	activeCollection: string | null;
	collections: AdminCollection[];
	depth?: number;
	expanded: Set<string>;
	invalidTargets: ReadonlySet<string>;
	movesEnabled: boolean;
	recordDropsEnabled: boolean;
	onCreate: (parentCollection: string | null) => void;
	onDelete: (collection: AdminCollection) => void;
	onEdit: (collection: AdminCollection) => void;
	onExpand: (key: string) => void;
	onMove: (collection: AdminCollection) => void;
	onSelect: (key: string) => void;
	onToggle: (key: string) => void;
	parentCollection?: string | null;
	selectedCollection: string | null;
}) {
	return collections
		.filter(
			(entry) =>
				!entry.deleted && entry.parentCollection === parentCollection,
		)
		.map((entry) => (
			<CollectionRow
				key={entry.key}
				activeCollection={activeCollection}
				collections={collections}
				depth={depth}
				entry={entry}
				expanded={expanded}
				invalidTargets={invalidTargets}
				movesEnabled={movesEnabled}
				recordDropsEnabled={recordDropsEnabled}
				onCreate={onCreate}
				onDelete={onDelete}
				onEdit={onEdit}
				onExpand={onExpand}
				onMove={onMove}
				onSelect={onSelect}
				onToggle={onToggle}
				selectedCollection={selectedCollection}
			/>
		));
}

export function AdminCollectionTree({
	collections,
	expanded,
	movesEnabled,
	onCreate,
	onDelete,
	recordDropsEnabled,
	onEdit,
	onExpand,
	onMove,
	onSelect,
	onToggle,
	showRootDropZone = false,
	selectedCollection,
}: {
	collections: AdminCollection[];
	expanded: Set<string>;
	movesEnabled: boolean;
	recordDropsEnabled: boolean;
	onCreate: (parentCollection: string | null) => void;
	onDelete: (collection: AdminCollection) => void;
	onEdit: (collection: AdminCollection) => void;
	onExpand: (key: string) => void;
	onMove: (collection: AdminCollection) => void;
	onSelect: (key: string) => void;
	onToggle: (key: string) => void;
	showRootDropZone?: boolean;
	selectedCollection: string | null;
}) {
	const { activeCollectionKey: activeCollection } = useAdminDragState();
	const invalidTargets = useMemo(
		() =>
			activeCollection
				? collectionSubtreeKeys(collections, activeCollection)
				: new Set<string>(),
		[activeCollection, collections],
	);
	return (
		<div>
			<CollectionRows
				activeCollection={activeCollection}
				collections={collections}
				expanded={expanded}
				invalidTargets={invalidTargets}
				movesEnabled={movesEnabled}
				recordDropsEnabled={recordDropsEnabled}
				onCreate={onCreate}
				onDelete={onDelete}
				onEdit={onEdit}
				onExpand={onExpand}
				onMove={onMove}
				onSelect={onSelect}
				onToggle={onToggle}
				selectedCollection={selectedCollection}
			/>
			{showRootDropZone ? (
				<RootDropZone active={Boolean(activeCollection)} />
			) : null}
		</div>
	);
}
