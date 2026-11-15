"use client";

import { useAdminSession } from "./AdminSessionProvider";
import { Tooltip } from "@/components/nextui/Tooltip";
import useSWR from "swr";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CheckmarkCircle01Icon, CloudUploadIcon, DatabaseIcon, Delete02Icon, FileClockIcon, FileImportIcon, FilePlusIcon, InboxIcon, ListIcon, Folder01Icon, FolderAddIcon, LibraryIcon, News01Icon, SquareLock01Icon, PauseIcon, PencilIcon } from "@hugeicons/core-free-icons";
import { getAdminReviewCount } from "./admin-api";
import { DigestsPage, type DigestShow } from "./admin-digests-page";

import { AdminSourceStatusBadge } from "./AdminSourceStatus";
import { type ReactNode, useContext, useState } from "react";

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

const kindOptions = [
	{ icon: LibraryIcon, key: "all", label: "All" },
	{ icon: FilePlusIcon, key: "created", label: "Created" },
	{ icon: FileImportIcon, key: "imported", label: "Imported" },
] as const;

const stateOptions: Array<{
	icon: typeof CheckmarkCircle01Icon;
	key: AdminRecordState | "all";
	label: string;
}> = [
	{ icon: LibraryIcon, key: "all", label: "All records" },
	{ icon: FileClockIcon, key: "draft", label: "Drafts" },
	{ icon: PencilIcon, key: "edited", label: "Edited" },
	{ icon: CheckmarkCircle01Icon, key: "published", label: "Published" },
	{ icon: Delete02Icon, key: "deleted", label: "Deleted" },
];

const digestStateOptions: Array<{ icon: typeof CheckmarkCircle01Icon; key: DigestShow; label: string }> = [
	{ icon: News01Icon, key: "all", label: "All digests" },
	{ icon: FileClockIcon, key: "draft", label: "Drafts" },
	{ icon: InboxIcon, key: "review", label: "In review" },
	{ icon: CheckmarkCircle01Icon, key: "published", label: "Published" },
];

const pressedItemClass = "bg-accent/[0.12] font-medium text-black dark:bg-accent/20 dark:text-white";
const idleItemClass = "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.04]";

/** One choice in a navigation list. `count` is how many wait there for an Editor or Owner. */
function NavigationItem({ icon, label, count, pressed, onPress }: { icon: typeof Folder01Icon; label: string; count?: number; pressed: boolean; onPress: () => void }) {
	return (
		<button type="button" aria-pressed={pressed} className={`${navigationItemClass} ${pressed ? pressedItemClass : idleItemClass}`} onClick={onPress}>
			<HugeiconsIcon icon={icon} aria-hidden size={14} />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{count !== undefined && (
				<span className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[10px] font-semibold tabular-nums ${count ? "bg-accent/15 text-accent-300 dark:text-accent-700" : "bg-black/5 text-black/40 dark:text-white/40"}`}>
					{count}
				</span>
			)}
		</button>
	);
}

/** Which of the page's records or digests are listed, by where they stand. The choices follow the page on show. */
function StateList<Key extends string>({ title, options, selected, onSelect }: { title: string; options: Array<{ icon: typeof Folder01Icon; key: Key; label: string }>; selected: Key | null; onSelect: (key: Key) => void }) {
	return (
		<>
			<NavigationHeading icon={CheckmarkCircle01Icon} title={title} />
			<div className={navigationListSurfaceClass}>
				{options.map((entry) => <NavigationItem key={entry.key} icon={entry.icon} label={entry.label} pressed={selected === entry.key} onPress={() => onSelect(entry.key)} />)}
			</div>
		</>
	);
}

function NavigationHeading({
	action,
	icon: Icon,
	title,
}: {
	action?: ReactNode;
	icon: typeof Folder01Icon;
	title: string;
}) {
	return (
		<div className="flex min-h-8 items-center gap-2 px-4 pb-2 pt-3 first:pt-2">
			<HugeiconsIcon
				icon={Icon}
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

function NewCollectionButton({ onCreate }: { onCreate: () => void }) {
	const { canPublish } = useAdminSession();
	return (
		<Tooltip isDisabled={canPublish} content="Editors and owners manage collections">
			<span className="inline-flex">
				<button
					disabled={!canPublish}
					className="disabled:pointer-events-none disabled:opacity-50 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-black/50 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
					onClick={onCreate}
					type="button"
				>
					<HugeiconsIcon icon={FolderAddIcon} aria-hidden size={13} />
					New
				</button>
			</span>
		</Tooltip>
	);
}

/** The library's sources: one narrows the records to those it brought in, and its badge opens what its sync is doing. */
function SourceList({ source, sources, onSelectSource, onOpenSourceSync }: { source: string | null; sources: AdminSource[]; onSelectSource: (key: string) => void; onOpenSourceSync: (key: string) => void }) {
	return (
		<>
		<NavigationHeading icon={DatabaseIcon} title="Sources" />
		<div className={navigationListSurfaceClass}>
			{sources.map((entry) => {
				return (
					<div className="flex items-center" key={entry.key}>
					<button
						aria-pressed={source === entry.key}
						className={`${navigationItemClass} min-w-0 flex-1 ${
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
						<span className="grid size-3.5 shrink-0 place-items-center">
							<SourceProviderIcon
								provider={entry.provider}
								size={14}
							/>
						</span>
						<span className="min-w-0 flex-1 truncate">
							{entry.label}
						</span>
						{entry.status === "paused" ? (
							<HugeiconsIcon icon={PauseIcon} aria-label="Paused" size={11} />
						) : entry.writeback?.enabled &&
						  entry.writeback.supported ? (
							<HugeiconsIcon icon={CloudUploadIcon} aria-label="Writeback enabled" size={11} />
						) : entry.readOnly ? (
							<HugeiconsIcon icon={SquareLock01Icon} aria-label="Writeback unavailable" size={11} />
						) : null}
					</button>
					{entry.activity ? (
						<AdminSourceStatusBadge
							activity={entry.activity}
							label={entry.label}
							onClick={() => onOpenSourceSync(entry.key)}
						/>
					) : null}
					</div>
				);
			})}
		</div>
		</>
	);
}

