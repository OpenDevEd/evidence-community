"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { SortHeader } from "./AdminSortHeader";
import { ordinaryItemTags } from "@/lib/item-display";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { useAuthorProfiles } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { editableCollectionSourceKeys } from "@/lib/admin/item-collection-policy";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, ArrowDown01Icon, ArrowUp01Icon, ArrowUpDownIcon, Calendar01Icon, DatabaseIcon, DragDropVerticalIcon, FileAttachmentIcon, Folder01Icon, LayoutThreeColumnIcon, LayoutThreeRowIcon, SquareLock01Icon, Undo02Icon, Tag01Icon, Tick01Icon, UserCircleIcon } from "@hugeicons/core-free-icons";
import { useDraggable } from "@dnd-kit/react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nextui-org/react";
import { Spinner } from "@/components/nextui/Spinner";
import {
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
	type VisibilityState,
} from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	useEffect,
	useCallback,
	forwardRef,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type ComponentPropsWithoutRef,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type SetStateAction,
} from "react";
import { twMerge } from "@/lib/tw-merge";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { Tooltip } from "@/components/nextui/Tooltip";
import {
	getAdminItemListColumn,
	type AdminItemColumnId,
	type AdminItemSortColumnId,
} from "@/lib/admin/item-list-contract";
import {
	ADMIN_ITEM_TABLE_DENSITIES,
	ADMIN_ITEM_TABLE_COLUMN_SIZES,
	ADMIN_ITEM_TABLE_MAX_COLUMN_SIZE,
	adminItemTableRowHeight,
	moveAdminItemTableColumn,
	type AdminItemTablePreferences,
} from "@/lib/admin/item-table-preferences";
import { recordDragLabel, recordDragSelection } from "@/lib/admin/record-drag";
import type { AdminItemListRow, AdminSource } from "@/lib/admin/types";

import { RECORD_DRAG_TYPE, type RecordDragData } from "./AdminDragDropProvider";
import { FileStateChip, RecordStateChip } from "./AdminStatus";
import { humanizeAdminField } from "./admin-schema";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";

type AdminTableItem = AdminItemListRow & {
	bulkSelected: boolean;
	dragEnabled: boolean;
	inspectorSelected: boolean;
};

const ADMIN_ITEM_TABLE_HEADER_HEIGHT = 40;
const ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY = "__header__";
const ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY = "__status__";
const ADMIN_ITEM_TABLE_WIDGET_SELECTOR = [
	"button:not([disabled]):not([aria-disabled='true']):not([data-disabled='true'])",
	"input:not([disabled]):not([aria-disabled='true']):not([data-disabled='true'])",
	"select:not([disabled]):not([aria-disabled='true']):not([data-disabled='true'])",
	"textarea:not([disabled]):not([aria-disabled='true']):not([data-disabled='true'])",
	"[role='button'][tabindex]:not([aria-disabled='true']):not([data-disabled='true'])",
	"[data-truncated-text][tabindex]",
].join(", ");
const DOCUMENT_TAB_STOP_SELECTOR =
	"a[href], button, input, select, textarea, [tabindex]";

function adminItemTableCellId(rowKey: string, columnId: AdminItemColumnId) {
	return `admin-item-grid-cell-${encodeURIComponent(rowKey)}-${columnId}`;
}

