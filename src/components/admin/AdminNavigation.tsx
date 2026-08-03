"use client";

import {
	Archive,
	CircleCheck,
	Cloud,
	Database,
	FileClock,
	Folder,
	FolderOpen,
	FolderPlus,
	Library,
	Lock,
	Pause,
	Pencil,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { Tooltip } from "@/components/nextui/Tooltip";
import { addCollectionToSavedExpansion } from "@/lib/admin/collection-tree";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import type {
	AdminCollection,
	AdminRecordState,
	AdminSource,
} from "@/lib/admin/types";

import { AdminCollectionTree } from "./AdminCollectionTree";

const COLLECTION_EXPANSION_KEY = "admin.collection-tree.expanded";
const COLLECTION_EXPANSION_EVENT = "admin-collection-expansion";

function subscribeToCollectionExpansion(callback: () => void) {
	window.addEventListener("storage", callback);
	window.addEventListener(COLLECTION_EXPANSION_EVENT, callback);
	return () => {
		window.removeEventListener("storage", callback);
		window.removeEventListener(COLLECTION_EXPANSION_EVENT, callback);
	};
}

function collectionExpansionSnapshot() {
	try {
		return window.localStorage.getItem(COLLECTION_EXPANSION_KEY) ?? "";
	} catch {
		return "";
	}
}

function serverCollectionExpansionSnapshot() {
	return "";
}

function saveCollectionExpansion(value: string) {
	try {
		window.localStorage.setItem(COLLECTION_EXPANSION_KEY, value);
		window.dispatchEvent(new Event(COLLECTION_EXPANSION_EVENT));
	} catch {
		// Collection expansion is an optional convenience. Storage failures
		// must not prevent navigation or collection editing.
	}
}

export function expandAdminCollections(collectionKeys: string[]) {
	const next = addCollectionToSavedExpansion(
		collectionExpansionSnapshot(),
		collectionKeys,
	);
	if (!next) return;
	saveCollectionExpansion(next);
}

function IconAction({
	icon: Icon,
	label,
	onPress,
}: {
	icon: typeof Plus;
	label: string;
	onPress: () => void;
}) {
	return (
		<Tooltip content={label} delay={500}>
			<button
				aria-label={label}
				className="grid size-7 shrink-0 place-items-center rounded-md text-black/45 transition-colors hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
				onClick={onPress}
				type="button"
			>
				<Icon aria-hidden size={14} />
			</button>
		</Tooltip>
	);
}

const stateOptions: Array<{
	icon: typeof CircleCheck;
	key: AdminRecordState | "all";
	label: string;
}> = [
	{ icon: Library, key: "all", label: "All records" },
	{ icon: FileClock, key: "draft", label: "Drafts" },
	{ icon: Pencil, key: "edited", label: "Edited" },
	{ icon: CircleCheck, key: "published", label: "Published" },
	{ icon: Trash2, key: "deleted", label: "Deleted" },
];

function NavigationHeading({
	action,
	icon: Icon,
	title,
}: {
	action?: React.ReactNode;
	icon: typeof Plus;
	title: string;
}) {
	return (
		<div className="flex min-h-8 items-center gap-2 px-2 pt-3 first:pt-2">
			<Icon
				aria-hidden
				className="text-black/30 dark:text-white/30"
				size={13}
				strokeWidth={1.8}
			/>
			<span className="min-w-0 flex-1 text-[11px] font-semibold text-black/45 dark:text-white/45">
				{title}
			</span>
			{action}
		</div>
	);
}

const navigationItemClass =
	"flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors";

export function AdminNavigation({
	collection,
	collections,
	onCreateCollection,
	onDeleteCollection,
	onEditCollection,
	isBusy,
	onMoveCollection,
	onRestoreCollection,
	onSelectCollection,
	onSelectSource,
	onSelectState,
	source,
	sources,
	state,
}: {
	collection: string;
	collections: AdminCollection[];
	onCreateCollection: (parentCollection: string | null) => void;
	onDeleteCollection: (collection: AdminCollection) => void;
	onEditCollection: (collection: AdminCollection) => void;
	isBusy: boolean;
	onMoveCollection: (collection: AdminCollection) => void;
	onRestoreCollection: (collection: AdminCollection) => void;
	onSelectCollection: (key: string) => void;
	onSelectSource: (key: string) => void;
	onSelectState: (state: AdminRecordState | "all") => void;
	source: string;
	sources: AdminSource[];
	state: AdminRecordState | "all";
}) {
	const activeCollections = useMemo(
		() => collections.filter((entry) => !entry.deleted),
		[collections],
	);
	const deletedCollections = useMemo(
		() =>
			collections.filter(
				(entry) =>
					entry.deleted &&
					entry.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY,
			),
		[collections],
	);
	const expandableKeys = useMemo(
		() =>
			new Set(
				activeCollections
					.filter((entry) =>
						activeCollections.some(
							(candidate) =>
								candidate.parentCollection === entry.key,
						),
					)
					.map(({ key }) => key),
			),
		[activeCollections],
	);
	const savedExpansion = useSyncExternalStore(
		subscribeToCollectionExpansion,
		collectionExpansionSnapshot,
		serverCollectionExpansionSnapshot,
	);
	const expanded = useMemo(() => {
		if (!savedExpansion) return expandableKeys;
		try {
			return new Set(
				(JSON.parse(savedExpansion) as string[]).filter((key) =>
					activeCollections.some(
						(collection) => collection.key === key,
					),
				),
			);
		} catch {
			return expandableKeys;
		}
	}, [activeCollections, expandableKeys, savedExpansion]);

	const toggleCollection = useCallback(
		(key: string) => {
			const next = new Set(expanded);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			saveCollectionExpansion(JSON.stringify([...next]));
		},
		[expanded],
	);
	const expandCollection = useCallback(
		(key: string) => {
			if (expanded.has(key)) return;
			expandAdminCollections([key]);
		},
		[expanded],
	);
	const nativeCollections = useMemo(
		() =>
			activeCollections.filter(
				(entry) =>
					entry.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY,
			),
		[activeCollections],
	);
	const importedCollectionGroups = useMemo(
		() =>
			sources
				.filter(({ key }) => key !== NATIVE_SOURCE_CONNECTION_KEY)
				.map((source) => ({
					collections: activeCollections.filter(
						(entry) => entry.sourceConnectionKey === source.key,
					),
					source,
				}))
				.filter(({ collections }) => collections.length > 0),
		[activeCollections, sources],
	);

	return (
		<nav
			aria-label="Admin filters and collections"
			className="flex h-full min-h-0 flex-col overflow-y-auto px-2 pb-4"
		>
			<NavigationHeading icon={Database} title="Sources" />
			{sources.map((entry) => {
				const Icon =
					entry.provider === NATIVE_SOURCE_CONNECTION_KEY
						? Database
						: Cloud;
				return (
					<button
						key={entry.key}
						aria-pressed={source === entry.key}
						className={`${navigationItemClass} ${
							source === entry.key
									? "bg-accent/[0.12] font-medium text-black dark:bg-accent/20 dark:text-white"
								: "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.04]"
						}`}
						onClick={() =>
							onSelectSource(
								source === entry.key ? "all" : entry.key,
							)
						}
						type="button"
					>
						<Icon aria-hidden size={14} />
						<span className="min-w-0 flex-1 truncate">
							{entry.label}
						</span>
						{entry.status === "paused" ? (
							<Pause aria-label="Paused" size={11} />
						) : entry.readOnly ? (
							<Lock aria-label="Read only" size={11} />
						) : null}
					</button>
				);
			})}

			<NavigationHeading icon={CircleCheck} title="Record state" />
			{stateOptions.map((entry) => {
				const Icon = entry.icon;
				return (
					<button
						key={entry.key}
						aria-pressed={state === entry.key}
						className={`${navigationItemClass} ${
							state === entry.key
									? "bg-accent/[0.12] font-medium text-black dark:bg-accent/20 dark:text-white"
								: "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.04]"
						}`}
						onClick={() => onSelectState(entry.key)}
						type="button"
					>
						<Icon aria-hidden size={14} />
						{entry.label}
					</button>
				);
			})}

			<NavigationHeading
				action={
					<button
						className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-black/50 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
						onClick={() => onCreateCollection(null)}
						type="button"
					>
						<FolderPlus aria-hidden size={13} />
						New
					</button>
				}
				icon={Folder}
				title="Collections"
			/>
			<button
				aria-pressed={collection === "all"}
				className={`${navigationItemClass} ${
					collection === "all"
							? "bg-accent/[0.12] font-medium text-black dark:bg-accent/20 dark:text-white"
						: "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.04]"
				}`}
				onClick={() => onSelectCollection("all")}
				type="button"
			>
				<FolderOpen aria-hidden size={14} />
				All collections
			</button>
			{nativeCollections.length ? (
				<div className="px-2 pb-1 pt-2 text-[11px] font-medium text-black/35 dark:text-white/35">
					Library collections
				</div>
			) : null}
			<AdminCollectionTree
				collections={nativeCollections}
				expanded={expanded}
				movesEnabled={!isBusy}
				recordDropsEnabled={!isBusy}
				onCreate={onCreateCollection}
				onDelete={onDeleteCollection}
				onEdit={onEditCollection}
				onExpand={expandCollection}
				onMove={onMoveCollection}
				onSelect={onSelectCollection}
				onToggle={toggleCollection}
				showRootDropZone
				selectedCollection={collection}
			/>
			{importedCollectionGroups.map(({ collections, source }) => (
				<div key={source.key}>
					<div className="flex items-center gap-1.5 px-2 pb-1 pt-3 text-[11px] font-medium text-black/35 dark:text-white/35">
						<Lock aria-hidden size={10} />
						<span className="truncate">{source.label}</span>
					</div>
					<AdminCollectionTree
						collections={collections}
						expanded={expanded}
						movesEnabled={false}
						recordDropsEnabled={false}
						onCreate={onCreateCollection}
						onDelete={onDeleteCollection}
						onEdit={onEditCollection}
						onExpand={expandCollection}
						onMove={onMoveCollection}
						onSelect={onSelectCollection}
						onToggle={toggleCollection}
						selectedCollection={collection}
					/>
				</div>
			))}

			{deletedCollections.length ? (
				<>
					<NavigationHeading
						icon={Archive}
						title="Deleted collections"
					/>
					{deletedCollections.map((entry) => (
						<div
							key={entry.key}
							className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-black/45 dark:text-white/45"
						>
							<Archive aria-hidden size={14} />
							<span className="min-w-0 flex-1 truncate">
								{entry.name}
							</span>
							<IconAction
								icon={RotateCcw}
								label={`Restore ${entry.name}`}
								onPress={() => onRestoreCollection(entry)}
							/>
						</div>
					))}
				</>
			) : null}
		</nav>
	);
}
