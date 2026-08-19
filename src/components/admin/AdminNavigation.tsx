"use client";

import {
	CircleCheck,
	CloudUpload,
	Database,
	FileClock,
	Folder,
	FolderPlus,
	Library,
	Lock,
	Pause,
	Pencil,
	Trash2,
} from "lucide-react";
import { type ReactNode, useRef } from "react";

import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

import { SourceProviderIcon } from "./SourceProviderIcon";
import type {
	AdminCollectionCatalogEntry,
	AdminRecordState,
	AdminSource,
} from "@/lib/admin/types";

import { AdminCollectionCatalogue } from "./AdminCollectionCatalogue";
import {
	type AdminCollectionFocusRequest,
	requestAdminCollectionCatalogueInvalidation,
	requestAdminCollectionExpansion,
	requestAdminCollectionFocus,
} from "./admin-collection-events";

export function expandAdminCollections(collectionKeys: string[]) {
	requestAdminCollectionExpansion(collectionKeys);
}

export function invalidateAdminCollectionCatalogue() {
	requestAdminCollectionCatalogueInvalidation();
}

export function focusAdminCollection(request: AdminCollectionFocusRequest) {
	requestAdminCollectionFocus(request);
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
	action?: ReactNode;
	icon: typeof Folder;
	title: string;
}) {
	return (
		<div className="flex min-h-8 items-center gap-2 px-4 pb-2 pt-3 first:pt-2">
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
const navigationListSurfaceClass =
	"bg-black/[0.035] px-2 py-2 dark:bg-black/20";

export function AdminNavigation({
	collection,
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
	collection: string | null;
	onCreateCollection: (
		parentCollection: AdminCollectionCatalogEntry | null,
	) => void;
	onDeleteCollection: (collection: AdminCollectionCatalogEntry) => void;
	onEditCollection: (collection: AdminCollectionCatalogEntry) => void;
	isBusy: boolean;
	onMoveCollection: (collection: AdminCollectionCatalogEntry) => void;
	onRestoreCollection: (collection: AdminCollectionCatalogEntry) => void;
	onSelectCollection: (key: string | null) => void;
	onSelectSource: (key: string) => void;
	onSelectState: (state: AdminRecordState | "all") => void;
	source: string | null;
	sources: AdminSource[];
	state: AdminRecordState | "all" | null;
}) {
	const navigationRef = useRef<HTMLElement>(null);

	return (
		<nav
			ref={navigationRef}
			aria-label="Admin filters and collections"
			className="flex h-full min-h-0 flex-col overflow-y-auto"
		>
			<div className="shrink-0">
				<NavigationHeading icon={Database} title="Sources" />
				<div className={navigationListSurfaceClass}>
					{sources.map((entry) => {
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
								<span className="grid size-[14px] shrink-0 place-items-center">
									<SourceProviderIcon
										provider={entry.provider}
										size={14}
									/>
								</span>
								<span className="min-w-0 flex-1 truncate">
									{entry.label}
								</span>
								{entry.status === "paused" ? (
									<Pause aria-label="Paused" size={11} />
								) : entry.writeback?.enabled &&
								  entry.writeback.supported ? (
									<CloudUpload
										aria-label="Writeback enabled"
										size={11}
									/>
								) : entry.readOnly ? (
									<Lock
										aria-label="Writeback unavailable"
										size={11}
									/>
								) : null}
							</button>
						);
					})}
				</div>

				<NavigationHeading icon={CircleCheck} title="Record state" />
				<div className={navigationListSurfaceClass}>
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
				</div>
			</div>

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
			<div
				className={`${navigationListSurfaceClass} flex grow shrink-0 flex-col px-0`}
			>
				<AdminCollectionCatalogue
					busy={isBusy}
					onCreate={onCreateCollection}
					onDelete={onDeleteCollection}
					onEdit={onEditCollection}
					onMove={onMoveCollection}
					onRestore={onRestoreCollection}
					onSelect={(key) =>
						onSelectCollection(collection === key ? null : key)
					}
					selectedCollection={collection}
					scrollElementRef={navigationRef}
					sources={sources}
				/>
			</div>
		</nav>
	);
}