/**
 * What the admin shows: records of a kind, the records awaiting review, or the digests. The queue and the digests carry
 * how many wait for an Editor or Owner.
 */
function KindList({ kind, reviewQueue, onSelectKind, onSelectReviewQueue }: { kind: string | null; reviewQueue: boolean; onSelectKind: (kind: "all" | "created" | "imported") => void; onSelectReviewQueue: () => void }) {
	const digests = useContext(DigestsPage);
	const { canPublish } = useAdminSession();
	const { data: awaitingReview = 0 } = useSWR(canPublish ? "admin-review-count" : null, getAdminReviewCount);
	const onDigests = digests?.selected ?? false;
	return (
		<div className="shrink-0">
			<NavigationHeading icon={ListIcon} title="Kind" />
			<div className={navigationListSurfaceClass}>
				{kindOptions.map(({ key, label, icon }) => <NavigationItem key={key} icon={icon} label={label} pressed={!onDigests && kind === key} onPress={() => onSelectKind(key)} />)}
				{/* Only an Editor or Owner can act on the queue; a Creator sees "Awaiting review" on each record they sent instead. */}
				{canPublish && <NavigationItem icon={InboxIcon} label="Review queue" count={awaitingReview} pressed={!onDigests && reviewQueue} onPress={onSelectReviewQueue} />}
				{digests && <NavigationItem icon={News01Icon} label="Digests" count={digests.waiting} pressed={onDigests} onPress={digests.onOpen} />}
			</div>
		</div>
	);
}

/**
 * The lists under Kind follow the page it chose. Digests have states of their own and no sources or collections, so
 * while they are the page their state list stands in for the records' lists.
 */
function PageLists({ children }: { children: ReactNode }) {
	const digests = useContext(DigestsPage);
	if (!digests?.selected) return children;
	return (
		<div className="shrink-0">
			<StateList title="Digest state" options={digestStateOptions} selected={digests.show} onSelect={digests.onShow} />
		</div>
	);
}

export function AdminNavigation({
	kind,
	onSelectKind,
	reviewQueue,
	onSelectReviewQueue,
	collection,
	onCreateCollection,
	onDeleteCollection,
	onEditCollection,
	isBusy,
	onMoveCollection,
	onOpenSourceSync,
	onRestoreCollection,
	onSelectCollection,
	onSelectSource,
	onSelectState,
	source,
	sources,
	state,
}: {
	reviewQueue: boolean;
	onSelectReviewQueue: () => void;
	kind: string | null;
	onSelectKind: (kind: "all" | "created" | "imported") => void;
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
	onOpenSourceSync: (key: string) => void;
	onSelectSource: (key: string) => void;
	onSelectState: (state: AdminRecordState | "all") => void;
	source: string | null;
	sources: AdminSource[];
	state: AdminRecordState | "all" | null;
}) {
	// State, not a ref: the catalogue measures against the sidebar before the first paint, and a ref is attached after the catalogue's own layout effects run.
	const [navigation, setNavigation] = useState<HTMLElement | null>(null);

	return (
		<nav
			ref={setNavigation}
			aria-label="Admin filters and collections"
			className="flex h-full min-h-0 flex-col overflow-y-auto"
		>
			<KindList kind={kind} reviewQueue={reviewQueue} onSelectKind={onSelectKind} onSelectReviewQueue={onSelectReviewQueue} />
			<PageLists>
			<div className="shrink-0">
				<SourceList source={source} sources={sources} onSelectSource={onSelectSource} onOpenSourceSync={onOpenSourceSync} />
				<StateList title="Record state" options={stateOptions} selected={state} onSelect={onSelectState} />
			</div>

			<NavigationHeading
				action={
					<NewCollectionButton onCreate={() => onCreateCollection(null)} />
				}
				icon={Folder01Icon}
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
					scrollElement={navigation}
					sources={sources}
				/>
			</div>
			</PageLists>
		</nav>
	);
}