function adminItemTableHeaderCellId(columnId: AdminItemColumnId) {
	return `admin-item-grid-header-${columnId}`;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function formatDate(value: string | null) {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "—";
}

function creatorLine(item: AdminItemListRow, profiles: ReadonlyMap<string, AuthorProfile>) {
	return item.creators.slice(0, 3).map(creator =>
		(creator.authorProfileId ? profiles.get(creator.authorProfileId)?.name : undefined) ?? creatorDisplayName(creator)
	).join(", ") || "—";
}

function PlainCell({
	children,
	icon: Icon,
	numeric = false,
	title,
}: {
	children: React.ReactNode;
	icon?: IconSvgElement;
	numeric?: boolean;
	title?: string;
}) {
	return (
		<span
			className={`flex min-w-0 items-center gap-1.5 truncate text-xs text-black/55 dark:text-white/55 ${
				numeric ? "w-full justify-end tabular-nums" : ""
			}`}
		>
			{Icon ? (
				<HugeiconsIcon icon={Icon} aria-hidden className="shrink-0 opacity-45" size={13} />
			) : null}
			{title ? <TruncatedText text={title} focusable managed /> : children}
		</span>
	);
}

function RelationCell({
	entries,
	icon: Icon,
}: {
	entries: readonly { key: string; label: string }[];
	icon: IconSvgElement;
}) {
	if (entries.length === 0) return <PlainCell>—</PlainCell>;
	const visible = entries.slice(0, 2);
	const remaining = entries.slice(2);
	return (
		<div
			className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-black/55 dark:text-white/55"
		>
			<HugeiconsIcon
				icon={Icon}
				aria-hidden
				className="mr-0.5 shrink-0 opacity-45"
				size={13}
			/>
			{visible.map(({ key, label }) => (
				<span
					key={key}
					className="min-w-0 max-w-28 shrink rounded-md bg-black/[0.045] px-1.5 py-0.5 dark:bg-white/[0.06]"
				>
					<TruncatedText text={label} focusable managed />
				</span>
			))}
			{remaining.length > 0 ? (
				<Tooltip content={remaining.map(({ label }) => label).join(", ")}>
					<span
						className="shrink-0 opacity-55"
					>
						+{remaining.length}
					</span>
				</Tooltip>
			) : null}
		</div>
	);
}

function CollectionRelationCell({ keys }: { keys: readonly string[] }) {
	const { entries } = useResolvedAdminCollections(keys, {
		maxAutoRetries: 2,
	});
	const labels = new Map(entries.map(({ key, name }) => [key, name]));
	return (
		<RelationCell
			entries={keys.map((key) => ({
				key,
				label: labels.get(key) ?? key,
			}))}
			icon={Folder01Icon}
		/>
	);
}

function RecordTitleCell({
	bulkKeys,
	editableSourceKeys,
	items,
	onRequestCollectionAssignment,
	record,
}: {
	bulkKeys: ReadonlySet<string>;
	items: AdminItemListRow[];
	onRequestCollectionAssignment: (
		itemKeys: string[],
		focusKey: string,
		sourceConnectionKey: string,
	) => void;
	record: AdminTableItem;
	editableSourceKeys: ReadonlySet<string>;
}) {
	const itemKeys = recordDragSelection(
		record,
		items,
		bulkKeys,
		editableSourceKeys,
	);
	const draggable = record.dragEnabled && itemKeys.length > 0;
	const pointerStart = useRef<{ x: number; y: number } | null>(null);
	const { handleRef, isDragging, ref } = useDraggable<RecordDragData>({
		data: {
			focusKey: record.key,
			itemKeys,
			kind: "records",
			label: recordDragLabel(record, itemKeys),
			sourceConnectionKey: record.sourceConnectionKey,
		},
		disabled: !draggable,
		id: `admin-record:${record.key}`,
		type: RECORD_DRAG_TYPE,
	});

	return (
		<div
			ref={ref}
			className={`flex min-w-0 items-center gap-2 ${
				isDragging ? "opacity-35" : ""
			}`}
		>
			{editableSourceKeys.has(record.sourceConnectionKey) ? (
				<Tooltip content={`Drag or assign ${record.title}`} openOnFocus={false}>
					<button
						ref={handleRef}
						aria-disabled={!draggable}
						aria-haspopup="dialog"
						aria-label={`Drag or assign ${record.title}${
							itemKeys.length > 1
								? ` with ${itemKeys.length - 1} other selected records`
								: ""
						}`}
						className={`grid size-7 shrink-0 touch-none place-items-center rounded-md text-black/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/30 ${
							draggable
								? "cursor-grab opacity-60 hover:bg-black/[0.05] hover:text-black/70 hover:opacity-100 active:cursor-grabbing dark:hover:bg-white/[0.06] dark:hover:text-white/70"
								: "cursor-wait opacity-25"
						}`}
						data-record-drag-handle={record.key}
						onClick={(event) => {
							event.stopPropagation();
							const start = pointerStart.current;
							pointerStart.current = null;
							if (
								!draggable ||
								(start &&
									Math.hypot(
										event.clientX - start.x,
										event.clientY - start.y,
									) > 4)
							) {
								return;
							}
							onRequestCollectionAssignment(
								itemKeys,
								record.key,
								record.sourceConnectionKey,
							);
						}}
						onKeyDownCapture={(event) => {
							if (
								!draggable ||
								(event.key !== "Enter" && event.key !== " ")
							)
								return;
							event.preventDefault();
							event.stopPropagation();
							event.nativeEvent.stopImmediatePropagation();
							onRequestCollectionAssignment(
								itemKeys,
								record.key,
								record.sourceConnectionKey,
							);
						}}
						onPointerDown={(event) => {
							pointerStart.current = {
								x: event.clientX,
								y: event.clientY,
							};
						}}
						tabIndex={-1}
						type="button"
					>
						<HugeiconsIcon icon={DragDropVerticalIcon} aria-hidden size={14} />
					</button>
				</Tooltip>
			) : (
				<Tooltip content="Collection assignment unavailable for this source">
					<span
						aria-label="Collection assignment unavailable"
						className="grid size-7 shrink-0 place-items-center text-black/20 dark:text-white/20"
					>
						<HugeiconsIcon icon={SquareLock01Icon} aria-hidden size={12} />
					</span>
				</Tooltip>
			)}
			<HugeiconsIcon icon={FileAttachmentIcon} aria-hidden className="mt-0.5 shrink-0 self-start text-black/35 dark:text-white/35" size={15} />
			<div className="min-w-0">
				<p className="truncate text-sm font-medium text-black/85 dark:text-white/90">
					{record.title}
				</p>
				<p className="truncate text-[11px] text-black/40 dark:text-white/40">
					{humanizeAdminField(record.kind)} / {humanizeAdminField(record.itemType)}
				</p>
			</div>
		</div>
	);
}

const TableViewTrigger = forwardRef<
	HTMLButtonElement,
	ComponentPropsWithoutRef<"button">
>(function TableViewTrigger({ children, className, ...props }, ref) {
	return (
		<button
			{...props}
			className={twMerge(
				"grid size-8 shrink-0 place-items-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/75",
				className,
			)}
			ref={ref}
			type="button"
		>
			{children}
		</button>
	);
});

function TableViewControls({
	bulkActions,
	onPreferencesChange,
	onResetPreferences,
	preferences,
}: {
	bulkActions?: ReactNode;
	onPreferencesChange: Dispatch<SetStateAction<AdminItemTablePreferences>>;
	onResetPreferences: () => void;
	preferences: AdminItemTablePreferences;
}) {
	const optionalOrder = preferences.columnOrder.filter(
		(id) => getAdminItemListColumn(id).optional,
	);
	return (
		<div
			aria-label="Table view controls"
			className="flex h-10 shrink-0 items-center gap-1 border-b border-black/[0.06] px-2 dark:border-white/[0.06]"
		>
			<div className="min-w-0 flex-1">{bulkActions}</div>
			<Popover disableAnimation placement="bottom-end">
				<PopoverTrigger>
					<TableViewTrigger aria-label="Choose and arrange columns">
						<HugeiconsIcon icon={LayoutThreeColumnIcon} aria-hidden size={15} />
					</TableViewTrigger>
				</PopoverTrigger>
				<PopoverContent
					className="w-56 rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card"
					data-admin-column-popover
				>
					<div className="flex h-11 w-full items-center justify-between border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
						<span className="text-sm font-semibold text-black/80 dark:text-white/85">
							Columns
						</span>
						<Tooltip content="Reset columns">
							<Button
								aria-label="Reset columns"
								isIconOnly
								onPress={onResetPreferences}
								size="xs"
								variant="transparent"
							>
								<HugeiconsIcon icon={Undo02Icon} aria-hidden size={14} />
							</Button>
						</Tooltip>
					</div>
					<div
						className="max-h-column-picker w-full overflow-y-auto"
						data-admin-column-scroll
					>
						<div className="p-2" data-admin-column-list>
							{preferences.columnOrder.map((id) => {
								const definition = getAdminItemListColumn(id);
								const optionalIndex = optionalOrder.indexOf(id);
								return (
									<div
										key={id}
										className="flex h-9 items-center gap-1 rounded-lg px-1 hover:bg-black/[0.035] dark:hover:bg-white/[0.04]"
									>
										<Checkbox
											aria-label={`Show ${definition.label}`}
											className="min-w-0 flex-1"
											isDisabled={!definition.optional}
											isSelected={
												preferences.columnVisibility[id]
											}
											onValueChange={(visible) =>
												onPreferencesChange(
													(current) => ({
														...current,
														columnVisibility: {
															...current.columnVisibility,
															[id]: visible,
														},
													}),
												)
											}
											size="sm"
										>
											<span className="truncate text-xs">
												{definition.label}
											</span>
										</Checkbox>
										{definition.optional ? (
											<div className="flex shrink-0">
												<Button
													aria-label={`Move ${definition.label} left`}
													isDisabled={
														optionalIndex <= 0
													}
													isIconOnly
													onPress={() =>
														onPreferencesChange(
															(current) => ({
																...current,
																columnOrder:
																	moveAdminItemTableColumn(
																		current.columnOrder,
																		id,
																		"up",
																	),
															}),
														)
													}
													size="xs"
													variant="transparent"
												>
													<HugeiconsIcon icon={ArrowUp01Icon} aria-hidden size={13} />
												</Button>
												<Button
													aria-label={`Move ${definition.label} right`}
													isDisabled={
														optionalIndex ===
														optionalOrder.length - 1
													}
													isIconOnly
													onPress={() =>
														onPreferencesChange(
															(current) => ({
																...current,
																columnOrder:
																	moveAdminItemTableColumn(
																		current.columnOrder,
																		id,
																		"down",
																	),
															}),
														)
													}
													size="xs"
													variant="transparent"
												>
													<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden size={13} />
												</Button>
											</div>
										) : (
											<HugeiconsIcon icon={SquareLock01Icon} aria-label="Required column" className="mx-2 opacity-30" size={12} />
										)}
									</div>
								);
							})}
						</div>
					</div>
				</PopoverContent>
			</Popover>

			<Popover disableAnimation placement="bottom-end">
				<PopoverTrigger>
					<TableViewTrigger aria-label="Change row density">
						<HugeiconsIcon icon={LayoutThreeRowIcon} aria-hidden size={15} />
					</TableViewTrigger>
				</PopoverTrigger>
				<PopoverContent className="w-44 rounded-xl border border-black/[0.08] bg-white p-2 shadow-lg dark:border-white/[0.09] dark:bg-card">
					<div className="w-full space-y-1">
						{ADMIN_ITEM_TABLE_DENSITIES.map((density) => (
							<button
								key={density}
								aria-pressed={preferences.density === density}
								className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs capitalize transition-colors ${
									preferences.density === density
										? "bg-accent/[0.12] font-semibold text-black/85 dark:text-white/90"
										: "text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.05]"
								}`}
								onClick={() =>
									onPreferencesChange((current) => ({
										...current,
										density,
									}))
								}
								type="button"
							>
								{density}
								{preferences.density === density ? (
									<HugeiconsIcon icon={Tick01Icon} aria-hidden size={14} />
								) : null}
							</button>
						))}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

/**
 * A column's cell or header, called instead of rendered as a component.
 * TanStack's flexRender renders each column function as its own component
 * type, so every new columns array, which each render of the admin page
 * made, unmounted and rebuilt every cell in view.
 */
function columnPart<Context>(part: unknown, context: Context): ReactNode {
	return typeof part === "function" ? (part as (context: Context) => ReactNode)(context) : (part as ReactNode);
}

export function AdminItemTable({
	banner,
	bulkActions,
	bulkDisabledKey = null,
	bulkKeys,
	dragEnabled,
	hasMore,
	items,
	loading,
	error,
	onLoadMore,
	onPreferencesChange,
	onRequestCollectionAssignment,
	onResetPreferences,
	onRetry,
	onSelect,
	onSort,
	onToggleBulk,
	onToggleVisible,
	placeHeld,
	preferences,
	selectedKey,
	sources,
	sort,
	sortDirection,
}: {
	/** Shown between the toolbar and the grid, e.g. the link pick-mode notice. */
	banner?: ReactNode;
	bulkActions?: ReactNode;
	/** Row whose checkbox stays disabled (the record being edited while picking links). */
	bulkDisabledKey?: string | null;
	bulkKeys: ReadonlySet<string>;
	dragEnabled: boolean;
	hasMore: boolean;
	items: AdminItemListRow[];
	loading: boolean;
	error: string | null;
	onLoadMore: () => void;
	onPreferencesChange: Dispatch<SetStateAction<AdminItemTablePreferences>>;
	onRequestCollectionAssignment: (
		itemKeys: string[],
		focusKey: string,
		sourceConnectionKey: string,
	) => void;
	onResetPreferences: () => void;
	onRetry: () => void;
	/** `clicks`: the click count of the press that chose it, when it was a pointer's. */
	onSelect: (key: string, clicks?: number) => void;
	onSort: (sort: AdminItemSortColumnId) => void;
	onToggleBulk: (key: string, selected: boolean) => void;
	onToggleVisible: (selected: boolean) => void;
	/** Changes each time the list read itself again for someone else's change, when the reader's place is kept. */
	placeHeld: number;
	preferences: AdminItemTablePreferences;
	selectedKey: string | null;
	sources: AdminSource[];
	sort: AdminItemSortColumnId;
	sortDirection: "asc" | "desc";
}) {
	"use no memo";
	const {profiles} = useAuthorProfiles(items.flatMap(item => item.creators));

	const [activeResizeColumn, setActiveResizeColumn] =
		useState<AdminItemColumnId | null>(null);
	// A record cannot link to itself, so its own row is left out while picking links.
	const selectable = bulkDisabledKey
		? items.filter(({ key }) => key !== bulkDisabledKey)
		: items;
	const allVisibleSelected =
		selectable.length > 0 && selectable.every(({ key }) => bulkKeys.has(key));
	const someVisibleSelected = selectable.some(({ key }) => bulkKeys.has(key));
	const tableItems = useMemo<AdminTableItem[]>(
		() =>
			items.map((record) => ({
				...record,
				bulkSelected: bulkKeys.has(record.key),
				dragEnabled,
				inspectorSelected: record.key === selectedKey,
			})),
		[bulkKeys, dragEnabled, items, selectedKey],
	);
	const sourceLabels = useMemo(
		() => new Map(sources.map(({ key, label }) => [key, label])),
		[sources],
	);
	const editableSourceKeys = useMemo(() => editableCollectionSourceKeys(sources), [sources]);
	const libraryConfig = useLibraryConfig();
	const columns = useMemo<ColumnDef<AdminTableItem>[]>(
		() => [
			{
				cell: ({ row }) => (
					<div
						className="w-fit"
						onClick={(event) => event.stopPropagation()}
					>
						<Checkbox
							aria-label={`Select ${row.original.title}`}
							isDisabled={row.original.key === bulkDisabledKey}
							isSelected={row.original.bulkSelected}
							onValueChange={(selected) =>
								onToggleBulk(row.original.key, selected)
							}
							size="sm"
							tabIndex={-1}
						/>
					</div>
				),
				enableResizing: false,
				header: () => (
					<div onClick={(event) => event.stopPropagation()}>
						<Checkbox
							aria-label="Select all loaded records"
							isDisabled={selectable.length === 0}
							isIndeterminate={
								someVisibleSelected && !allVisibleSelected
							}
							isSelected={allVisibleSelected}
							onValueChange={onToggleVisible}
							size="sm"
							tabIndex={-1}
						/>
					</div>
				),
				id: "select",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.select,
			},
			{
				cell: ({ row }) => (
					<RecordTitleCell
						bulkKeys={bulkKeys}
						editableSourceKeys={editableSourceKeys}
						items={items}
						onRequestCollectionAssignment={
							onRequestCollectionAssignment
						}
						record={row.original}
					/>
				),
				id: "title",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.title,
			},
			{
				cell: ({ row }) => (
					<PlainCell
						icon={UserCircleIcon}
						title={creatorLine(row.original, profiles)}
					>
						{creatorLine(row.original, profiles)}
					</PlainCell>
				),
				id: "creators",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.creators,
			},
			{
				cell: ({ row }) => (
					<PlainCell numeric>{row.original.year ?? "—"}</PlainCell>
				),
				id: "year",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.year,
			},
			{
				cell: ({ row }) => (
					<RecordStateChip state={row.original.state} review={row.original.review} />
				),
				id: "state",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.state,
			},
			{
				cell: ({ row }) => (
					<FileStateChip state={row.original.fileState} />
				),
				id: "fileState",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.fileState,
			},
			{
				cell: ({ row }) => (
					<PlainCell icon={Calendar01Icon}>
						{formatDate(row.original.updatedAt)}
					</PlainCell>
				),
				id: "updated",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.updated,
			},
			{
				cell: ({ row }) => (
					<PlainCell>
						{humanizeAdminField(row.original.itemType)}
					</PlainCell>
				),
				id: "itemType",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.itemType,
			},
			{
				cell: ({ row }) => <PlainCell>{humanizeAdminField(row.original.kind)}</PlainCell>,
				id: "kind",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.kind,
			},
			{
				cell: ({ row }) => (
					<PlainCell icon={DatabaseIcon}>
						{row.original.importMethod === "doi" ? "DOI import" : row.original.importMethod === "file" ? "File import" : sourceLabels.get(row.original.sourceConnectionKey) ?? row.original.sourceConnectionKey}
					</PlainCell>
				),
				id: "source",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.source,
			},
			{
				cell: ({ row }) => (
					<CollectionRelationCell keys={row.original.collections} />
				),
				id: "collections",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.collections,
			},
			{
				cell: ({ row }) => (
					<RelationCell
						entries={ordinaryItemTags(row.original.tags, libraryConfig).map((label, index) => ({
							key: `${label}:${index}`,
							label,
						}))}
						icon={Tag01Icon}
					/>
				),
				id: "tags",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.tags,
			},
			{
				cell: ({ row }) => (
					<PlainCell icon={Calendar01Icon}>
						{formatDate(row.original.dateAdded)}
					</PlainCell>
				),
				id: "dateAdded",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.dateAdded,
			},
			{
				cell: ({ row }) => <PlainCell>{row.original.key}</PlainCell>,
				id: "key",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.key,
			},
			{
				cell: ({ row }) => (
					<PlainCell numeric>{row.original.revision}</PlainCell>
				),
				id: "revision",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.revision,
			},
			{
				cell: ({ row }) => (
					<PlainCell numeric>
						{row.original.pageCount ?? "—"}
					</PlainCell>
				),
				id: "pageCount",
				...ADMIN_ITEM_TABLE_COLUMN_SIZES.pageCount,
			},
		],
		[
			allVisibleSelected,
			bulkDisabledKey,
			bulkKeys,
			editableSourceKeys,
			items,
			onRequestCollectionAssignment,
			onToggleBulk,
			onToggleVisible,
			selectable.length,
			someVisibleSelected,
			sourceLabels,
			profiles,
			libraryConfig,
		],
	);

	// TanStack Table intentionally exposes unstable callback identities; the
	// component-level `use no memo` directive keeps React Compiler away from it.
	// eslint-disable-next-line react-hooks/incompatible-library
	const table = useReactTable({
		columns,
		data: tableItems,
		getCoreRowModel: getCoreRowModel(),
		state: {
			columnOrder: preferences.columnOrder,
			columnSizing: preferences.columnSizing,
			columnVisibility: preferences.columnVisibility as VisibilityState,
		},
	});
	const rowHeight = adminItemTableRowHeight(preferences.density);
	const tableRows = table.getRowModel().rows;
	const tableScrollRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLTableElement>(null);
	const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
	const [activeColumnId, setActiveColumnId] =
		useState<AdminItemColumnId>("title");
	const [gridHasFocus, setGridHasFocus] = useState(false);
	const visibleColumns = table.getVisibleLeafColumns();
	const visibleColumnIds = visibleColumns.map(
		(column) => column.id as AdminItemColumnId,
	);
	const effectiveActiveColumnId = visibleColumnIds.includes(activeColumnId)
		? activeColumnId
		: (visibleColumnIds[0] ?? "title");
	const activeTableRowIndex = tableRows.findIndex(
		(row) => row.original.key === activeRowKey,
	);
	const selectedTableRowIndex = tableRows.findIndex(
		(row) => row.original.key === selectedKey,
	);
	const effectiveActiveRowKey =
		activeRowKey === ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
			? ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
			: tableRows.length === 0 &&
				  activeRowKey === ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
				? ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
				: activeTableRowIndex >= 0
					? activeRowKey!
					: selectedTableRowIndex >= 0
						? tableRows[selectedTableRowIndex]!.original.key
						: (tableRows[0]?.original.key ??
							ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY);
	const activeVirtualRowIndex = tableRows.findIndex(
		(row) => row.original.key === effectiveActiveRowKey,
	);
	const virtualRangeExtractor = useCallback(
		(range: Parameters<typeof defaultRangeExtractor>[0]) => {
			const indexes = defaultRangeExtractor(range);
			if (
				activeVirtualRowIndex < 0 ||
				indexes.includes(activeVirtualRowIndex)
			) {
				return indexes;
			}
			return [...indexes, activeVirtualRowIndex].sort(
				(left, right) => left - right,
			);
		},
		[activeVirtualRowIndex],
	);
	const rowVirtualizer = useVirtualizer({
		count: tableRows.length,
		estimateSize: () => rowHeight,
		getItemKey: (index) => tableRows[index]?.original.key ?? index,
		getScrollElement: () => tableScrollRef.current,
		initialRect: { height: 600, width: 632 },
		overscan: 8,
		rangeExtractor: virtualRangeExtractor,
		scrollMargin: ADMIN_ITEM_TABLE_HEADER_HEIGHT,
	});
	useEffect(() => {
		rowVirtualizer.measure();
	}, [rowHeight, rowVirtualizer]);
	// A list that read itself again for someone else's change keeps the rows on screen where they are: rows that came
	// or went above them move the scroll position by as much, so nobody reading further down is pushed along. The
	// outside system is the grid's scroll position.
	const latestRows = useRef(tableRows);
	latestRows.current = tableRows;
	const latestRowHeight = useRef(rowHeight);
	latestRowHeight.current = rowHeight;
	const shownKeys = useRef<string[]>([]);
	useLayoutEffect(() => {
		const scroller = tableScrollRef.current;
		const before = shownKeys.current;
		const height = latestRowHeight.current;
		if (!scroller || scroller.scrollTop <= 0) return;
		const top = Math.floor(scroller.scrollTop / height);
		// The first row at the top of the view that is still in the list says how far the rows moved.
		for (let index = top; index < Math.min(before.length, top + 20); index += 1) {
			const now = latestRows.current.findIndex((row) => row.original.key === before[index]);
			if (now < 0) continue;
			if (now !== index) scroller.scrollTop += (now - index) * height;
			return;
		}
	}, [placeHeld]);
	useLayoutEffect(() => {
		shownKeys.current = tableRows.map((row) => row.original.key);
	});
	const activeColumnIndex = Math.max(
		0,
		visibleColumnIds.indexOf(effectiveActiveColumnId),
	);
	const activeGridRowIndex =
		effectiveActiveRowKey === ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
			? -1
			: effectiveActiveRowKey === ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
				? 0
				: activeVirtualRowIndex;
	const activeCellId =
		effectiveActiveRowKey === ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
			? adminItemTableHeaderCellId(effectiveActiveColumnId)
			: effectiveActiveRowKey === ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
				? "admin-item-grid-status"
				: adminItemTableCellId(
						effectiveActiveRowKey,
						effectiveActiveColumnId,
					);
	const visibleColumnCount = visibleColumns.length;
	const isCellActive = (rowKey: string, columnId: AdminItemColumnId) =>
		gridHasFocus &&
		effectiveActiveRowKey === rowKey &&
		effectiveActiveColumnId === columnId;
	const focusGridCell = (rowIndex: number, columnIndex: number) => {
		const boundedColumnIndex = Math.max(
			0,
			Math.min(visibleColumnIds.length - 1, columnIndex),
		);
		const nextColumnId =
			visibleColumnIds[boundedColumnIndex] ?? effectiveActiveColumnId;
		const lastRowIndex = tableRows.length > 0 ? tableRows.length - 1 : 0;
		const boundedRowIndex = Math.max(-1, Math.min(lastRowIndex, rowIndex));
		const nextRowKey =
			boundedRowIndex < 0
				? ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
				: tableRows.length === 0
					? ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
					: tableRows[boundedRowIndex]!.original.key;
		const nextCellId =
			nextRowKey === ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY
				? adminItemTableHeaderCellId(nextColumnId)
				: nextRowKey === ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
					? "admin-item-grid-status"
					: adminItemTableCellId(nextRowKey, nextColumnId);

		setActiveRowKey(nextRowKey);
		setActiveColumnId(nextColumnId);
		if (boundedRowIndex >= 0 && tableRows.length > 0) {
			rowVirtualizer.scrollToIndex(boundedRowIndex, { align: "auto" });
		}
		const revealCell = (attempt: number) => {
			requestAnimationFrame(() => {
				const cell = document.getElementById(nextCellId);
				if (cell) {
					cell.scrollIntoView({
						block: "nearest",
						inline: "nearest",
					});
				} else if (attempt < 4) {
					revealCell(attempt + 1);
				}
			});
		};
		revealCell(0);
	};
	const getActiveCellWidgets = () => {
		const activeCell = document.getElementById(activeCellId);
		return Array.from(
			activeCell?.querySelectorAll<HTMLElement>(
				ADMIN_ITEM_TABLE_WIDGET_SELECTOR,
			) ?? [],
		);
	};
	const focusOutsideGrid = (direction: -1 | 1) => {
		const grid = gridRef.current;
		if (!grid) return false;
		const tabStops = Array.from(
			document.querySelectorAll<HTMLElement>(DOCUMENT_TAB_STOP_SELECTOR),
		).filter((element) => {
			if (
				element.tabIndex < 0 ||
				element.getAttribute("aria-disabled") === "true" ||
				element.hasAttribute("disabled") ||
				element.closest("[inert]")
			) {
				return false;
			}
			const style = getComputedStyle(element);
			return (
				element.getClientRects().length > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		});
		const gridIndex = tabStops.indexOf(grid);
		if (gridIndex < 0) return false;
		for (
			let index = gridIndex + direction;
			index >= 0 && index < tabStops.length;
			index += direction
		) {
			const candidate = tabStops[index]!;
			if (grid.contains(candidate)) continue;
			candidate.focus({ preventScroll: true });
			return document.activeElement === candidate;
		}
		return false;
	};
	const enterActiveCellWidget = () => {
		const widget = getActiveCellWidgets()[0];
		widget?.focus({ preventScroll: true });
		return Boolean(widget);
	};
	const activateActiveCell = () => {
		const activeRowIsComposite =
			effectiveActiveRowKey === ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY ||
			effectiveActiveRowKey === ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY;
		if (activeRowIsComposite || effectiveActiveColumnId === "select") {
			getActiveCellWidgets()[0]?.click();
			return;
		}
		onSelect(effectiveActiveRowKey);
	};
	const setActiveCellFromPointer = (
		rowKey: string,
		columnId: AdminItemColumnId,
		target: EventTarget,
	) => {
		setActiveRowKey(rowKey);
		setActiveColumnId(columnId);
		if (
			!(target instanceof Element) ||
			!target.closest("button, input, select, textarea, [role='button']")
		) {
			gridRef.current?.focus({ preventScroll: true });
		}
	};
	const selectColumnWidth = table.getColumn("select")?.getSize() ?? 44;
	const setColumnSize = (id: AdminItemColumnId, size: number | null) =>
		onPreferencesChange((current) => {
			const columnSizing = { ...current.columnSizing };
			if (size === null) delete columnSizing[id];
			else columnSizing[id] = Math.round(size);
			return { ...current, columnSizing };
		});
	const startColumnResize = (
		event: ReactPointerEvent<HTMLButtonElement>,
		id: AdminItemColumnId,
		startSize: number,
	) => {
		event.preventDefault();
		event.stopPropagation();
		const handle = event.currentTarget;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const limits = ADMIN_ITEM_TABLE_COLUMN_SIZES[id];
		let nextSize = startSize;
		setActiveResizeColumn(id);
		handle.setPointerCapture(pointerId);

		const move = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientX - startX;
			nextSize = Math.min(
				limits.maxSize ?? ADMIN_ITEM_TABLE_MAX_COLUMN_SIZE,
				Math.max(limits.minSize, startSize + delta),
			);
			handle.style.transform = `translateX(${nextSize - startSize}px)`;
		};
		const finish = () => {
			handle.style.removeProperty("transform");
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			if (handle.hasPointerCapture(pointerId)) {
				handle.releasePointerCapture(pointerId);
			}
			setActiveResizeColumn(null);
			if (nextSize !== startSize) setColumnSize(id, nextSize);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<TableViewControls
				bulkActions={bulkActions}
				onPreferencesChange={onPreferencesChange}
				onResetPreferences={onResetPreferences}
				preferences={preferences}
			/>
			{banner}
			<div
				ref={tableScrollRef}
				className="min-h-0 flex-1 overflow-auto"
				data-admin-item-table-scroll
				style={{ containerType: "inline-size" }}
			>
				<table
					ref={gridRef}
					aria-activedescendant={activeCellId}
					aria-colcount={visibleColumnCount}
					aria-label="Community records"
					aria-multiselectable="true"
					aria-rowcount={
						tableRows.length > 0 ? tableRows.length + 1 : 2
					}
					className="grid border-separate border-spacing-0 outline-none"
					onBlurCapture={(event) => {
						if (
							!event.currentTarget.contains(event.relatedTarget)
						) {
							setGridHasFocus(false);
						}
					}}
					onFocusCapture={() => setGridHasFocus(true)}
					onKeyDown={(event) => {
						if (event.target !== event.currentTarget) {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								gridRef.current?.focus({ preventScroll: true });
							} else if (event.key === "Tab") {
								const widgets = getActiveCellWidgets();
								const activeWidgetIndex = widgets.indexOf(
									event.target as HTMLElement,
								);
								if (activeWidgetIndex >= 0) {
									const offset = event.shiftKey ? -1 : 1;
									const nextWidget =
										widgets[activeWidgetIndex + offset];
									if (nextWidget) {
										event.preventDefault();
										nextWidget.focus({
											preventScroll: true,
										});
									} else {
										const lastGridRowIndex =
											tableRows.length > 0
												? tableRows.length - 1
												: 0;
										const leavingGrid = event.shiftKey
											? activeGridRowIndex === -1 &&
												activeColumnIndex === 0
											: activeGridRowIndex ===
													lastGridRowIndex &&
												activeColumnIndex ===
													visibleColumnIds.length - 1;
										if (!leavingGrid) {
											event.preventDefault();
											const crossedRowBoundary =
												event.shiftKey
													? activeColumnIndex === 0
													: activeColumnIndex ===
														visibleColumnIds.length -
															1;
											const nextRowIndex =
												crossedRowBoundary
													? activeGridRowIndex +
														offset
													: activeGridRowIndex;
											const nextColumnIndex =
												crossedRowBoundary
													? event.shiftKey
														? visibleColumnIds.length -
															1
														: 0
													: activeColumnIndex +
														offset;
											gridRef.current?.focus({
												preventScroll: true,
											});
											focusGridCell(
												nextRowIndex,
												nextColumnIndex,
											);
										} else if (
											focusOutsideGrid(
												event.shiftKey ? -1 : 1,
											)
										) {
											event.preventDefault();
										}
									}
								}
							}
							return;
						}
						if (event.nativeEvent.isComposing) return;
						const lastColumnIndex = Math.max(
							0,
							visibleColumnIds.length - 1,
						);
						const lastRowIndex =
							tableRows.length > 0 ? tableRows.length - 1 : 0;
						const pageRows = Math.max(
							1,
							Math.floor(
								((tableScrollRef.current?.clientHeight ??
									rowHeight) -
									ADMIN_ITEM_TABLE_HEADER_HEIGHT) /
									rowHeight,
							),
						);
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key.toLowerCase() === "a"
						) {
							event.preventDefault();
							onToggleVisible(!allVisibleSelected);
							return;
						}
						if (
							event.shiftKey &&
							event.key === " " &&
							effectiveActiveRowKey !==
								ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY &&
							effectiveActiveRowKey !==
								ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
						) {
							event.preventDefault();
							const activeRow = tableRows[activeGridRowIndex];
							if (activeRow) {
								onToggleBulk(
									activeRow.original.key,
									!activeRow.original.bulkSelected,
								);
							}
							return;
						}
						if (event.key === "F2") {
							if (enterActiveCellWidget()) event.preventDefault();
							return;
						}
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							activateActiveCell();
							return;
						}
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key === "Home"
						) {
							event.preventDefault();
							focusGridCell(-1, 0);
							return;
						}
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key === "End"
						) {
							event.preventDefault();
							focusGridCell(lastRowIndex, lastColumnIndex);
							return;
						}
						const nextPosition =
							event.key === "ArrowRight"
								? [activeGridRowIndex, activeColumnIndex + 1]
								: event.key === "ArrowLeft"
									? [
											activeGridRowIndex,
											activeColumnIndex - 1,
										]
									: event.key === "ArrowDown"
										? [
												activeGridRowIndex + 1,
												activeColumnIndex,
											]
										: event.key === "ArrowUp"
											? [
													activeGridRowIndex - 1,
													activeColumnIndex,
												]
											: event.key === "PageDown"
												? [
														activeGridRowIndex +
															pageRows,
														activeColumnIndex,
													]
												: event.key === "PageUp"
													? [
															activeGridRowIndex -
																pageRows,
															activeColumnIndex,
														]
													: event.key === "Home"
														? [
																activeGridRowIndex,
																0,
															]
														: event.key === "End"
															? [
																	activeGridRowIndex,
																	lastColumnIndex,
																]
															: null;
						if (nextPosition) {
							event.preventDefault();
							focusGridCell(nextPosition[0]!, nextPosition[1]!);
						}
					}}
					role="grid"
					style={{ minWidth: "100%", width: table.getTotalSize() }}
					tabIndex={0}
				>
					<thead className="sticky top-0 z-30 grid" role="rowgroup">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr
								key={headerGroup.id}
								aria-rowindex={1}
								className="flex w-full"
								role="row"
							>
								{headerGroup.headers.map((header) => {
									const id = header.column
										.id as AdminItemColumnId;
									const definition =
										getAdminItemListColumn(id);
									const sorted =
										definition.sortable && sort === id;
									const pinned =
										id === "select" || id === "title";
									// Phones scroll these with the rest so the other columns can be read.
									const pinnedLeft =
										id === "title" ? selectColumnWidth : 0;
									return (
										<th
											key={header.id}
											id={adminItemTableHeaderCellId(id)}
											aria-colindex={
												header.column.getIndex() + 1
											}
											aria-sort={
												sorted
													? sortDirection === "asc"
														? "ascending"
														: "descending"
													: undefined
											}
											className={`group relative flex shrink-0 items-center border-b border-black/[0.06] bg-card_light px-3 text-left text-[11px] font-semibold normal-case text-black/40 dark:border-white/[0.06] dark:bg-card dark:text-white/40 ${
												isCellActive(
													ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY,
													id,
												)
													? "z-50 ring-2 ring-inset ring-focus/80"
													: ""
											} ${pinned ? "z-40 md:sticky md:left-[var(--admin-pin-left)]" : ""} ${
												id === "title"
													? "after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:top-0 after:w-px after:bg-black/[0.07] dark:after:bg-white/[0.08]"
													: ""
											}`}
											data-column-id={id}
											onMouseDown={(event) =>
												setActiveCellFromPointer(
													ADMIN_ITEM_TABLE_HEADER_FOCUS_KEY,
													id,
													event.target,
												)
											}
											role="columnheader"
											style={
												{
													height: ADMIN_ITEM_TABLE_HEADER_HEIGHT,
													"--admin-pin-left": pinned
														? `${pinnedLeft}px`
														: undefined,
													width: header.getSize(),
												} as React.CSSProperties
											}
										>
											{header.isPlaceholder ? null : id ===
											  "select" ? (
												columnPart(
													header.column.columnDef
														.header,
													header.getContext(),
												)
											) : definition.sortable ? (
												<SortHeader
													columnId={
														id as AdminItemSortColumnId
													}
													label={definition.label}
													onSort={onSort}
													sort={sort}
													sortDirection={
														sortDirection
													}
												/>
											) : (
												<span className="block truncate">
													{definition.label}
												</span>
											)}
											{header.column.getCanResize() ? (
												<button
													aria-label={`Resize ${definition.label} column`}
													className={`absolute right-0 top-0 z-10 h-full w-3 cursor-col-resize touch-none select-none after:absolute after:bottom-2 after:right-0 after:top-2 after:w-px after:bg-black/10 after:opacity-0 hover:after:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus group-hover:after:opacity-100 dark:after:bg-white/15 ${
														activeResizeColumn ===
														id
															? "after:!bg-accent after:opacity-100"
															: ""
													}`}
													data-resizing={
														activeResizeColumn ===
														id
															? "true"
															: undefined
													}
													tabIndex={-1}
													onDoubleClick={() =>
														setColumnSize(id, null)
													}
													onKeyDown={(event) => {
														if (
															event.key !==
																"ArrowLeft" &&
															event.key !==
																"ArrowRight"
														)
															return;
														event.preventDefault();
														const limits =
															ADMIN_ITEM_TABLE_COLUMN_SIZES[
																id
															];
														setColumnSize(
															id,
															Math.min(
																limits.maxSize ??
																	ADMIN_ITEM_TABLE_MAX_COLUMN_SIZE,
																Math.max(
																	limits.minSize,
																	header.getSize() +
																		(event.key ===
																		"ArrowRight"
																			? 16
																			: -16),
																),
															),
														);
													}}
													onPointerDown={(event) =>
														startColumnResize(
															event,
															id,
															header.getSize(),
														)
													}
													type="button"
												/>
											) : null}
										</th>
									);
								})}
							</tr>
						))}
					</thead>
					<tbody
						className="relative grid"
						role="rowgroup"
						style={{
							height:
								tableItems.length > 0
									? rowVirtualizer.getTotalSize()
									: 160,
						}}
					>
						{rowVirtualizer.getVirtualItems().map((virtualRow) => {
							const row = tableRows[virtualRow.index]!;
							const rowBackground = row.original.inspectorSelected
								? "bg-accent/[0.08] dark:bg-accent/[0.12]"
								: "bg-card_light dark:bg-card";
							return (
								<tr
									key={row.id}
									aria-current={
										row.original.inspectorSelected
											? "true"
											: undefined
									}
									aria-rowindex={virtualRow.index + 2}
									aria-selected={row.original.bulkSelected}
									className={`group absolute left-0 top-0 flex w-full cursor-pointer transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-30 after:h-px after:bg-black/[0.06] after:content-[''] hover:bg-black/[0.055] dark:after:bg-black/30 dark:hover:bg-white/[0.07] ${rowBackground}`}
									data-record-key={row.original.key}
									onClick={(event) => onSelect(row.original.key, event.detail)}
									style={{
										height: virtualRow.size,
										transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
									}}
									role="row"
								>
									{row.getVisibleCells().map((cell) => {
										const id = cell.column
											.id as AdminItemColumnId;
										const pinned =
											id === "select" || id === "title";
										const pinnedSurface = pinned
											? row.original.inspectorSelected
												? "bg-card_light before:bg-accent/[0.08] group-hover:before:bg-black/[0.055] dark:bg-card dark:before:bg-accent/[0.12] dark:group-hover:before:bg-white/[0.07]"
												: "bg-card_light before:bg-transparent group-hover:before:bg-black/[0.055] dark:bg-card dark:group-hover:before:bg-white/[0.07]"
											: "bg-inherit";
										return (
											<td
												key={cell.id}
												id={adminItemTableCellId(
													row.original.key,
													id,
												)}
												aria-colindex={
													cell.column.getIndex() + 1
												}
												className={`flex shrink-0 items-center px-3 py-0 ${pinnedSurface} ${
													isCellActive(
														row.original.key,
														id,
													)
														? "z-30 ring-2 ring-inset ring-focus/80"
														: ""
												} ${
													pinned
														? "relative z-20 md:sticky md:left-[var(--admin-pin-left)] before:pointer-events-none before:absolute before:inset-0 before:content-[''] [&>*]:relative [&>*]:z-10"
														: ""
												} ${
													id === "title"
														? "after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:top-0 after:w-px after:bg-black/[0.07] dark:after:bg-white/[0.08]"
														: ""
												}`}
												data-column-id={id}
												onMouseDown={(event) =>
													setActiveCellFromPointer(
														row.original.key,
														id,
														event.target,
													)
												}
												role="gridcell"
												style={
													{
														"--admin-pin-left":
															id === "title"
																? `${selectColumnWidth}px`
																: pinned
																	? "0px"
																	: undefined,
														width: cell.column.getSize(),
													} as React.CSSProperties
												}
											>
												{columnPart(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</td>
										);
									})}
								</tr>
							);
						})}
						{tableItems.length === 0 ? (
							<tr
								aria-rowindex={2}
								className="flex h-40 w-full"
								role="row"
							>
								<td
									id="admin-item-grid-status"
									aria-atomic="true"
									aria-live={error ? "assertive" : "polite"}
									className={`sticky left-0 flex h-40 items-center justify-center px-4 text-center text-sm text-black/45 dark:text-white/45 ${
										gridHasFocus &&
										effectiveActiveRowKey ===
											ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY
											? "ring-2 ring-inset ring-focus/80"
											: ""
									}`}
									colSpan={visibleColumnCount}
									onMouseDown={(event) =>
										setActiveCellFromPointer(
											ADMIN_ITEM_TABLE_STATUS_FOCUS_KEY,
											effectiveActiveColumnId,
											event.target,
										)
									}
									role="gridcell"
									style={{ width: "100cqw" }}
								>
									{loading ? (
										<Spinner
											aria-label="Loading records"
											size="sm"
										/>
									) : error ? (
										<div className="flex max-w-sm flex-col items-center gap-2 text-pretty">
											<HugeiconsIcon icon={AlertCircleIcon} aria-hidden className="text-danger/70" size={20} />
											<p className="text-sm text-danger">
												{error}
											</p>
											<Button
												onPress={onRetry}
												size="xs"
												tabIndex={-1}
											>
												Try again
											</Button>
										</div>
									) : (
									<div className="flex flex-col items-center text-pretty">
										<p>
												No records match these filters.
											</p>
										</div>
									)}
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
				{hasMore ? (
					<div
						className="sticky left-0 flex h-12 w-full items-center justify-center border-t border-black/[0.05] bg-card_light dark:border-white/[0.05] dark:bg-card"
						data-admin-item-table-load-more
					>
						<Button
							isLoading={loading}
							onPress={onLoadMore}
							size="xs"
							startContent={<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden size={14} />}
							variant="transparent"
						>
							Load more
						</Button>
					</div>
				) : null}
			</div>
			{error && items.length > 0 ? (
				<div
					className="flex items-center justify-between gap-3 border-t border-danger/15 bg-danger/5 px-3 py-2 text-xs text-danger"
					role="alert"
				>
					<span className="truncate">{error}</span>
					<Button onPress={onRetry} size="xs" variant="transparent">
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
