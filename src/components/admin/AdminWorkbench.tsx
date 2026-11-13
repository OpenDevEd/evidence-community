"use client";

import { adminCanonicalPayloadToItemFields } from "@/lib/admin/item-fields";
import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";
import { documentAttachment, uploadPdfFile, validatePdf, type PdfUploadStep } from "./admin-pdf";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { parseAsString, useQueryState } from "nuqs";
import { AdminDigestsInspector, AdminDigestsMain, useAdminDigests } from "./AdminDigests";
import { DigestsPage, digestShowFor, recordStateFor, type DigestShow } from "./admin-digests-page";
import { Add01Icon, ArchiveIcon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, FileImportIcon, Folder01Icon, FolderInputIcon, LibraryIcon, Files01Icon, Loading03Icon, Logout01Icon, FilterHorizontalIcon, FileEditIcon, Refresh01Icon, Search01Icon, SentIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nextui-org/react";
import {
	type FormEvent,
	type SetStateAction,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import { LibraryLogo } from "@/components/library/LibraryIdentity";
import ThemeSwitcher from "@/components/layout/navbar/ThemeSwitcher";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Tooltip } from "@/components/nextui/Tooltip";
import useBreakpoint from "@/hooks/useBreakpoint";
import type {
	AdminCollectionCatalogEntry,
	AdminCollectionCatalogPage,
	AdminItemDraft,
	AdminItemDetail,
	AdminItemLinkKind,
	AdminItemViewFilters,
	AdminLibrarySnapshot,
	AdminLinkTarget,
	AdminRecordState,
} from "@/lib/admin/types";
import type { AdminItemSortColumnId } from "@/lib/admin/item-list-contract";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResult,
} from "@/lib/admin/item-batch-contract";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { getRuntimeHomeHref } from "@/config/library-config/links";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { useFinePointer } from "@/hooks/useBreakpoint";
import { Link } from "@/i18n/routing";

import { useAdminSession } from "./AdminSessionProvider";
import { AdminImportDialog } from "./AdminImportDialog";
import { IMPORT_DRAFTS_CHANGED_EVENT, importButtonLabel, useImportBatch, usePdfImportStatus } from "./admin-import";
import { EditorialInspector } from "./EditorialInspector";
import type { ReviewLinkPicker } from "./useReviewLinkPicker";
import { mutate } from "swr";
import { approveAdminReview, setAdminPdfRemoval, stageAdminSourcePdf, submitAdminReview } from "./admin-api";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { AdminSourceStatusDialog } from "./AdminSourceStatus";
import {
	AdminWritebackSourcesDialog,
	type WritebackDialogRequest,
} from "./AdminWritebackSourcesDialog";
import { SourceProviderIcon } from "./SourceProviderIcon";
import { resolveWritebackDialogOptions } from "./writeback-selection";
import {
	adminCollectionPath,
	AdminCollectionPicker,
	preloadAdminCollections,
} from "./AdminCollectionPicker";
import { AdminItemFilters } from "./AdminItemFilters";
import { AdminItemTable } from "./AdminItemTable";
import {
	AdminNavigation,
	expandAdminCollections,
	focusAdminCollection,
	invalidateAdminCollectionCatalogue,
} from "./AdminNavigation";
import {
	AdminApiError,
	adminErrorMessage,
	createAdminCollection,
	createAdminDraft,
	deleteAdminCollection,
	discardAdminDraft,
	discardAdminPdfDraft,
	getAdminItem,
	getAdminLibrary,
	moveAdminCollection,
	mutateAdminItems,
	openAdminDraft,
	setAdminItemWritebackSources,
	renameAdminCollection,
	restoreAdminCollection,
	saveAdminDraft,
	unpublishAdminItem,
} from "./admin-api";
import {
	type AdminSchemaDefinition,
	editablePayloadFromDetail,
	humanizeAdminField,
	payloadForItemType,
} from "./admin-schema";
import { linkKeysFromPayload } from "./admin-diff";
import { focusAdminDragHandle } from "./admin-focus";
import {
	AdminDragDropRoot,
	type CollectionDropDestination,
} from "./AdminDragDropProvider";
import { isTopLevelAdminItemType } from "@/lib/admin/item-fields";
import type { AdminFieldErrors, ConflictingDraft } from "@/lib/admin/errors";
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";
import {
	applyItemDraftPatch,
	createItemDraftPatch,
} from "@/lib/admin/item-draft-merge";
import {
	clearChangedAdminFieldErrors,
	shouldClearAdminValidationErrors,
} from "./admin-validation";
import { FirstCollections } from "./useAdminCollectionCatalogue";
import { useAdminItemList } from "./useAdminItemList";
import { oneAtATime, until, useAdminLive } from "./admin-live";
import { noteAdminCollectionsChangedElsewhere } from "./admin-collection-events";
import { useAdminItemTablePreferences } from "./useAdminItemTablePreferences";
import { AdminSearchIndexStatus } from "./AdminSearchIndexStatus";
import { AdminPublicPages } from "./AdminPublicPages";
import { DEFAULT_PREVIEW_ZOOM } from "./DraftPreviewPane";
import { useAdminSearchIndex } from "./useAdminSearchIndex";
import {
	ADMIN_SEARCH_MAX,
	DEFAULT_ADMIN_ITEM_VIEW_FILTERS,
	setSingleAdminItemFilter,
	singleAdminItemFilterValue,
} from "@/lib/admin/item-filter-state";
import { useReaderSession } from "@/components/layout/navbar/ReaderSession";

function requiredDraftValue<T>(
	values: Map<string, T>,
	key: string,
	label: string,
) {
	const value = values.get(key);
	if (value === undefined) throw new Error(`${label} is missing for ${key}`);
	return value;
}

type SaveState = "conflict" | "error" | "idle" | "saved" | "saving";

type CollectionDialog =
	| {
			mode: "create";
			parentCollection: string | null;
	  }
	| {
			collection: AdminCollectionCatalogEntry;
			mode: "rename";
	  };

type MoveDialog = { collection: AdminCollectionCatalogEntry };

type CollectionLocation = {
	key: string;
	name: string;
	path: string;
};

type ConfirmDialog = {
	error?: string;
	action: () => Promise<void>;
	confirmLabel?: string;
	danger?: boolean;
	message: string;
	onError?: (error: unknown) => void;
	title: string;
};

type RecordAssignment = {
	focusKey: string | null;
	initialSourceConnectionKey: string;
	itemKeys: string[];
	itemSourceConnectionKeys: string[];
};

function pickedItemTarget(row: Pick<AdminLinkTarget, "key" | "itemType" | "title"> & {state: string}): AdminLinkTarget {
 return {key: row.key, itemType: row.itemType, title: row.title?.trim() || "Untitled record", deleted: row.state === "deleted"};
}

function collectionLocationFromCatalog(
	entry: AdminCollectionCatalogEntry,
	sources: AdminLibrarySnapshot["sources"],
): CollectionLocation {
	return {
		key: entry.key,
		name: entry.name,
		path: adminCollectionPath(entry, sources),
	};
}

function parentCollectionLocation(
	entry: AdminCollectionCatalogEntry,
	sources: AdminLibrarySnapshot["sources"],
): CollectionLocation | null {
	const parent = entry.ancestors.at(-1);
	if (!parent) return null;
	const source =
		sources.find(
			({ key: sourceKey }) => sourceKey === entry.sourceConnectionKey,
		)?.label ?? entry.sourceConnectionKey;
	return {
		key: parent.key,
		name: parent.name,
		path: [
			source,
			...entry.ancestors.slice(0, -1).map(({ name }) => name),
		].join(" › "),
	};
}

const collectionControlClassNames = {
	input: "text-sm",
	inputWrapper: "h-10 min-h-10 rounded-xl",
} as const;

/** Label above control, the one shape every field in the collection dialogs uses. */
function CollectionField({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<div className="space-y-1.5">
			<div className="text-xs font-medium text-black/60 dark:text-white/65">
				{label}
			</div>
			{children}
		</div>
	);
}

function CollectionLocationButton({
	buttonRef,
	label,
	location,
	onPress,
	topLevelSource,
}: {
	buttonRef?: React.RefObject<HTMLButtonElement | null>;
	label: string;
	location: CollectionLocation | null;
	onPress: () => void;
	topLevelSource: string;
}) {
	return (
		<CollectionField label={label}>
			<button
				aria-label={`Change ${label.toLowerCase()}, current ${location?.name ?? "Top level"}, ${location?.path ?? topLevelSource}`}
				className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-black/10 bg-white px-3 text-left transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:border-white/10 dark:bg-secondary dark:hover:bg-white/[0.04]"
				data-admin-collection-location
				onClick={onPress}
				ref={buttonRef}
				type="button"
			>
				<HugeiconsIcon icon={Folder01Icon} aria-hidden className="shrink-0 text-accent" size={15} />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-black/75 dark:text-white/80">
						{location?.name ?? "Top level"}
					</span>
					<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
						{location?.path ?? topLevelSource}
					</span>
				</span>
				<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="shrink-0 text-black/30 dark:text-white/30" size={14} />
			</button>
		</CollectionField>
	);
}

const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 1280px)";
const ADMIN_SOURCE_SYNC_POLL_MS = 10_000;
const ADMIN_LIBRARY_POLL_MS = 60_000;

function singleKey(keys: "all" | Set<React.Key>) {
	if (keys === "all") return null;
	const value = [...keys][0];
	return typeof value === "string" ? value : null;
}

function errorMessage(error: unknown) {
	return adminErrorMessage(error, "Admin operation failed");
}

function formErrors(error: unknown): AdminFieldErrors {
	if (
		error instanceof AdminApiError &&
		error.code === "validation_failed" &&
		Object.keys(error.fields).length > 0
	) {
		return error.fields;
	}
	return { _form: errorMessage(error) };
}

function fileErrorMessage(error: unknown) {
	if (
		error instanceof AdminApiError &&
		Object.keys(error.fields).length > 0
	) {
		return Object.values(error.fields)[0]!;
	}
	return errorMessage(error);
}

function failureDescription(failures: readonly string[]) {
	return [
		...failures.slice(0, 2),
		failures.length > 2 ? `${failures.length - 2} more failures` : null,
	]
		.filter(Boolean)
		.join(" ");
}

function withoutFieldErrors(errors: AdminFieldErrors, ...fields: string[]) {
	const next = Object.fromEntries(
		Object.entries(errors).filter(
			([path]) =>
				!fields.some(
					(field) => path === field || path.startsWith(`${field}.`),
				),
		),
	);
	return Object.keys(next).length === Object.keys(errors).length
		? errors
		: next;
}

function withoutRecordError(errors: Record<string, string>, key: string) {
	if (!(key in errors)) return errors;
	const next = { ...errors };
	delete next[key];
	return next;
}

function batchResultSummary(
	results: readonly AdminItemBatchResult[],
	changedLabels: readonly [singular: string, plural: string],
) {
	const changed = results.filter(
		({ outcome }) => outcome === "changed",
	).length;
	const unchanged = results.filter(
		({ outcome }) => outcome === "unchanged",
	).length;
	const skipped = results.filter(
		({ outcome }) => outcome === "skipped",
	).length;
	const failed = results.filter(({ outcome }) => outcome === "failed");
	return {
		changed,
		failed,
		message: [
			changed
				? `${changed} ${changed === 1 ? changedLabels[0] : changedLabels[1]}`
				: null,
			unchanged ? `${unchanged} unchanged` : null,
			skipped ? `${skipped} skipped` : null,
			failed.length ? `${failed.length} failed` : null,
		]
			.filter(Boolean)
			.join(", "),
	};
}

type BatchFeedback = {
	changedLabels: readonly [singular: string, plural: string];
	clearChangedInspector?: boolean;
	emptyMessage: string;
	successDescription?: string;
};

// A submitted version's PDF is read under its own key, which the record's keys don't reach.
const REVIEW_LIVE_ITEM = "admin-review-live-item";

/** Whether an SWR key is one of these records' own, such as its review, DOI choice or Crossref reservation, or a submitted version's PDF. */
const isRecordCacheOf = (keys: ReadonlySet<string>) => (key: unknown) => Array.isArray(key) && (keys.has(String(key[1])) || key[0] === REVIEW_LIVE_ITEM);

/** Whether a read failed because the record no longer exists. */
const isGone = (error: unknown) => error instanceof AdminApiError && error.status === 404;

/** What stays in the inspector after a read failed: the record on screen, unless it is the one that is gone. */
const detailKeptAfterFailure = (current: AdminItemDetail | null, key: string, gone: boolean) => (!gone && current?.key === key ? current : null);

/** Whether the open record is one of these, or the PDF attached to one. */
const showsSent = (keys: ReadonlySet<string>, open: string, detail: AdminItemDetail | null) => keys.has(detail?.parentItem ?? open);

/** A draft, or a Zotero PDF change: a Zotero record whose only change is its PDF has no draft of its own. */
function hasChangeToSubmit(detail: AdminItemDetail) {
	return Boolean(detail.draft) || detail.sourcePdfChangePending;
}

/** A review is always for the whole record, so an attachment submits its record with it. */
/** Where a sent version got to, said once it's there. */
const SENT_TOASTS = {
	published: () => toast.success("Published"),
	confirm: () => toast.info("Sent to the review queue: changing its PDF on Zenodo needs a confirmation there before it publishes."),
	queued: () => toast.success("Sent to the review queue"),
} as const;

/**
 * Approves a review just submitted, with the receipts of the search updates it started. One that changes a PDF already
 * on Zenodo asks for a confirmation the review queue gives, so it waits there for it.
 */
async function approveOrQueue(review: { id: string; revision: number }): Promise<{ outcome: "published" | "confirm"; receipts: readonly AdminSearchIndexReceipt[] }> {
	try {
		return { outcome: "published", receipts: (await approveAdminReview(review.id, review.revision)).indexingReceipts };
	} catch (error) {
		if (error instanceof AdminApiError && error.code === "confirmation_required") return { outcome: "confirm", receipts: [] };
		throw error;
	}
}

/** The confirmation's title and button for sending a version on. */
const sendDialog = (publish: boolean) =>
	publish
		? { title: "Publish this version?", confirmLabel: "Publish" }
		: { title: "Send this version to the review queue?", confirmLabel: "Send to queue" };

function reviewSubmission(detail: AdminItemDetail, publish: boolean) {
	const message = publish
		? "Readers see this version now. Further edits stay in the working draft."
		: "An Editor reviews this version. Further edits stay in the working draft.";
	return detail.parentItem
		? { reviewKey: detail.parentItem, message: `This attachment goes with its record. ${message}` }
		: { reviewKey: detail.key, message };
}

export default function AdminWorkbench({
	configurationHref,
	definitions,
	initialCollections,
	initialLibrary,
}: {
	/** The library's source settings in OpenScholar. */
	configurationHref: string;
	definitions: AdminSchemaDefinition[];
	/** The first page of the library's own collections as the page was served, or null when it could not be read. */
	initialCollections: AdminCollectionCatalogPage | null;
	/** The sources as the page was served, so the sidebar's list does not arrive after it. */
	initialLibrary: AdminLibrarySnapshot;
}) {
	const { signOutToHome } = useReaderSession();
	const showImportLabel = useBreakpoint("lg");
	const finePointer = useFinePointer();
	const { canPublish } = useAdminSession();
	const { navigation, theme, topics } = useLibraryConfig();
	const homeHref = getRuntimeHomeHref(navigation.links);
	const [library, setLibrary] = useState(initialLibrary);
	// In the address, so OpenScholar can link straight to a source's status.
	const [syncSourceKey, setSyncSourceKey] = useQueryState("source", parseAsString);
	const syncSource =
		library.sources.find(({ key }) => key === syncSourceKey) ?? null;
	const [detail, setDetail] = useState<AdminItemDetail | null>(null);
	// "Pick from the table" mode for record links: which kind, for which record.
	// `kind: null` means picking is finished but the record stays pinned in the
	// inspector until the editor selects another row, so a search filter used
	// while picking cannot swap the open draft away.
	const [linkPick, setLinkPick] = useState<{
		forKey: string;
		kind: AdminItemLinkKind | null;
        review?: ReviewLinkPicker;
	} | null>(null);
	const {
		preferences: itemTablePreferences,
		requestedColumns,
		resetPreferences: resetItemTablePreferences,
		setPreferences: setItemTablePreferences,
	} = useAdminItemTablePreferences();
	const {
		bulkKeys,
		error: listError,
		filters,
		hasMore,
		items,
		loading: listLoading,
		loadItems,
		nextCursor,
		placeHeld,
		refreshItems,
		selectedKey,
		setBulkKeys,
		setFilters,
		setItems,
		setSelectedKey,
	} = useAdminItemList(requestedColumns, Boolean(linkPick?.kind), Boolean(linkPick));
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	// The open record no longer exists: removed by someone else while it was open, or opened from an old link.
	const [detailGone, setDetailGone] = useState(false);
	const [draftPayload, setDraftPayload] = useState<Record<string, unknown>>(
		{},
	);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [previewing, setPreviewing] = useState(false);
	// The record the page is drawn for while the preview is closed: from a hover on its button, so it opens drawn, until
	// the slide away after closing ends. A closed pane holds nothing, so nothing rebuilds a page nobody is looking at.
	const [previewFor, setPreviewFor] = useState<string | null>(null);
	const [previewPane, setPreviewPane] = useState<HTMLElement | null>(null);
	const [previewZoom, setPreviewZoom] = useState(DEFAULT_PREVIEW_ZOOM);
	// A new save draws the preview again from the saved draft.
	const [previewRevision, setPreviewRevision] = useState(0);
	const wideLayout = useBreakpoint("xl");
	const pushedAside = previewing && wideLayout && Boolean(selectedKey);
	const previewStrip = useRef<HTMLDivElement>(null);
	// The wide layout slides the preview in beside the editor. The slide starts in the frame after the press, and the
	// page draws its new state once the slide is already running, because a transform animation carries on without
	// waiting for that work. Narrower layouts show one pane at a time, so there the preview is a pane of its own.
	const slidePreview = (open: boolean) => {
		previewStrip.current?.setAttribute("data-preview", open ? "open" : "");
		requestAnimationFrame(() => setTimeout(() => setPreviewing(open)));
	};
	const showPreview = (open: boolean) => {
		setPreviewFor(selectedKey);
		if (wideLayout) slidePreview(open);
		else setMobilePane(open ? "preview" : "inspector");
		// As long as the slide, duration-500 on the strip.
		if (!open) setTimeout(() => setPreviewFor(null), 500);
	};
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] = useState<AdminFieldErrors>(
		{},
	);
	const [validationRevision, setValidationRevision] = useState(0);
	const [busy, setBusy] = useState(false);
	const [recordAssignment, setRecordAssignment] =
		useState<RecordAssignment | null>(null);
	const [mobilePane, setMobilePane] = useState<
		"inspector" | "list" | "navigation" | "preview"
	>(() => selectedKey ? "inspector" : "list");
	const previewOpen = wideLayout ? previewing : mobilePane === "preview";
	// The digests view. The open edition is in the address, so a link opens it.
	const [digestsParam, setDigestsParam] = useQueryState("digests", parseAsString);
	const digests = useAdminDigests(digestsParam, (value) => void setDigestsParam(value));
	const digestsOpen = digestsParam !== null;
	const digestsShow = digests.query.show;
	const { setQuery: setDigestsQuery, refresh: refreshDigests } = digests;
	// Records have no digest state: it leaves the address with the digests.
	const forgetDigestsShow = useCallback(() => setDigestsQuery((query) => ({ ...query, show: "all" })), [setDigestsQuery]);
	const selectNavigationFilter = useCallback((next: Parameters<typeof setFilters>[0]) => {
		// Leaving the digests for records keeps the state the digests were narrowed to, where records have it too.
		setFilters(digestsOpen ? (current) => {
			const chosen = typeof next === "function" ? next(current) : next;
			const state = recordStateFor(digestsShow);
			return { ...chosen, filters: setSingleAdminItemFilter(chosen.filters, "state", state === "all" ? null : state) };
		} : next);
		// Only when the digests view is open: an address update on every keystroke of a search races with the
		// filters' own, and typed characters are lost.
		if (digestsOpen) {
			void setDigestsParam(null);
			forgetDigestsShow();
		}
		setMobilePane("list");
	}, [setFilters, digestsOpen, digestsShow, setDigestsParam, forgetDigestsShow]);
	const [newItemOpen, setNewItemOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	// The library's PDF import reads on the server; its status shows on the Import button wherever the admin is open.
	usePdfImportStatus();
	const importLabel = importButtonLabel(useImportBatch());
	const [newItemSearch, setNewItemSearch] = useState("");
	const [collectionDialog, setCollectionDialog] =
		useState<CollectionDialog | null>(null);
	const [collectionName, setCollectionName] = useState("");
	const [collectionParent, setCollectionParent] = useState<string | null>(
		null,
	);
	const [collectionSourceConnectionKey, setCollectionSourceConnectionKey] =
		useState(NATIVE_SOURCE_CONNECTION_KEY);
	const [collectionParentEntry, setCollectionParentEntry] =
		useState<AdminCollectionCatalogEntry | null>(null);
	const [collectionParentLocation, setCollectionParentLocation] =
		useState<CollectionLocation | null>(null);
	const [collectionParentPickerOpen, setCollectionParentPickerOpen] =
		useState(false);
	const [collectionErrors, setCollectionErrors] = useState<AdminFieldErrors>(
		{},
	);
	const [moveDialog, setMoveDialog] = useState<MoveDialog | null>(null);
	const [moveParent, setMoveParent] = useState<string | null>(null);
	const [moveParentLocation, setMoveParentLocation] =
		useState<CollectionLocation | null>(null);
	const [moveParentPickerOpen, setMoveParentPickerOpen] = useState(false);
	const [moveDestinationChanged, setMoveDestinationChanged] = useState(false);
	const [moveErrors, setMoveErrors] = useState<AdminFieldErrors>({});
	const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
	const [pdfProgress, setPdfProgress] = useState<Record<string, PdfUploadStep | undefined>>({});
	const createdPdfAttachments = useRef(new Map<string, string>());
	const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(
		null,
	);
	const [writebackDialog, setWritebackDialog] = useState<
		| (WritebackDialogRequest & {
				action: "manage" | "restore" | "unpublish";
				recordKey: string;
		  })
		| null
	>(null);
	const searchIndex = useAdminSearchIndex();
	const editableCollectionSourceKeys = useMemo(
		() =>
			library.sources.flatMap(({ key, readOnly }) =>
				readOnly ? [] : [key],
			),
		[library.sources],
	);
	const bulkAssignmentScope = useMemo(() => {
		if (!bulkKeys.size) return null;
		const selectedItems = items.filter(({ key }) => bulkKeys.has(key));
		if (selectedItems.length !== bulkKeys.size) return null;
		const itemSourceConnectionKeys = [
			...new Set(
			selectedItems.map(({ sourceConnectionKey }) => sourceConnectionKey),
			),
		];
		const sourceByKey = new Map(
			library.sources.map((source) => [source.key, source]),
		);
		// Every selected item must support draft mutations, even when Native is shared.
		if (
			itemSourceConnectionKeys.some(
				(key) => sourceByKey.get(key)?.readOnly !== false,
			)
		)
			return null;
		const allowedSourceKeys = editableItemCollectionSourceKeysForItems(
			itemSourceConnectionKeys,
			library.sources,
		);
		if (allowedSourceKeys.length === 0) return null;
		return {
			initialSourceConnectionKey:
				itemSourceConnectionKeys.length === 1
					? itemSourceConnectionKeys[0]!
					: NATIVE_SOURCE_CONNECTION_KEY,
			itemSourceConnectionKeys,
		};
	}, [bulkKeys, items, library.sources]);

	const detailRequest = useRef(0);
	const moveLocationButtonRef = useRef<HTMLButtonElement>(null);
	const selectedKeyRef = useRef<string | null>(null);
	const detailRef = useRef<AdminItemDetail | null>(null);
	const detailGoneRef = useRef(false);
	const detailLoadingRef = useRef(false);
	const draftPayloadRef = useRef<Record<string, unknown>>({});
	const saveQueue = useRef<Promise<void>>(Promise.resolve());
	const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const saveGeneration = useRef(new Map<string, number>());
	const pendingPayloadByKey = useRef(
		new Map<
			string,
			{ generation: number; payload: Record<string, unknown> }
		>(),
	);
	const revisionByKey = useRef(new Map<string, number>());
	const draftGenerationByKey = useRef(new Map<string, string>());
	const savedPayloadByKey = useRef(new Map<string, string>());
	const saveFailureByKey = useRef(
		new Map<
			string,
			{
				fields: AdminFieldErrors;
				message: string;
				state: SaveState;
				conflictingDraft?: ConflictingDraft;
			}
		>(),
	);
	const serverReloadKeys = useRef(new Map<string, number>());
	const busyOperations = useRef(0);
	const mobilePaneMounted = useRef(false);
	selectedKeyRef.current = selectedKey;
	detailRef.current = detail;
	detailGoneRef.current = detailGone;
	detailLoadingRef.current = detailLoading;
	draftPayloadRef.current = draftPayload;

	useEffect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	useEffect(() => {
		const failure = selectedKey
			? saveFailureByKey.current.get(selectedKey)
			: undefined;
		setValidationErrors(failure?.fields ?? {});
		setSaveState(failure?.state ?? "idle");
		setSaveMessage(failure?.message ?? null);
	}, [selectedKey]);

	useEffect(() => {
		if (!mobilePaneMounted.current) {
			mobilePaneMounted.current = true;
			return;
		}
		if (window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY).matches) return;
		const frame = requestAnimationFrame(() => {
			if (document.activeElement?.id !== "admin-record-search") {
				document.getElementById(`admin-${mobilePane}-pane`)?.focus();
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [mobilePane]);

	/** Reads the sources again. `quiet` is for a change someone else made: a read that fails then waits for the next change. */
	const loadLibrary = useCallback(async (quiet = false) => {
		try {
			const next = await getAdminLibrary();
			// The same answer keeps the same object, so nothing below is drawn again for it.
			setLibrary((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
		} catch (error) {
			if (!quiet) toast.error(errorMessage(error));
		}
	}, []);

	// The page comes with the sources as they were when it was served. They are
	// read again once it is open, so an import that started since shows at once.
	useEffect(() => {
		void loadLibrary();
	}, [loadLibrary]);

	// A source someone connects, pauses or starts, and a collection that comes or goes, show as they happen.
	useAdminLive(["sources", "collections"], () => loadLibrary(true), 2_000);
	// A collection's name on records and in the picker is kept apart from the tree, and is read again with it.
	useAdminLive(["collections"], noteAdminCollectionsChangedElsewhere, 2_000);

	// An import's progress is counted from work the page isn't told about row by row, so while one runs, or its dialog
	// is open, the sidebar reads it on a timer. Otherwise it still reads once a minute: a source worker that stopped
	// without a word fails once its lease runs out, which changes nothing in the database for the page to hear.
	const watchingImport =
		Boolean(syncSource?.activity) ||
		library.sources.some(({ activity }) => activity?.state === "running");
	useEffect(() => {
		const timer = setInterval(() => void loadLibrary(true), watchingImport ? ADMIN_SOURCE_SYNC_POLL_MS : ADMIN_LIBRARY_POLL_MS);
		return () => clearInterval(timer);
	}, [loadLibrary, watchingImport]);

	const abandonPendingDraft = useCallback((key: string) => {
		const timer = saveTimers.current.get(key);
		if (timer) clearTimeout(timer);
		saveTimers.current.delete(key);
		pendingPayloadByKey.current.delete(key);
		saveGeneration.current.set(
			key,
			(saveGeneration.current.get(key) ?? 0) + 1,
		);
		revisionByKey.current.delete(key);
		draftGenerationByKey.current.delete(key);
		savedPayloadByKey.current.delete(key);
		saveFailureByKey.current.delete(key);
	}, []);
	const rememberServerDraft = useCallback((key: string, draft: AdminItemDraft) => {
		revisionByKey.current.set(key, draft.draftRevision);
		draftGenerationByKey.current.set(key, draft.generation);
		savedPayloadByKey.current.set(key, JSON.stringify(draft.payload));
	}, []);

	const applyDetail = useCallback(
		(next: AdminItemDetail, replaceLocal = false) => {
			// Every record reload lands here, after a PDF change or a discard too, so the preview draws the record again.
			setPreviewRevision((revision) => revision + 1);
			const generationChanged = Boolean(
				next.draft &&
					draftGenerationByKey.current.has(next.key) &&
					draftGenerationByKey.current.get(next.key) !== next.draft.generation,
			);
			const replaceKnownDraft = replaceLocal || generationChanged;
			if (replaceKnownDraft) abandonPendingDraft(next.key);
			const knownRevision = revisionByKey.current.get(next.key);
			const staleDraft =
				!replaceKnownDraft &&
				next.draft &&
				knownRevision !== undefined &&
				next.draft.draftRevision < knownRevision;
			const pending = pendingPayloadByKey.current.get(next.key);
			if (staleDraft && next.draft) {
				let latestPayload = pending?.payload ?? next.draft.payload;
				const savedPayload = savedPayloadByKey.current.get(next.key);
				if (!pending && savedPayload) {
					try {
						latestPayload = JSON.parse(savedPayload) as Record<
							string,
							unknown
						>;
					} catch {
						latestPayload = next.draft.payload;
					}
				}
				const latestTitle =
					typeof latestPayload.title === "string"
						? latestPayload.title.trim() || "Untitled"
						: next.title;
				setDetail({
					...next,
					draft: {
						...next.draft,
						draftRevision: knownRevision,
						payload: latestPayload,
					},
					itemType: String(latestPayload.itemType ?? next.itemType),
					title: latestTitle,
				});
				setDraftPayload(latestPayload);
				if (!pending) {
					setSaveState("idle");
					setSaveMessage(null);
				}
				return true;
			}
			if (pending && next.draft) {
				if (knownRevision === undefined) {
					rememberServerDraft(next.key, next.draft);
				}
				const pendingPayload = pending.payload;
				const pendingTitle =
					typeof pendingPayload.title === "string"
						? pendingPayload.title.trim() || "Untitled"
						: next.title;
				setDetail({
					...next,
					draft: { ...next.draft, payload: pendingPayload },
					itemType: String(pendingPayload.itemType ?? next.itemType),
					title: pendingTitle,
				});
				setDraftPayload(pendingPayload);
				const failure = saveFailureByKey.current.get(next.key);
				if (failure) {
					setValidationErrors(failure.fields);
					setSaveState(failure.state);
					setSaveMessage(failure.message);
				}
				return true;
			}
			if (pending && !next.draft) {
				abandonPendingDraft(next.key);
			}
			if (next.draft) {
				rememberServerDraft(next.key, next.draft);
			} else {
				revisionByKey.current.delete(next.key);
				draftGenerationByKey.current.delete(next.key);
				savedPayloadByKey.current.delete(next.key);
			}
			const payload = editablePayloadFromDetail(next, definitions);
			setDetail(next);
			if (
				shouldClearAdminValidationErrors({
					currentKey: detailRef.current?.key,
					currentPayload: draftPayloadRef.current,
					nextKey: next.key,
					nextPayload: payload,
					replaceLocal: replaceKnownDraft,
				})
			) {
				setValidationErrors({});
			}
			setDraftPayload(payload);
			setSaveState(pending && !next.draft ? "error" : "idle");
			setSaveMessage(
				pending && !next.draft
					? "The server draft no longer exists. Reopen it before editing."
					: null,
			);
			return true;
		},
		[abandonPendingDraft, definitions, rememberServerDraft],
	);

	/**
	 * A record that couldn't be read. One that is gone leaves nothing to act on: its fields and buttons go, and what
	 * was typed into it stops being saved. Any other failure keeps what is on screen, so nothing typed is lost to a
	 * bad connection.
	 */
	const showDetailFailure = useCallback(
		(key: string, error: unknown) => {
			const gone = isGone(error);
			// Said as the digests say it: nobody asked for the record, it went while they were on it.
			const message = gone ? "This record is no longer available." : errorMessage(error);
			if (gone) abandonPendingDraft(key);
			setDetail((current) => detailKeptAfterFailure(current, key, gone));
			setDetailGone(gone);
			setDetailError(message);
			toast.error(message);
		},
		[abandonPendingDraft],
	);

	const loadDetail = useCallback(
		async (key: string, discardLocal = false) => {
			const requestId = ++detailRequest.current;
			setDetailLoading(true);
			setDetailError(null);
			setDetailGone(false);
			if (discardLocal) {
				serverReloadKeys.current.set(
					key,
					(serverReloadKeys.current.get(key) ?? 0) + 1,
				);
				abandonPendingDraft(key);
				await saveQueue.current;
			}
			try {
				const next = await getAdminItem(key);
				if (requestId === detailRequest.current) {
					applyDetail(next, discardLocal);
				}
				return next;
			} catch (error) {
				if (requestId === detailRequest.current) showDetailFailure(key, error);
			} finally {
				if (discardLocal) {
					const remaining =
						(serverReloadKeys.current.get(key) ?? 1) - 1;
					if (remaining > 0) {
						serverReloadKeys.current.set(key, remaining);
					} else {
						serverReloadKeys.current.delete(key);
					}
				}
				if (requestId === detailRequest.current) {
					setDetailLoading(false);
				}
			}
		},
		[abandonPendingDraft, applyDetail, showDetailFailure],
	);

	// The import's finish step sends drafts on, which changes them: what the inspector shows of them is read again, each
	// one's review and identifiers, and the open record when it is one of them or its PDF. Edits not saved yet keep the
	// open record as it is, so they aren't lost.
	const refreshSent = useCallback(
		async (itemKeys: readonly string[]) => {
			const sent = new Set(itemKeys);
			await mutate(isRecordCacheOf(sent));
			const open = selectedKeyRef.current;
			if (open && showsSent(sent, open, detailRef.current) && !pendingPayloadByKey.current.has(open)) await loadDetail(open);
		},
		[loadDetail],
	);


	useEffect(() => {
		if (selectedKey) void loadDetail(selectedKey);
		else {
			detailRequest.current += 1;
			setDetail(null);
			setDetailError(null);
			setDetailGone(false);
			setDetailLoading(false);
		}
	}, [loadDetail, selectedKey]);

	/** A record as the server has it now, or null after a read that failed or found it gone. */
	const readOpenRecord = useCallback(
		async (key: string) => {
			try {
				return await getAdminItem(key);
			} catch (error) {
				// Someone removed it: the inspector says so, as it does when a removed record is opened.
				if (isGone(error) && selectedKeyRef.current === key) void loadDetail(key);
				return null;
			}
		},
		[loadDetail],
	);
	/**
	 * Shows a record read again, unless nothing changed, a load started meanwhile (opening another record starts one),
	 * or the person has typed something that hasn't saved: a record someone just published has no draft left, and
	 * showing it would drop those keystrokes. The save in hand says what happened to them, and its own change reads again.
	 */
	const showRefreshed = useCallback(
		(next: AdminItemDetail, request: number) => {
			if (pendingPayloadByKey.current.has(next.key) || request !== detailRequest.current) return;
			if (JSON.stringify(next) !== JSON.stringify(detailRef.current)) applyDetail(next);
		},
		[applyDetail],
	);
	const readOpenRecordAgain = useCallback(async () => {
		// A load under way lands first. It may have asked before the change that asked for this, so its answer can be
		// the older one, and read before it this one would be overwritten.
		await until(() => !detailLoadingRef.current);
		const key = selectedKeyRef.current;
		// A record that is gone has nothing to read: asking again would only say so again.
		if (!key || detailGoneRef.current) return;
		const request = detailRequest.current;
		const next = await readOpenRecord(key);
		if (next) showRefreshed(next, request);
	}, [readOpenRecord, showRefreshed]);
	const latestReadOpenRecordAgain = useRef(readOpenRecordAgain);
	latestReadOpenRecordAgain.current = readOpenRecordAgain;
	/**
	 * Reads the open record again for a change someone else made. Nothing shows as loading, what is being typed stays,
	 * and a record that didn't change isn't drawn again. Asked for by more than one part of the page, it reads once at
	 * a time.
	 */
	const [refreshDetail] = useState(() => oneAtATime(() => latestReadOpenRecordAgain.current()));

	/** What the inspector reads of the open record besides the record: its review, DOI choice, reservation and publication. */
	const refreshOpenRecordReads = useCallback(() => {
		const open = selectedKeyRef.current;
		if (!open) return;
		const parent = detailRef.current?.parentItem;
		void mutate(isRecordCacheOf(new Set(parent ? [open, parent] : [open])));
	}, []);

	// What other people and the workers change shows without a reload (admin-live.ts): the rows and the open record.
	const readRecords = () => {
		refreshOpenRecordReads();
		return Promise.all([refreshItems(), refreshDetail()]);
	};
	useAdminLive(["records"], readRecords, 1_500);
	// A version someone sends, publishes, returns or takes back, with the count of records waiting. Read apart from
	// the records, so the answer to a submission shows at once while an import or someone's typing keeps those busy.
	useAdminLive(
		["reviews"],
		() => {
			void mutate("admin-review-count");
			return readRecords();
		},
		500,
	);
	// A DOI someone else reserves or registers for the open record, and a publication a worker moves on.
	useAdminLive(["publishing"], refreshOpenRecordReads, 1_500);

	const refreshCurrent = useCallback(
		async (detailKey: string | null = selectedKeyRef.current) => {
			await Promise.all([
				loadLibrary(),
				loadItems(),
				// The digest list says for itself when it cannot be read; it must not fail a refresh of the records.
				refreshDigests().catch(() => undefined),
				detailKey ? loadDetail(detailKey) : Promise.resolve(),
			]);
		},
		[loadDetail, loadItems, loadLibrary, refreshDigests],
	);

	const executeSave = useCallback(
		async (
			key: string,
			payload: Record<string, unknown>,
			generation: number,
		) => {
			if (saveGeneration.current.get(key) !== generation) return;
			const serialized = JSON.stringify(payload);
			if (savedPayloadByKey.current.get(key) === serialized) {
				saveFailureByKey.current.delete(key);
				if (
					pendingPayloadByKey.current.get(key)?.generation ===
					generation
				) {
					pendingPayloadByKey.current.delete(key);
				}
				if (selectedKeyRef.current === key) {
					setValidationErrors({});
					setSaveState("saved");
					setSaveMessage(null);
				}
				return;
			}

			if (selectedKeyRef.current === key) {
				setSaveState("saving");
				setSaveMessage(null);
			}
			try {
				const revision = requiredDraftValue(
					revisionByKey.current,
					key,
					"Draft revision",
				);
				const expectedDraftGeneration = requiredDraftValue(
					draftGenerationByKey.current,
					key,
					"Draft generation",
				);
				const expectedSerialized = requiredDraftValue(
					savedPayloadByKey.current,
					key,
					"Saved draft payload",
				);
				const expectedPayload = JSON.parse(
					expectedSerialized,
				) as Record<string, unknown>;
				const saved = await saveAdminDraft(
					key,
					expectedDraftGeneration,
					revision,
					expectedPayload,
					payload,
				);
				revisionByKey.current.set(key, saved.draftRevision);
				draftGenerationByKey.current.set(key, saved.generation);
				savedPayloadByKey.current.set(
					key,
					JSON.stringify(saved.payload),
				);
				saveFailureByKey.current.delete(key);
				const pending = pendingPayloadByKey.current.get(key);
				if (pending && pending.generation !== generation) {
					const changesAfterRequest = createItemDraftPatch(
						payload,
						pending.payload,
					);
					const rebasedPayload = applyItemDraftPatch(
						saved.payload,
						changesAfterRequest,
					);
					pendingPayloadByKey.current.set(key, {
						...pending,
						payload: rebasedPayload,
					});
					if (selectedKeyRef.current === key) {
						setDetail((current) =>
							current?.key === key
								? {
										...current,
										draft: {
											...saved,
											payload: rebasedPayload,
										},
									}
								: current,
						);
						setDraftPayload((current) =>
							JSON.stringify(current) === JSON.stringify(rebasedPayload) ? current : rebasedPayload,
						);
					}
					return;
				}
				if (selectedKeyRef.current === key) {
					setDetail((current) =>
						current?.key === key
							? { ...current, draft: saved }
							: current,
					);
					setDraftPayload((current) =>
						JSON.stringify(current) === JSON.stringify(saved.payload) ? current : saved.payload,
					);
				}
				if (pending?.generation === generation) {
					pendingPayloadByKey.current.delete(key);
				}
				// Even for a record no longer selected: an attachment's preview is its parent's page.
				setPreviewRevision((revision) => revision + 1);
				if (selectedKeyRef.current === key) {
					setValidationErrors({});
					setSaveState("saved");
					setSaveMessage(null);
				}
			} catch (error) {
				if (saveGeneration.current.get(key) !== generation) return;
				const failure = {
					conflictingDraft: error instanceof AdminApiError ? error.conflictingDraft : undefined,
					fields:
						error instanceof AdminApiError &&
						(error.code === "validation_failed" || error.status === 409)
							? error.fields
							: {},
					message: errorMessage(error),
					state:
						error instanceof AdminApiError && error.status === 409
							? ("conflict" as const)
							: ("error" as const),
				};
				saveFailureByKey.current.set(key, failure);
				if (selectedKeyRef.current === key) {
					setValidationErrors(failure.fields);
					setSaveState(failure.state);
					setSaveMessage(failure.message);
				} else {
					toast.error(`Could not save draft ${key}`, {
						description: errorMessage(error),
					});
				}
				throw error;
			}
		},
		[],
	);

	const queueDraftSave = useCallback(
		(key: string, payload: Record<string, unknown>, immediate = false) => {
			const generation = (saveGeneration.current.get(key) ?? 0) + 1;
			saveGeneration.current.set(key, generation);
			pendingPayloadByKey.current.set(key, { generation, payload });
			const existingTimer = saveTimers.current.get(key);
			if (existingTimer) clearTimeout(existingTimer);

			const queue = () => {
				saveTimers.current.delete(key);
				const next = saveQueue.current.then(() => {
					const pending = pendingPayloadByKey.current.get(key);
					const queuedPayload =
						pending?.generation === generation
							? pending.payload
							: payload;
					return executeSave(key, queuedPayload, generation);
				});
				saveQueue.current = next.catch(() => undefined);
				return next;
			};
			if (immediate) return queue();
			saveTimers.current.set(
				key,
				setTimeout(() => {
					void queue().catch(() => undefined);
				}, 700),
			);
			return Promise.resolve();
		},
		[executeSave],
	);

	const flushDraft = useCallback(
		(key: string, fallback?: Record<string, unknown>) => {
			const payload =
				pendingPayloadByKey.current.get(key)?.payload ?? fallback;
			return payload
				? queueDraftSave(key, payload, true)
				: Promise.resolve();
		},
		[queueDraftSave],
	);

	useEffect(
		() => () => {
			for (const timer of saveTimers.current.values()) {
				clearTimeout(timer);
			}
		},
		[],
	);

	const updatePayload = useCallback(
		(update: SetStateAction<Record<string, unknown>>) => {
			const detail = detailRef.current;
			const draftPayload = draftPayloadRef.current;
			if (!detail?.draft || detail.key !== selectedKeyRef.current) return;
			const next = typeof update === "function" ? update(draftPayload) : update;
			let normalized = next;
			const currentType = String(
				draftPayload.itemType ?? detail.itemType,
			);
			const nextType = String(next.itemType ?? currentType);
			if (nextType !== currentType) {
				const nextDefinition = definitions.find(
					(entry) => entry.itemType === nextType,
				);
				if (nextDefinition) {
					normalized = payloadForItemType(next, nextDefinition);
				}
			}
			if (!saveFailureByKey.current.get(detail.key)?.conflictingDraft)
				setValidationErrors((current) =>
					clearChangedAdminFieldErrors(current, draftPayload, normalized),
				);
			draftPayloadRef.current = normalized;
			setDraftPayload(normalized);
			const title =
				typeof normalized.title === "string"
					? normalized.title.trim() || "Untitled"
					: detail.title;
			const itemType = String(normalized.itemType ?? detail.itemType);
			setDetail((current) =>
				current && (current.title !== title || current.itemType !== itemType)
					? { ...current, itemType, title }
					: current,
			);
			setItems((current) => {
				const index = current.findIndex((record) => record.key === detail.key);
				const record = current[index];
				if (!record) return current;
				const state = record.state === "deleted" ? "deleted" : record.revision ? "edited" : "draft";
				if (record.title === title && record.itemType === itemType && record.state === state) return current;
				const next = [...current];
				next[index] = { ...record, itemType, state, title };
				return next;
			});
			if (!saveFailureByKey.current.get(detail.key)?.conflictingDraft) {
				setSaveState("idle");
				setSaveMessage(null);
			}
			void queueDraftSave(detail.key, normalized);
		},
		[definitions, queueDraftSave],
	);

	// Pick mode is only live while the same record is still open as a draft.
	const activeLinkPick =
		linkPick?.kind && (detail?.draft || linkPick.review) && linkPick.forKey === detail?.key
			? linkPick.kind
			: null;
	// Titles of rows picked so far, kept even after a search scrolls them out of the list.
	const [pickedLinkTargets, setPickedLinkTargets] = useState<
		ReadonlyMap<string, AdminLinkTarget>
	>(new Map());
	const rememberLinkTargets = useCallback((keys: readonly string[]) => {
			setPickedLinkTargets((current) => {
				const next = new Map(current);
				for (const row of items) {
					if (keys.includes(row.key)) {
						next.set(row.key, pickedItemTarget(row));
					}
				}
				return next;
			});
	}, [items]);
	const addDraftLinkKeys = useCallback(
		(kind: AdminItemLinkKind, keys: readonly string[]) => {
			if (!detail?.draft) return;
            rememberLinkTargets(keys);
			const payload = draftPayloadRef.current;
			const current = linkKeysFromPayload(payload, detail.links.publishedKeys);
			// Links a source owns are already there; the editor does not add a second one.
			const sourceOwned = new Set(
				detail.links.fromSources
					.filter((row) => row.kind === kind)
					.map((row) => row.key),
			);
			const next = [
				...new Set([
					...current[kind],
					...keys.filter((key) => key !== detail.key && !sourceOwned.has(key)),
				]),
			];
			if (next.length === current[kind].length) return;
			updatePayload({ ...payload, links: { ...current, [kind]: next } });
		},
		[detail, rememberLinkTargets, updatePayload],
	);
	const removeDraftLinkKeys = useCallback(
		(kind: AdminItemLinkKind, keys: readonly string[]) => {
            if (!detail?.draft) return;
			const payload = draftPayloadRef.current;
			const current = linkKeysFromPayload(payload, detail.links.publishedKeys);
			const next = current[kind].filter((key) => !keys.includes(key));
			if (next.length === current[kind].length) return;
			updatePayload({ ...payload, links: { ...current, [kind]: next } });
		},
		[detail, updatePayload],
	);
	// In pick mode the table's checkboxes show and change the linked records.
	// Source-owned links show as ticked too; unticking them changes nothing here.
	const draftPickedLinkKeys = useMemo(
		() =>
			activeLinkPick && detail
				? new Set([
						...linkKeysFromPayload(draftPayload, detail.links.publishedKeys)[
							activeLinkPick
						],
						...detail.links.fromSources
							.filter((row) => row.kind === activeLinkPick)
							.map((row) => row.key),
					])
				: null,
		[activeLinkPick, detail, draftPayload],
	);
 const changePickedLinks = (kind: AdminItemLinkKind, keys: readonly string[], selected: boolean) => {
  if (linkPick?.review) {
   rememberLinkTargets(keys);
   const picked = linkPick.review.change(keys, selected);
   setLinkPick({...linkPick, review: {...linkPick.review, keys: picked}});
  } else if (selected) addDraftLinkKeys(kind, keys);
  else removeDraftLinkKeys(kind, keys);
 };
 const addLinkKeys = (kind: AdminItemLinkKind, keys: readonly string[]) => changePickedLinks(kind, keys, true);
 const removeLinkKeys = (kind: AdminItemLinkKind, keys: readonly string[]) => changePickedLinks(kind, keys, false);
 const pickedLinkKeys = activeLinkPick ? linkPick?.review?.keys ?? draftPickedLinkKeys : null;
	const linkTargets = useMemo<AdminLinkTarget[]>(
		() => [
			...pickedLinkTargets.values(),
			...items.map((row) => ({
				deleted: row.state === "deleted",
				itemType: row.itemType,
				key: row.key,
				title: row.title?.trim() || "Untitled record",
			})),
		],
		[items, pickedLinkTargets],
	);
	const stopLinkPick = useCallback(() => {
		setLinkPick((current) => current ? { ...current, kind: null } : null);
		setMobilePane("inspector");
	}, []);
	useEffect(() => {
		// Capture Escape before the record grid consumes it for selection.
		if (!activeLinkPick) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") stopLinkPick();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [activeLinkPick, stopLinkPick]);

	const runBusy = useCallback(
		async (
			operation: () => Promise<void>,
			onError?: (error: unknown) => void,
		) => {
			busyOperations.current += 1;
			if (busyOperations.current === 1) setBusy(true);
			try {
				await operation();
			} catch (error) {
				onError?.(error);
				toast.error(errorMessage(error));
			} finally {
				busyOperations.current = Math.max(
					0,
					busyOperations.current - 1,
				);
				if (busyOperations.current === 0) setBusy(false);
			}
		},
		[],
	);

	const captureInspectorValidation = useCallback(
		(recordKey: string, error: unknown) => {
			if (
				recordKey !== selectedKeyRef.current ||
				!(error instanceof AdminApiError) ||
				error.code !== "validation_failed" ||
				Object.keys(error.fields).length === 0
			) {
				return;
			}
			setValidationErrors(error.fields);
			setValidationRevision((current) => current + 1);
			setMobilePane("inspector");
		},
		[],
	);

	const clearRecordErrors = useCallback((keys: readonly string[]) => {
		setFileErrors((current) =>
			keys.reduce((next, key) => withoutRecordError(next, key), current),
		);
	}, []);

	const waitForIndexing = useCallback(
		(result: AdminSearchIndexMutationResult) =>
			searchIndex.trackAndWait(result.indexingReceipts),
		[searchIndex.trackAndWait],
	);


	// Restore and unpublish ask which sources to update first. When
	// the library has no writeback source, or the record is an attachment or
	// note (they follow their parent), the action runs at once.
	const askWritebackSources = (
		action: "manage" | "restore" | "unpublish",
	) => {
		if (!detail) return false;
		const options = detail.parentItem
			? null
			: resolveWritebackDialogOptions(detail.writeback, action);
		if (!options) return false;
		setWritebackDialog({ action, mode: action, options, recordKey: detail.key });
		return true;
	};

	/**
	 * Sends the record on: to the review queue, or, for an Editor or Owner who chooses Publish, through it at once,
	 * submitted and approved in one step as PDF import does.
	 */
	const sendCurrent = (publish: boolean) => {
        if (!detail || !hasChangeToSubmit(detail)) return;
        const recordKey = detail.key;
        const { reviewKey, message } = reviewSubmission(detail, publish);
        // Set once the attachment's own edits are saved: a failure after that is the record's, shown on the record.
        let attachmentSaved = false;
        setConfirmDialog({...sendDialog(publish), message, action: async () => {
            if (detail.draft) await flushDraft(recordKey, draftPayload);
            attachmentSaved = true;
            await sendVersion(recordKey, reviewKey, publish);
        },
        // A record that isn't ready opens beside the error, with what it still needs.
        onError: reviewKey === recordKey ? undefined : () => { if (attachmentSaved) setSelectedKey(reviewKey); }});
    };

	/** Submits the version for review and, when publishing, approves it, then shows where it stands. */
	const sendVersion = async (recordKey: string, reviewKey: string, publish: boolean) => {
		// The record's own unsaved edits go with it too.
		if (reviewKey !== recordKey) await flushDraft(reviewKey);
		let sent: { outcome: keyof typeof SENT_TOASTS; indexed: Promise<void> };
		try {
			const review = await submitAdminReview(reviewKey);
			const { outcome, receipts } = publish ? await approveOrQueue(review) : { outcome: "queued" as const, receipts: [] };
			// Readers' search follows the publication, shown as the review queue's Publish shows it.
			sent = { outcome, indexed: searchIndex.trackAndWait(receipts) };
		} finally {
			// Also when approval failed: the version then waits in the review queue, and the record says so, so Publish
			// can't approve that earlier version after the draft changes.
			await mutate(["admin-reviews", reviewKey]);
			await Promise.all([loadDetail(recordKey), loadItems()]);
		}
		SENT_TOASTS[sent.outcome]();
		// The version is out either way: search that didn't follow is said apart, as the review queue's Publish says it.
		void sent.indexed.catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Public search did not update."));
	};

	const manageSources = () => {
		askWritebackSources("manage");
	};

	const confirmWritebackDialog = (sourceKeys: string[]) => {
		const request = writebackDialog;
		if (!request) return;
		setWritebackDialog(null);
		const recordKey = request.recordKey;
		if (request.action === "restore") runRestore(recordKey, sourceKeys);
		else if (request.action === "unpublish") runUnpublish(recordKey, sourceKeys);
		else {
			void runBusy(async () => {
				await setAdminItemWritebackSources(recordKey, sourceKeys);
				toast.success("Sources saved");
				await loadDetail(recordKey);
			});
		}
	};

	const openCurrentDraft = () =>
		void runBusy(async () => {
			if (!detail) return;
			await openAdminDraft(detail.key);
			await Promise.all([loadDetail(detail.key), loadItems()]);
		});

	const runRestore = (recordKey: string, sourceKeys?: string[]) =>
		void runBusy(
			async () => {
				await openAdminDraft(recordKey);
                if (sourceKeys) await setAdminItemWritebackSources(recordKey, sourceKeys);
                await submitAdminReview(detail?.parentItem ?? recordKey);
                await mutate(["admin-reviews", detail?.parentItem ?? recordKey]);
				clearRecordErrors([recordKey]);
				setValidationErrors({});
				toast.success("Restoration submitted for review");
				await Promise.all([loadDetail(recordKey), loadItems()]);
			},
			(error) => captureInspectorValidation(recordKey, error),
		);

	const restoreCurrent = () => {
		if (!detail) return;
		if (canPublish && askWritebackSources("restore")) return;
		runRestore(detail.key);
	};

	const duplicateCurrent = () =>
		void runBusy(async () => {
			if (!detail) return;
			const payload = editablePayloadFromDetail(detail, definitions);
			delete payload.parentItem;
			payload.collections = [];
			// With topics off, the server refuses topics on a new record, so the copy leaves them out.
			if (!topics.enabled) delete payload.topics;
			const created = await createAdminDraft(payload);
			await loadItems();
			setSelectedKey(created.itemKey);
			setMobilePane("inspector");
			toast.success("Draft created");
		});

	const discardCurrent = () => {
		if (!detail?.draft) return;
		setConfirmDialog({
			title: detail.published ? "Discard changes?" : "Delete draft?",
			confirmLabel: detail.published
				? "Discard changes"
				: "Delete permanently",
			message: detail.published
				? "The published record will stay unchanged."
				: "This draft has never been published, so it will be deleted permanently and cannot be restored.",
			danger: !detail.published,
			action: async () => {
				abandonPendingDraft(detail.key);
				await saveQueue.current;
				await discardAdminDraft(detail.key);
				await mutate(["admin-reviews", detail.parentItem ?? detail.key]);
				if (detail.published) {
					await loadDetail(detail.key);
				} else {
					setSelectedKey(detail.parentItem);
					setDetail(null);
				}
				await loadItems();
				toast.success(
					detail.published ? "Changes discarded" : "Draft deleted",
				);
			},
		});
	};

	const runUnpublish = (recordKey: string, removeFromSourceKeys?: string[]) =>
		void runBusy(async () => {
			const result = await unpublishAdminItem(recordKey, removeFromSourceKeys);
			await waitForIndexing(result);
			await Promise.all([loadDetail(recordKey), loadItems()]);
			toast.success("Record unpublished");
		});

	const unpublishCurrent = () => {
		if (!detail) return;
		if (askWritebackSources("unpublish")) return;
		const recordKey = detail.key;
		setConfirmDialog({
			title: "Unpublish record?",
			confirmLabel: "Unpublish record",
			message:
				"It will leave the public community and remain recoverable here.",
			danger: true,
			action: async () => {
				const result = await unpublishAdminItem(recordKey);
				await waitForIndexing(result);
				await Promise.all([loadDetail(recordKey), loadItems()]);
				toast.success("Record unpublished");
			},
		});
	};

	const createAttachment = () =>
		void runBusy(async () => {
			if (!detail || detail.itemType === "Attachment") return;
			const created = await createAdminDraft({
				collections: [],
				itemType: "attachment",
				parentItem: detail.key,
				tags: [],
				title: "PDF attachment",
			});
			await loadDetail(detail.key);
			setSelectedKey(created.itemKey);
			setMobilePane("inspector");
			toast.success("Attachment draft created");
		});

	const uploadPdf = (key: string, file: File, parent?: AdminItemDetail) => {
		// The ref also blocks a second file-chooser event before React renders busy.
		if (busyOperations.current) return;
		void runBusy(
			async () => {
				setFileErrors((current) => withoutRecordError(current, key));
				validatePdf(file);
				setPdfProgress((current) => ({
					...current,
					[key]: "Preparing",
				}));
				let attachmentKey = key;
				try {
					if (parent) {
						await flushDraft(parent.key);
						if (!parent.draft) await openAdminDraft(parent.key);
						const existing = documentAttachment(parent, true);
						attachmentKey =
							existing?.sourceConnectionKey === "native"
								? existing.key
								: (createdPdfAttachments.current.get(
										parent.key,
									) ?? "");
						if (!attachmentKey) {
							const created = await createAdminDraft({
								collections: [],
								itemType: "attachment",
								parentItem: parent.key,
								tags: [],
								title: file.name,
							});
							attachmentKey = created.itemKey;
							createdPdfAttachments.current.set(
								parent.key,
								attachmentKey,
							);
						}
					}
					await uploadPdfFile(attachmentKey, file, (step) =>
						setPdfProgress((current) => ({
							...current,
							[key]: step,
						})),
					);
					toast.success("PDF added to the working draft");
				} finally {
					// Keep the attachment after a failed upload so a retry uses the same draft.
					try {
						const refreshed =
							selectedKeyRef.current === key
								? await loadDetail(key)
								: await getAdminItem(key).catch(
										() => undefined,
									);
						if (refreshed)
							createdPdfAttachments.current.delete(key);
						await loadItems();
					} finally {
						setPdfProgress((current) => ({
							...current,
							[key]: undefined,
						}));
					}
				}
			},
			(error) =>
				setFileErrors((current) => ({
					...current,
					[key]: fileErrorMessage(error),
				})),
		);
	};

	const discardPdfDraft = (key: string) => {
		setConfirmDialog({
			danger: true,
			title: "Discard staged PDF?",
			confirmLabel: "Discard staged PDF",
			message:
				"The staged PDF will be removed. Any currently published PDF will stay online.",
			action: async () => {
				await discardAdminPdfDraft(key);
				setFileErrors((current) => withoutRecordError(current, key));
				if (detail) await loadDetail(detail.key);
				await loadItems();
				toast.success("Staged PDF discarded");
			},
			onError: (error) =>
				setFileErrors((current) => ({
					...current,
					[key]: fileErrorMessage(error),
				})),
		});
	};

    const stageSourcePdf = (key: string) => void runBusy(async () => {
        await stageAdminSourcePdf(key);
        setFileErrors(current => withoutRecordError(current, key));
        if (detail) await loadDetail(detail.key);
        await loadItems();
        toast.success("PDF added to the working draft");
    }, error => setFileErrors(current => ({...current, [key]: fileErrorMessage(error)})));

    const changePdfRemoval = (key: string) => void runBusy(async () => {
        const record = detail?.key === key ? detail : detail?.attachments.find(attachment => attachment.key === key);
        if (!record) return;
        const remove = !record.fileRemovalPending;
        await setAdminPdfRemoval(key, remove);
        setFileErrors(current => withoutRecordError(current, key));
        if (detail) await loadDetail(detail.key);
        await loadItems();
        toast.success(remove ? "PDF removal saved in draft" : "PDF removal undone");
    }, error => setFileErrors(current => ({...current, [key]: fileErrorMessage(error)})));

	const selectedCollectionFilter = singleAdminItemFilterValue(
		filters.filters,
		"collections",
	);
	const collectionFilter = selectedCollectionFilter ?? null;
	const selectedSourceFilter = singleAdminItemFilterValue(
		filters.filters,
		"source",
	);
	const sourceFilter =
		selectedSourceFilter === undefined ? "all" : selectedSourceFilter;
	const selectedStateFilter = singleAdminItemFilterValue(
		filters.filters,
		"state",
	);
	const stateFilter = (
		selectedStateFilter === undefined ? "all" : selectedStateFilter
	) as AdminRecordState | "all" | null;

	const openCreateCollection = useCallback((
		parentCollection: AdminCollectionCatalogEntry | null,
	) => {
		const requestedSource =
			parentCollection?.sourceConnectionKey ?? sourceFilter;
		const sourceConnectionKey =
			requestedSource &&
			library.sources.some(
				({ key, readOnly }) => key === requestedSource && !readOnly,
			)
				? requestedSource
				: NATIVE_SOURCE_CONNECTION_KEY;
		setCollectionErrors({});
		setCollectionDialog({
			mode: "create",
			parentCollection: parentCollection?.key ?? null,
		});
		setCollectionName("");
		setCollectionSourceConnectionKey(sourceConnectionKey);
		setCollectionParent(parentCollection?.key ?? null);
		setCollectionParentEntry(parentCollection);
		setCollectionParentLocation(
			parentCollection
				? collectionLocationFromCatalog(
						parentCollection,
						library.sources,
					)
				: null,
		);
		setCollectionParentPickerOpen(false);
	}, [library.sources, sourceFilter]);
	const openRenameCollection = useCallback((collection: AdminCollectionCatalogEntry) => {
		setCollectionErrors({});
		setCollectionDialog({ collection, mode: "rename" });
		setCollectionName(collection.name);
		setCollectionParentPickerOpen(false);
	}, []);
	const openMoveCollection = useCallback((collection: AdminCollectionCatalogEntry) => {
		setMoveErrors({});
		setMoveDialog({ collection });
		setMoveParent(collection.parentCollection);
		setMoveParentLocation(
			parentCollectionLocation(collection, library.sources),
		);
		setMoveParentPickerOpen(false);
		setMoveDestinationChanged(false);
	}, [library.sources]);
	const closeMoveParentPicker = () => {
		setMoveParentPickerOpen(false);
		window.requestAnimationFrame(() =>
			moveLocationButtonRef.current?.focus(),
		);
	};

	const submitCollection = () =>
		void runBusy(
			async () => {
				if (!collectionName.trim() || !collectionDialog) return;
				let focusKey: string;
				if (collectionDialog.mode === "rename") {
					const result = await renameAdminCollection(
						collectionDialog.collection.key,
						{
							expectedRevision:
								collectionDialog.collection.revision,
							name: collectionName,
						},
					);
					await waitForIndexing(result);
					focusKey = result.collection.key;
					toast.success("Collection renamed");
				} else {
					const result = await createAdminCollection({
						name: collectionName,
						parentCollection: collectionParent,
						sourceConnectionKey: collectionSourceConnectionKey,
					});
					await waitForIndexing(result);
					focusKey = result.collection.key;
					if (collectionParentEntry) {
						expandAdminCollections([
							...collectionParentEntry.ancestors.map(
								({ key }) => key,
							),
							collectionParentEntry.key,
						]);
					}
					toast.success("Collection created");
				}
				invalidateAdminCollectionCatalogue();
				focusAdminCollection({ key: focusKey });
				setCollectionDialog(null);
				await refreshCurrent();
			},
			(error) => setCollectionErrors(formErrors(error)),
		);

	const submitCollectionForm = (event: FormEvent) => {
		event.preventDefault();
		if (collectionParentPickerOpen || !collectionName.trim() || busy)
			return;
		submitCollection();
	};

	const submitCollectionMove = () =>
		void runBusy(
			async () => {
				if (!moveDialog) return;
				const result = await moveAdminCollection(
					moveDialog.collection.key,
					moveParent
						? {
								expectedRevision:
									moveDialog.collection.revision,
								position: "inside",
								targetCollection: moveParent,
							}
						: {
								expectedRevision:
									moveDialog.collection.revision,
								position: "root",
							},
				);
				await waitForIndexing(result);
				invalidateAdminCollectionCatalogue();
				focusAdminCollection({ key: moveDialog.collection.key });
				setMoveDialog(null);
				await refreshCurrent();
				toast.success(
					result.collections.length
						? "Collection moved"
						: "Collection is already there",
				);
			},
			(error) => setMoveErrors(formErrors(error)),
		);

	const dropCollection = (
		collection: AdminCollectionCatalogEntry,
		destination: CollectionDropDestination,
	) => {
		void runBusy(
			async () => {
				const result = await moveAdminCollection(
					collection.key,
					destination.position === "root"
						? {
								expectedRevision: collection.revision,
								position: "root",
							}
						: {
								expectedRevision: collection.revision,
								position: destination.position,
								targetCollection: destination.targetCollection,
							},
				);
				await waitForIndexing(result);
				invalidateAdminCollectionCatalogue();
				const target =
					destination.position === "root"
						? null
						: destination.targetEntry;
				const ancestors =
					destination.position === "root"
						? []
						: destination.position === "inside" && target
							? [
									...target.ancestors,
									{ key: target.key, name: target.name },
								]
							: (target?.ancestors ?? collection.ancestors);
				focusAdminCollection({
					entry: {
						...result.collection,
						ancestors,
						hasChildren: collection.hasChildren,
					},
					key: collection.key,
				});
				toast.success(
					result.collections.length
						? "Collection moved"
						: "Collection is already there",
				);
			},
			() => {
				invalidateAdminCollectionCatalogue();
				focusAdminCollection({
					entry: collection,
					key: collection.key,
				});
			},
		);
	};

	const removeCollection = useCallback((collection: AdminCollectionCatalogEntry) =>
		setConfirmDialog({
			title: `Delete ${collection.name}?`,
			message:
				"This deletes the collection and its active descendants. Records stay in the community. Restore only brings back collections deleted by this action.",
			confirmLabel: "Delete",
			danger: true,
			action: async () => {
				const result = await deleteAdminCollection(
					collection.key,
					collection.revision,
				);
				await waitForIndexing(result);
				const removedKeys = new Set(
					result.collections.map(({ key }) => key),
				);
				invalidateAdminCollectionCatalogue();
				const selectedCollection = singleAdminItemFilterValue(
					filters.filters,
					"collections",
				);
				if (selectedCollection && removedKeys.has(selectedCollection)) {
					setFilters((current) => ({
						...current,
						filters: setSingleAdminItemFilter(
							current.filters,
							"collections",
							null,
						),
					}));
				}
				await refreshCurrent();
				toast.success("Collection deleted");
			},
		}), [waitForIndexing, filters.filters, setFilters, refreshCurrent]);

	const restoreCollection = useCallback((collection: AdminCollectionCatalogEntry) =>
		setConfirmDialog({
			title: `Restore ${collection.name}?`,
			message:
				"This restores the collection and descendants deleted in the same action. Descendants deleted earlier stay deleted. If its parent is still deleted, the collection returns at the top level.",
			confirmLabel: "Restore",
			action: async () => {
				const result = await restoreAdminCollection(
					collection.key,
					collection.revision,
				);
				await waitForIndexing(result);
				invalidateAdminCollectionCatalogue();
				await refreshCurrent();
				toast.success("Collection restored");
			},
		}), [waitForIndexing, refreshCurrent]);

	const createItem = (definition: AdminSchemaDefinition) =>
		void runBusy(async () => {
			const created = await createAdminDraft({
				collections: [],
				creators: [],
				itemType: definition.itemType,
				tags: [],
			});
			setNewItemOpen(false);
			setNewItemSearch("");
			await loadItems();
			setSelectedKey(created.itemKey);
			setMobilePane("inspector");
			toast.success("Draft created");
		});

	const concurrentConflict = selectedKey
		? saveFailureByKey.current.get(selectedKey)?.conflictingDraft
		: undefined;
	const resolveConcurrentConflict = (
		choices: Record<string, "draft" | "published">,
	) => {
		if (!detail?.draft || !concurrentConflict) return;
		const draft = detail.draft;
		const key = detail.key;
		void runBusy(async () => {
			const canonical = (payload: unknown) => validateNativeItemDraft(payload, { allowIncompleteCreators: true }).payload;
			const expected = canonical(JSON.parse(requiredDraftValue(savedPayloadByKey.current, key, "Saved draft payload")));
			const changes = Object.fromEntries(
				Object.entries(createItemDraftPatch(expected, canonical(draftPayload))).filter(
					([field]) => choices[field] !== "published",
				),
			);
			const canonicalResolved = applyItemDraftPatch(concurrentConflict.payload, changes);
			const resolved = adminCanonicalPayloadToItemFields(canonicalResolved, String(canonicalResolved.itemType));
			rememberServerDraft(key, { ...draft, ...concurrentConflict, payload: adminCanonicalPayloadToItemFields(concurrentConflict.payload, String(concurrentConflict.payload.itemType)) });
			updatePayload(resolved);
			await flushDraft(key, resolved);
			await refreshCurrent(key);
			toast.success("Draft conflicts resolved");
		});
	};

	const reloadConflictedDraft = () => {
		if (!detail || detailLoading) return;
		void loadDetail(detail.key, true);
	};

	const changeSort = (sort: AdminItemSortColumnId) =>
		setFilters((current) => ({
			...current,
			sort,
			sortDirection:
				current.sort === sort && current.sortDirection === "asc"
					? "desc"
					: "asc",
		}));

	const flushBatchDrafts = async (itemKeys: readonly string[]) => {
		const failures: AdminItemBatchResult[] = [];
		for (const key of itemKeys) {
			try {
				await flushDraft(
					key,
					detail?.key === key && detail.draft
						? draftPayload
						: undefined,
				);
			} catch (error) {
				failures.push({
					...(error instanceof AdminApiError
						? { code: error.code, fields: error.fields }
						: {}),
					key,
					indexingReceipts: [],
					message: fileErrorMessage(error),
					outcome: "failed",
				});
			}
		}
		await saveQueue.current;
		const failedKeys = new Set(failures.map(({ key }) => key));
		return {
			failures,
			readyKeys: itemKeys.filter((key) => !failedKeys.has(key)),
		};
	};

	// After importing, the worker attaches each draft's PDF and the server may send it on, with no step taken here; the
	// import's polls report each change. Edits waiting on those drafts are saved first, so reading the table and the
	// open record again loses nothing.
	const readChangedDrafts = useEffectEvent(async (itemKeys: string[]) => {
		await flushBatchDrafts(itemKeys);
		await Promise.all([loadItems(), refreshSent(itemKeys)]);
	});
	useEffect(() => {
		const onChanged = (event: Event) => void readChangedDrafts((event as CustomEvent<string[]>).detail);
		window.addEventListener(IMPORT_DRAFTS_CHANGED_EVENT, onChanged);
		return () => window.removeEventListener(IMPORT_DRAFTS_CHANGED_EVENT, onChanged);
	}, []);

	const executeBatchMutation = async (
		request: AdminItemBatchRequest,
		feedback: BatchFeedback,
		localResults: readonly AdminItemBatchResult[] = [],
	) => {
		const remoteResults =
			request.keys.length > 0
				? (await mutateAdminItems(request)).results
				: [];
		if (request.action === "remove") {
			await mutate(key => Array.isArray(key) && key[0] === "admin-reviews");
		}
		const results = [...localResults, ...remoteResults];
		const indexingCompletion = searchIndex.trackAndWait(
			remoteResults.flatMap(({ indexingReceipts }) => indexingReceipts),
		);
		void indexingCompletion.catch(() => {});
		try {
			const affectedKeys = new Set(results.map(({ key }) => key));
			const failedKeys = new Set(
				results
					.filter(({ outcome }) => outcome === "failed")
					.map(({ key }) => key),
			);
			setBulkKeys(
				(current) =>
					new Set(
						[...current].filter(
							(key) => !affectedKeys.has(key) || failedKeys.has(key),
						),
					),
			);
			const selectedFailure = results.find(
				({ fields, key, outcome }) =>
					key === selectedKeyRef.current &&
					outcome === "failed" &&
					fields &&
					Object.keys(fields).length > 0,
			);
			const selectedChanged = Boolean(
				feedback.clearChangedInspector &&
				results.some(
					({ key, outcome }) =>
						key === selectedKeyRef.current && outcome === "changed",
				),
			);
			if (selectedChanged) {
				setSelectedKey(null);
				setDetail(null);
			}
			await refreshCurrent(selectedChanged ? null : undefined);
			if (selectedFailure?.fields) {
				setValidationErrors(selectedFailure.fields);
				setValidationRevision((current) => current + 1);
				setMobilePane("inspector");
			}
		} finally {
			await indexingCompletion;
		}
		const summary = batchResultSummary(results, feedback.changedLabels);
		if (summary.failed.length) {
			throw new Error([
				summary.message,
				failureDescription(
					summary.failed.map(
						({ key, message }) =>
							`${key}: ${message ?? "Operation failed."}`,
					),
				),
			].join(". "));
		} else if (summary.changed) {
			toast.success(summary.message, {
				description: feedback.successDescription,
			});
		} else {
			toast.info(summary.message || feedback.emptyMessage);
		}
		return results;
	};

	const assignRecordsToCollection = (
		itemKeys: readonly string[],
		collectionKey: string,
	) =>
		void runBusy(async () => {
			const { failures, readyKeys } = await flushBatchDrafts(itemKeys);
			await executeBatchMutation(
				{
					action: "assignCollection",
					collectionKey,
					keys: [...readyKeys],
				},
				{
					changedLabels: ["draft updated", "drafts updated"],
					emptyMessage: "No records were changed",
					successDescription:
						"Submit the drafts for review to update the public community.",
				},
				failures,
			);
		});

	const requestRecordAssignment = (
		itemKeys: string[],
		focusKey: string,
		sourceConnectionKey: string,
	) => {
		setRecordAssignment({
			focusKey,
			initialSourceConnectionKey: sourceConnectionKey,
			itemKeys,
			itemSourceConnectionKeys: [sourceConnectionKey],
		});
	};

	const closeRecordAssignment = () => {
		const focusKey = recordAssignment?.focusKey;
		setRecordAssignment(null);
		if (!focusKey) return;
		requestAnimationFrame(() => {
			focusAdminDragHandle({ key: focusKey, kind: "record" });
		});
	};


	const bulkDelete = () => {
		const keys = [...bulkKeys];
		setConfirmDialog({
			title: `Remove ${keys.length} ${keys.length === 1 ? "record" : "records"}?`,
			confirmLabel: keys.length === 1 ? "Remove record" : "Remove records",
			message:
				"Unpublished drafts will be deleted. Published records will leave the public community. Records synced from external sources are skipped.",
			danger: true,
			action: async () => {
				for (const key of keys) {
					abandonPendingDraft(key);
				}
				await saveQueue.current;
				await executeBatchMutation(
					{ action: "remove", keys },
					{
						changedLabels: ["record removed", "records removed"],
						clearChangedInspector: true,
						emptyMessage: "No records were removed",
					},
				);
			},
		});
	};

	const filteredDefinitions = useMemo(() => {
		const query = newItemSearch.trim().toLowerCase();
		return definitions.filter(
			(definition) =>
				isTopLevelAdminItemType(definition.itemType) &&
				(!query ||
					humanizeAdminField(definition.itemType)
						.toLowerCase()
						.includes(query)),
		);
	}, [definitions, newItemSearch]);


	const digestsWaiting = digests.waiting;
	const { close: showDigestList } = digests;
	const digestsPage = useMemo(() => ({
		selected: digestsOpen,
		waiting: digestsWaiting,
		show: digestsShow,
		// Coming from records, the digests keep the state the records were narrowed to, where digests have it too.
		onOpen: () => {
			if (!digestsOpen) setDigestsQuery((query) => ({ ...query, page: 1, show: digestShowFor(stateFilter) }));
			showDigestList();
			setMobilePane("list");
		},
		onShow: (show: DigestShow) => {
			setDigestsQuery((query) => ({ ...query, page: 1, show }));
			showDigestList();
			setMobilePane("list");
		},
	}), [digestsOpen, digestsWaiting, digestsShow, stateFilter, setDigestsQuery, showDigestList]);
	const navigationPane = useMemo(() => (<AdminNavigation
									reviewQueue={filters.reviewQueue}
									onSelectReviewQueue={() => selectNavigationFilter((current) => ({ ...current, reviewQueue: true, filters: setSingleAdminItemFilter(current.filters, "kind", null) }))}
									kind={filters.reviewQueue ? null : singleAdminItemFilterValue(filters.filters, "kind") ?? "all"}
									onSelectKind={(kind) => selectNavigationFilter((current) => ({
										...current,
										reviewQueue: false,
										filters: setSingleAdminItemFilter(current.filters, "kind", kind === "all" ? null : kind),
									}))}
									collection={collectionFilter}
									isBusy={busy}
									onCreateCollection={openCreateCollection}
									onDeleteCollection={removeCollection}
									onEditCollection={openRenameCollection}
									onMoveCollection={openMoveCollection}
									onOpenSourceSync={setSyncSourceKey}
									onRestoreCollection={restoreCollection}
									onSelectCollection={(collection) =>
										selectNavigationFilter((current) => ({
											...current,
											filters: setSingleAdminItemFilter(
												current.filters,
												"collections",
												collection,
											),
										}))
									}
									onSelectSource={(source) =>
										selectNavigationFilter((current) => ({
											...current,
											filters: setSingleAdminItemFilter(
												current.filters,
												"source",
												source === "all"
													? null
													: source,
											),
										}))
									}
									onSelectState={(state) =>
										selectNavigationFilter((current) => ({
											...current,
											filters: setSingleAdminItemFilter(
												current.filters,
												"state",
												state === "all" ? null : state,
											),
										}))
									}
									source={sourceFilter}
									sources={library.sources}
									state={stateFilter}
								/>), [filters.reviewQueue, filters.filters, selectNavigationFilter, collectionFilter, busy, openCreateCollection, removeCollection, openRenameCollection, openMoveCollection, restoreCollection, sourceFilter, library.sources, stateFilter]);

	return (
		<main data-full-window className="@container/admin fixed inset-x-0 top-0 z-0 flex h-dvh min-h-0 flex-col bg-background_light text-black dark:bg-background dark:text-white">
			<h1 className="sr-only">Community administration</h1>
			<header
				className="admin-toolbar-grid grid shrink-0 items-center gap-2 px-3 py-3 xl:relative xl:flex xl:min-h-16"
				data-admin-region="toolbar"
			>
				<Link
					aria-label="Open community"
					className="col-start-1 row-start-1 flex h-10 min-w-0 max-w-[120px] items-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus xl:mr-1 xl:shrink-0 xl:absolute xl:left-1/2 xl:mr-0 xl:w-36 xl:max-w-none xl:-translate-x-1/2"
					href={homeHref}
				>
					<LibraryLogo className="max-w-full" place="admin" />
				</Link>
				<div className="col-span-3 row-start-2 flex min-w-0 items-center gap-2 admin-toolbar-search sm:col-span-1 sm:col-start-1 xl:min-w-64 xl:max-w-lg xl:flex-1">
					<Input
						color="filled"
						aria-label="Search records"
						id="admin-record-search"
						maxLength={ADMIN_SEARCH_MAX}
						className="min-w-0 flex-1"
						classNames={{
							input: "text-sm",
							inputWrapper: "h-10 min-h-10 rounded-xl",
						}}
						isClearable
						clearButtonLabel="Clear search"
						placeholder="Search title, creator, date or tag"
						startContent={
							<HugeiconsIcon
								icon={Search01Icon}
								aria-hidden
								className="text-black/35 dark:text-white/35"
								size={15}
							/>
						}
						value={filters.query}
						onClear={() =>
							selectNavigationFilter((current) => ({
								...current,
								query: "",
							}))
						}
						onValueChange={(query) =>
							selectNavigationFilter((current) => ({
								...current,
								query,
							}))
						}
					/>
					<AdminItemFilters
						definitions={definitions}
						filters={filters.filters}
						items={items}
						onChange={(nextFilters) =>
							setFilters((current) => ({
								...current,
								filters: nextFilters,
							}))
						}
						sources={library.sources}
					/>
				</div>
				<div
					role="group"
					aria-label="Community panels"
					className="col-span-3 row-start-3 flex min-w-0 rounded-xl bg-black/[0.035] p-1 admin-toolbar-views sm:col-span-2 sm:col-start-2 sm:row-start-2 sm:min-w-72 xl:hidden dark:bg-white/[0.035]"
				>
					{[
						{
							icon: FilterHorizontalIcon,
							key: "navigation" as const,
							label: "Filters",
						},
						{
							icon: Files01Icon,
							key: "list" as const,
							label: "Records",
						},
						{
							icon: FileEditIcon,
							key: "inspector" as const,
							label: "Editor",
						},
					].map((entry) => {
						const Icon = entry.icon;
						return (
							<Button
								key={entry.key}
								aria-controls={`admin-${entry.key}-pane`}
								aria-label={entry.label}
								aria-pressed={mobilePane === entry.key}
								className="h-9 min-w-0 flex-1 gap-2 rounded-lg px-2"
								onPress={() => setMobilePane(entry.key)}
								size="xs"
								variant={
									mobilePane === entry.key
										? "muted"
										: "transparent"
								}
							>
								<HugeiconsIcon
									icon={Icon}
									aria-hidden
									size={18}
									strokeWidth={1.8}
								/>
								{entry.label}
							</Button>
						);
					})}
				</div>
				<div className="hidden flex-1 xl:block" />
				{/* On a phone at large text the community tools take a row of their own (admin-toolbar-tools in globals.css). */}
				<div className="col-start-2 row-start-1 admin-toolbar-tools flex shrink-0 items-center gap-1">
					<div
						aria-label="Community tools"
						className="flex h-10 items-center rounded-xl bg-black/[0.035] dark:bg-white/[0.035]"
						role="group"
					>
						<AdminSearchIndexStatus
							error={searchIndex.error}
							onRefresh={() => void searchIndex.refresh()}
							onRetry={() => void searchIndex.retry()}
							view={searchIndex.view}
						/>
						<AdminPublicPages />
						<ThemeSwitcher
							styleVariant={theme.layout}
							toolbar
							variant="inline"
						/>
						<Tooltip content="Refresh">
							<Button
								aria-label="Refresh"
								className="hidden h-10 min-h-10 w-10 rounded-xl text-black/45 hover:bg-black/[0.05] hover:text-black/80 xl:flex dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
								isIconOnly
								onPress={() => void refreshCurrent()}
								size="xs"
								variant="transparent"
							>
								<HugeiconsIcon
									icon={Refresh01Icon}
									aria-hidden
									size={15}
								/>
							</Button>
						</Tooltip>
						<Tooltip content="Log out">
							<Button
								aria-label="Log out"
								className="h-10 min-h-10 w-10 rounded-xl text-black/45 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
								isIconOnly
								// Signs out here and of OpenScholar, as the reader's menu does, and leaves /admin for the home page.
								onPress={signOutToHome}
								size="xs"
								type="button"
								variant="transparent"
							>
								<HugeiconsIcon
									icon={Logout01Icon}
									aria-hidden
									size={15}
								/>
							</Button>
						</Tooltip>
					</div>
				</div>
				<div className="col-start-3 row-start-1 flex shrink-0 items-center gap-1">
					<div
						aria-label="Add records"
						className="flex items-center overflow-hidden rounded-xl shadow-sm shadow-accent/10"
						role="group"
					>
						<Tooltip content={importLabel.text} isDisabled={showImportLabel}>
							<Button
								aria-label={importLabel.text}
								className={`h-10 min-h-10 w-10 !min-w-10 gap-2 rounded-none px-0 font-medium text-accent lg:w-auto lg:!min-w-0 lg:px-3 ${importLabel.batch ? "lg:!w-[9.5rem]" : ""}`}
								color="secondary"
								isDisabled={busy}
								onPress={() => {
									// The sheet's Collections setting then opens with its list.
									preloadAdminCollections(NATIVE_SOURCE_CONNECTION_KEY);
									setImportOpen(true);
								}}
								size="xs"
								variant="solid"
							>
								<HugeiconsIcon
									icon={importLabel.reading ? Loading03Icon : FileImportIcon}
									aria-hidden
									className={importLabel.reading ? "animate-spin motion-reduce:animate-none" : undefined}
									size={15}
								/>
								<span className="hidden tabular-nums lg:inline">
									{importLabel.text}
								</span>
							</Button>
						</Tooltip>
						<span
							aria-hidden
							className="h-10 w-px shrink-0 bg-white/25"
						/>
						<Popover
							disableAnimation
							isOpen={newItemOpen}
							onOpenChange={(open) => {
								setNewItemOpen(open);
								if (!open) setNewItemSearch("");
							}}
							placement="bottom-end"
						>
							<PopoverTrigger>
								<Button
									aria-label="Create Item"
									className="h-10 min-h-10 w-10 !min-w-10 rounded-none px-0 font-semibold lg:w-auto lg:!min-w-0 lg:px-3"
									color="accent"
									size="xs"
									variant="solid"
								>
									<HugeiconsIcon
										icon={Add01Icon}
										aria-hidden
										size={15}
									/>
									<span className="hidden lg:inline">
										Create Item
									</span>
								</Button>
							</PopoverTrigger>
							<PopoverContent
								aria-label="Create Item"
								className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card"
							>
								<div className="w-full">
									<div className="border-b border-black/[0.06] p-3 dark:border-white/[0.06]">
										<Input
											color="filled"
											aria-label="Find an item type"
											autoFocus={finePointer}
											placeholder="Find an item type"
											startContent={
												<HugeiconsIcon
													icon={Search01Icon}
													aria-hidden
													size={15}
												/>
											}
											value={newItemSearch}
											onValueChange={setNewItemSearch}
										/>
									</div>
									<div className="admin-item-type-list flex flex-col gap-1 overflow-y-auto p-1">
										{filteredDefinitions.map(
											(definition) => (
												<button
													key={definition.itemType}
													className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm text-black/70 hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/70 dark:hover:bg-white/[0.05]"
													onClick={() =>
														createItem(definition)
													}
													type="button"
												>
													<HugeiconsIcon
														icon={LibraryIcon}
														aria-hidden
														className="shrink-0 opacity-45"
														size={16}
													/>
													{humanizeAdminField(
														definition.itemType,
													)}
												</button>
											),
										)}
									</div>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</div>
			</header>

			<AdminDragDropRoot
				enabled={!busy}
				onDropCollection={dropCollection}
				onDropRecords={(itemKeys, collectionKey) =>
					assignRecordsToCollection(itemKeys, collectionKey)
				}
			>
				{/* On the wide layout the preview waits under the editor and slides out from beneath it, pushing the filters
				    and records out past the left edge. The three sit on one strip that slides as a whole, so the browser
				    moves it without laying anything out again. The strip is cut off at the editor's right edge, so the
				    waiting preview never shows beside it. The row clips its overflow rather than hiding it, so focus moving
				    within it can't scroll it sideways. */}
				<div className="admin-workbench-grid grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 xl:flex xl:overflow-clip">
					<div className="contents xl:block xl:min-h-0 xl:w-[calc(100vw-24.75rem)] xl:flex-none xl:[clip-path:inset(0_-23.25rem_0_-100vw_round_1rem)]">
					<div
						ref={previewStrip}
						data-preview={pushedAside ? "open" : undefined}
						className="contents xl:flex xl:h-full xl:w-[calc(200vw-48.75rem)] xl:gap-3 xl:transition-transform xl:duration-500 xl:ease-[cubic-bezier(0.32,0.72,0,1)] xl:will-change-transform motion-reduce:transition-none xl:data-[preview=open]:-translate-x-[calc(100vw-24rem)]"
					>
					<div
						aria-hidden={pushedAside || undefined}
						inert={pushedAside}
						className="contents xl:flex xl:min-h-0 xl:w-[calc(100vw-24.75rem)] xl:flex-none xl:gap-3"
					>
					<aside
						id="admin-navigation-pane"
						aria-label="Filters and collections"
						tabIndex={-1}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "navigation" ? "block" : "hidden"
						} xl:block xl:w-60 xl:flex-none`}
					>
						<div className="flex h-full min-h-0 flex-col">
							<div className="flex shrink-0 items-center justify-end gap-2 border-b border-black/[0.06] p-3 xl:hidden dark:border-white/[0.06]">
								<Button
									aria-label="Refresh"
									isIconOnly
									onPress={() => void refreshCurrent()}
									size="xs"
									variant="transparent"
								>
									<HugeiconsIcon icon={Refresh01Icon} aria-hidden size={14} />
								</Button>
							</div>
							<div className="min-h-0 flex-1">
								<FirstCollections value={initialCollections}><DigestsPage value={digestsPage}>{navigationPane}</DigestsPage></FirstCollections>
							</div>
						</div>
					</aside>

					<section
						aria-label={digestsOpen ? "Digests" : "Records"}
						id="admin-list-pane"
						tabIndex={-1}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "list" ? "flex" : "hidden"
						} flex-col xl:flex xl:min-w-0 xl:flex-1`}
					>
						{digestsOpen ? <AdminDigestsMain digests={digests} /> : (<AdminItemTable
							bulkActions={
								activeLinkPick ? null : (
								<div
									aria-label="Bulk actions"
									className="flex h-full min-w-0 items-center gap-1 overflow-hidden"
									role="toolbar"
								>

										<Tooltip
											content={
												bulkAssignmentScope
													? "Add selected to collection"
													: "Select editable records with a shared collection source"
											}
										>
											<Button
												aria-label="Add selected to collection"
												isDisabled={busy || !bulkAssignmentScope}
												isIconOnly
												onPress={() => {
													if (!bulkAssignmentScope)
														return;
													setRecordAssignment({
														focusKey: null,
														itemKeys: [...bulkKeys],
														...bulkAssignmentScope,
													});
												}}
												size="xs"
												variant="transparent"
											>
												<HugeiconsIcon icon={FolderInputIcon} aria-hidden size={14} />
											</Button>
										</Tooltip>
										<Tooltip content={canPublish ? "Remove selected" : "Editors and owners can remove records"}>
											<span className="inline-flex">
												<Button
													aria-label="Remove selected"
													className="text-danger"
													isDisabled={busy || !canPublish || bulkKeys.size === 0}
													isIconOnly
													onPress={bulkDelete}
													size="xs"
													variant="transparent"
												>
													<HugeiconsIcon icon={Delete02Icon} aria-hidden size={14} />
												</Button>
											</span>
										</Tooltip>
										<Tooltip content="Clear selection">
											<Button
												aria-label="Clear selection"
												isDisabled={bulkKeys.size === 0}
												isIconOnly
												onPress={() =>
													setBulkKeys(new Set())
												}
												size="xs"
												variant="transparent"
											>
												<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={14} />
											</Button>
										</Tooltip>
									{bulkKeys.size ? (
										<span className="hidden shrink-0 px-2 text-xs font-medium tabular-nums text-black/55 dark:text-white/60 sm:inline">
											{bulkKeys.size} selected
										</span>
									) : null}
								</div>
								)
							}
							bulkDisabledKey={activeLinkPick ? detail?.key ?? null : null}
							bulkKeys={pickedLinkKeys ?? bulkKeys}
							dragEnabled={!busy}
							error={listError}
							hasMore={hasMore}
							items={items}
							loading={listLoading}
							placeHeld={placeHeld}
							preferences={itemTablePreferences}
							onLoadMore={() => {
								if (nextCursor !== null && !listLoading) {
									void loadItems(nextCursor, true);
								}
							}}
							onRequestCollectionAssignment={
								requestRecordAssignment
							}
							banner={
								activeLinkPick && detail ? (
									<div
										className="flex min-h-9 flex-wrap items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-black/75 dark:text-white/80"
										data-admin-link-pick-banner={activeLinkPick}
										role="status"
									>
										<span className="min-w-0 flex-1">
											Tick or click records to add them under{" "}
											<strong>{activeLinkPick === "cites" ? "References" : "Related"}</strong>{" "}
											for “{detail.title || detail.key}”; click or untick again to remove. Esc to finish.
										</span>
										<Button
											onPress={stopLinkPick}
											size="xs"
											variant="solid"
										>
											Done
										</Button>
									</div>
								) : null
							}
							onRetry={() => void loadItems()}
							onPreferencesChange={setItemTablePreferences}
							onResetPreferences={resetItemTablePreferences}
							onSelect={(key, clicks = 1) => {
								if (activeLinkPick) {
									// A row click toggles the link, same as its checkbox.
									if (pickedLinkKeys?.has(key)) removeLinkKeys(activeLinkPick, [key]);
									else addLinkKeys(activeLinkPick, [key]);
									return;
								}
								// The second click of a double click on a popover that just closed over this row isn't a choice of it.
								if (clicks > 1) return;
								setLinkPick(null);
								setSelectedKey(key);
								setMobilePane("inspector");
							}}
							onSort={changeSort}
							onToggleBulk={(key, selected) => {
								if (activeLinkPick) {
									if (selected) addLinkKeys(activeLinkPick, [key]);
									else removeLinkKeys(activeLinkPick, [key]);
									return;
								}
								setBulkKeys((current) => {
									const next = new Set(current);
									if (selected) next.add(key);
									else next.delete(key);
									return next;
								});
							}}
							onToggleVisible={(selected) => {
								if (activeLinkPick) {
									const visible = items.map(({ key }) => key);
									if (selected) addLinkKeys(activeLinkPick, visible);
									else removeLinkKeys(activeLinkPick, visible);
									return;
								}
								setBulkKeys(
									selected
										? new Set(items.map(({ key }) => key))
										: new Set(),
								);
							}}
							selectedKey={selectedKey}
							sort={filters.sort}
							sortDirection={filters.sortDirection}
							sources={library.sources}
						/>)}
					</section>
					</div>

					<section
						ref={setPreviewPane}
						id="admin-preview-pane"
						aria-label="Public page preview"
						tabIndex={-1}
						aria-hidden={(wideLayout && !pushedAside) || undefined}
						inert={wideLayout && !pushedAside}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "preview" ? "block" : "hidden"
						} xl:block xl:w-[calc(100vw-24.75rem)] xl:flex-none`}
					/>
					</div>
					</div>

					{/* Clip, not hidden: scrollIntoView scrolls a hidden box too, which pushed the inspector's top out of view on a jump to a section. */}
					<aside
						aria-label="Record editor"
						id="admin-inspector-pane"
						tabIndex={-1}
						className={`relative z-10 min-h-0 overflow-clip rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "inspector" ? "block" : "hidden"
						} xl:block xl:w-[22.5rem] xl:flex-none`}
					>
						{digestsOpen ? <AdminDigestsInspector digests={digests} configurationHref={configurationHref} /> : (<EditorialInspector
							concurrentConflict={concurrentConflict}
							onResolveConcurrentConflict={resolveConcurrentConflict}
                            reviewQueue={filters.reviewQueue}
                            onStartReviewLinkPick={(kind, review) => {
                                if (!detail) return;
                                setLinkPick({forKey: detail.key, kind, review});
                                setMobilePane("list");
                            }}
							busy={busy}
							definitions={definitions}
							detail={detail?.key === selectedKey ? detail : null}
							error={detailError}
							fileErrors={fileErrors}
							loading={detailLoading || Boolean(selectedKey && detail?.key !== selectedKey && !detailError)}
							linkPickKind={activeLinkPick}
							linkTargets={linkTargets}
							onBackToParent={(key) => setSelectedKey(key)}
							onChange={updatePayload}
							onStartLinkPick={(kind) => {
								if (!detail) return;
								setLinkPick({ forKey: detail.key, kind });
								setMobilePane("list");
							}}
							onStopLinkPick={stopLinkPick}
							onCreateAttachment={createAttachment}
							onDiscardDraft={discardCurrent}
							onDiscardFile={discardPdfDraft}
							onDuplicate={duplicateCurrent}
							preview={{
								open: previewOpen,
								target: previewOpen || previewFor === selectedKey ? previewPane : null,
								revision: previewRevision,
								zoom: previewZoom,
								onZoom: setPreviewZoom,
								onToggle: () => showPreview(!previewOpen),
								onRefresh: () => setPreviewRevision((revision) => revision + 1),
								onPrepare: () => setPreviewFor(selectedKey),
							}}
							onOpenDraft={openCurrentDraft}
							onManageSources={manageSources}
							onPublish={sendCurrent}
							onWritebackResolved={(result) => {
								if (!detail) return;
								const recordKey = detail.key;
								void runBusy(async () => {
									await waitForIndexing(result);
									await Promise.all([loadDetail(recordKey), loadItems()]);
								});
							}}
							onPublicationChanged={async (receipts = []) => {
                                const completion = searchIndex.trackAndWait(receipts);
                                if (detail) void refreshCurrent(detail.key);
                                await completion;
                            }}
							onReloadDraft={reloadConflictedDraft}
							// Asking again for a record that is gone can't bring it back, so nothing offers to.
							onRetry={
								detailGone
									? undefined
									: () => (selectedKey ? void loadDetail(selectedKey) : undefined)
							}
							onRestore={restoreCurrent}
							onUnpublish={unpublishCurrent}
							onSelectAttachment={(key) => setSelectedKey(key)}
							onChangePdfRemoval={changePdfRemoval}
							onStageSourcePdf={stageSourcePdf}
							onUpload={uploadPdf}
							onAddPdf={(file) => {
								if (detail)
									uploadPdf(
										detail.key,
										file,
										detail.parentItem ? undefined : detail,
									);
							}}
							pdfProgress={
								detail ? pdfProgress[detail.key] : undefined
							}
							payload={draftPayload}
							saveMessage={saveMessage}
							saveState={saveState}
							sources={library.sources}
							validationErrors={validationErrors}
							validationRevision={validationRevision}
						/>)}
					</aside>
				</div>
			</AdminDragDropRoot>

			<AdminImportDialog
				isOpen={importOpen}
				onBeforeSend={async (itemKeys) => {
					// The finish step sends what the server holds, so edits still waiting to be saved are saved first.
					const { failures } = await flushBatchDrafts(itemKeys);
					if (failures.length) throw new Error(failures[0]!.message);
				}}
				onClose={() => setImportOpen(false)}
				onImported={async (itemKeys) => {
					// Show the whole library, newest first, so the new drafts are visible.
					setFilters(DEFAULT_ADMIN_ITEM_VIEW_FILTERS);
					await Promise.all([loadItems(), refreshSent(itemKeys)]);
					setBulkKeys(new Set(itemKeys));
				}}
				onOpenRecord={(itemKey) => {
					setImportOpen(false);
					setSelectedKey(itemKey);
					setMobilePane("inspector");
				}}
				sources={library.sources}
			/>

			<AdminSourceStatusDialog
				configurationHref={configurationHref}
				onClose={() => void setSyncSourceKey(null)}
				onIssuesChanged={loadLibrary}
				onOpenRecord={(itemKey) => {
					setSelectedKey(itemKey);
					setMobilePane("inspector");
				}}
				source={syncSource}
			/>

			<DialogModal
				isOpen={Boolean(recordAssignment)}
				size="md"
				onOpenChange={(open) => {
					if (!open) closeRecordAssignment();
				}}
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>
								Add{" "}
								{recordAssignment?.itemKeys.length === 1
									? "record"
									: `${recordAssignment?.itemKeys.length ?? 0} records`}{" "}
								to collection
							</ModalHeader>
							<ModalBody>
								<AdminCollectionPicker
									allowedSourceKeys={
										recordAssignment
											? editableItemCollectionSourceKeysForItems(
													recordAssignment.itemSourceConnectionKeys,
													library.sources,
												)
											: []
									}
									autoFocus={finePointer}
									initialSourceKey={
										recordAssignment?.initialSourceConnectionKey ??
										null
									}
									onSelect={(collection) => {
										const assignment = recordAssignment;
										closeRecordAssignment();
										if (assignment) {
											assignRecordsToCollection(
												assignment.itemKeys,
												collection.key,
											);
										}
									}}
									onSelectionChange={() => undefined}
									selectedKeys={[]}
									selectionMode="single"
									sources={library.sources}
								/>
							</ModalBody>
							<ModalFooter>
								<Button
									onPress={onClose}
									size="xs"
									variant="transparent"
								>
									Cancel
								</Button>
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</DialogModal>

			<DialogModal
				isOpen={Boolean(collectionDialog)}
				onOpenChange={(open) => {
					if (!open) {
						setCollectionDialog(null);
						setCollectionErrors({});
					}
				}}
			>
				<ModalContent as="form" onSubmit={submitCollectionForm}>
					{(onClose) => (
						<>
							<ModalHeader>
								{collectionParentPickerOpen ? (
									<span className="flex items-center gap-2">
										<button
											aria-label="Back to new collection"
											className="grid size-7 shrink-0 place-items-center rounded-md text-black/45 hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
											onClick={() =>
												setCollectionParentPickerOpen(
													false,
												)
											}
											type="button"
										>
											<HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden size={14} />
										</button>
										Choose location
									</span>
								) : collectionDialog?.mode === "rename" ? (
									"Rename collection"
								) : (
									<span className="flex flex-col gap-0.5">
										<span>New collection</span>
										<span className="text-[13px] font-normal text-black/55 dark:text-white/55">
											Collections group records inside one source.
										</span>
									</span>
								)}
							</ModalHeader>
							<ModalBody>
								{collectionParentPickerOpen ? (
									<AdminCollectionPicker
										allowedSourceKeys={[
											collectionSourceConnectionKey,
										]}
										allowTopLevel
										autoFocus={finePointer}
										initialSourceKey={
											collectionSourceConnectionKey
										}
										onSelect={(entry) => {
											setCollectionParent(entry.key);
											setCollectionParentEntry(entry);
											setCollectionParentLocation(
												collectionLocationFromCatalog(
													entry,
													library.sources,
												),
											);
											setCollectionParentPickerOpen(
												false,
											);
											setCollectionErrors((current) =>
												withoutFieldErrors(
													current,
													"_form",
													"parentCollection",
												),
											);
										}}
										onSelectionChange={(keys) =>
											setCollectionParent(keys[0] ?? null)
										}
										onSelectTopLevel={(sourceKey) => {
											setCollectionSourceConnectionKey(
												sourceKey,
											);
											setCollectionParent(null);
											setCollectionParentEntry(null);
											setCollectionParentLocation(null);
											setCollectionParentPickerOpen(
												false,
											);
											setCollectionErrors((current) =>
												withoutFieldErrors(
													current,
													"_form",
													"parentCollection",
												),
											);
										}}
										selectedKeys={
											collectionParent
												? [collectionParent]
												: []
										}
										selectionMode="single"
										sources={library.sources}
									/>
								) : (
									<>
										<CollectionField label="Name">
										<Input
											color="filled"
											aria-label="Name"
											autoFocus={finePointer}
											classNames={collectionControlClassNames}
											errorMessage={collectionErrors.name}
											isInvalid={Boolean(
												collectionErrors.name,
											)}
											placeholder="Collection name"
											value={collectionName}
											onValueChange={(value) => {
												setCollectionName(value);
												setCollectionErrors((current) =>
													withoutFieldErrors(
														current,
														"_form",
														"name",
													),
												);
											}}
										/>
										</CollectionField>
										{collectionDialog?.mode === "create" ? (
											<>
												{collectionDialog.parentCollection ===
													null &&
												editableCollectionSourceKeys.length >
													1 ? (
													<CollectionField label="Source">
													<Select
														color="filled"
														aria-label="Collection source"
														classNames={{
															base: "max-w-none",
															innerWrapper: "gap-2",
															trigger:
																"h-10 min-h-10 rounded-xl",
															value: "text-left text-sm font-normal",
														}}
														placement="left"
														renderValue={(items) =>
															items.map((item) => {
																const source =
																	library.sources.find(
																		({ key }) =>
																			key === item.key,
																	);
																return (
																	<span
																		className="flex items-center gap-2"
																		key={String(item.key)}
																	>
																		<span className="grid size-4 shrink-0 place-items-center">
																			<SourceProviderIcon
																				provider={
																					source?.provider ??
																					"zotero"
																				}
																				size={14}
																			/>
																		</span>
																		<span className="truncate">
																			{source?.label ??
																				String(item.key)}
																		</span>
																	</span>
																);
															})
														}
														onSelectionChange={(
															keys,
														) => {
															const [key] = [
																...keys,
															];
															if (
																typeof key !==
																"string"
															)
																return;
															setCollectionSourceConnectionKey(
																key,
															);
															setCollectionParent(
																null,
															);
															setCollectionParentEntry(
																null,
															);
															setCollectionParentLocation(
																null,
															);
														}}
														selectedKeys={[
															collectionSourceConnectionKey,
														]}
														size="sm"
													>
														{library.sources
															.filter(
																({
																	readOnly,
																}) => !readOnly,
															)
															.map((source) => (
																<SelectItem
																	key={
																		source.key
																	}
																	startContent={
																		<SourceProviderIcon
																			provider={
																				source.provider
																			}
																			size={14}
																		/>
																	}
																	textValue={
																		source.label
																	}
																>
																	{
																		source.label
																	}
																</SelectItem>
															))}
													</Select>
													</CollectionField>
												) : null}
												<CollectionLocationButton
													label="Location"
													location={
														collectionParentLocation
													}
													onPress={() =>
														setCollectionParentPickerOpen(
															true,
														)
													}
													topLevelSource={
														library.sources.find(
															({ key }) =>
																key ===
																collectionSourceConnectionKey,
														)?.label ??
														collectionSourceConnectionKey
													}
												/>
												{collectionErrors.parentCollection ? (
													<p
														className="text-xs text-danger"
														role="alert"
													>
														{
															collectionErrors.parentCollection
														}
													</p>
												) : null}
											</>
										) : null}
									</>
								)}
								{collectionErrors._form ? (
									<p
										className="text-xs text-danger"
										role="alert"
									>
										{collectionErrors._form}
									</p>
								) : null}
							</ModalBody>
							<ModalFooter>
								<Button
									onPress={onClose}
									size="xs"
									type="button"
									variant="transparent"
								>
									Cancel
								</Button>
								{!collectionParentPickerOpen ? (
									<Button
										color="accent"
										isDisabled={
											!collectionName.trim() || busy
										}
										isLoading={busy}
										size="xs"
										startContent={
											<HugeiconsIcon
												icon={FolderInputIcon}
												aria-hidden
												size={14}
											/>
										}
										type="submit"
										variant="solid"
									>
										{collectionDialog?.mode === "rename"
											? "Rename"
											: "Create"}
									</Button>
								) : null}
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</DialogModal>

			<DialogModal
				isOpen={Boolean(moveDialog)}
				onOpenChange={(open) => {
					if (!open) {
						setMoveDialog(null);
						setMoveErrors({});
					}
				}}
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>
								{moveParentPickerOpen ? (
									<span className="flex items-center gap-2">
										<button
											aria-label={`Back to move ${moveDialog?.collection.name ?? "collection"}`}
											className="grid size-7 shrink-0 place-items-center rounded-md text-black/45 hover:bg-black/[0.05] hover:text-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
											onClick={closeMoveParentPicker}
											type="button"
										>
											<HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden size={14} />
										</button>
										Choose destination
									</span>
								) : (
									`Move ${moveDialog?.collection.name ?? "collection"}`
								)}
							</ModalHeader>
							<ModalBody>
								{moveParentPickerOpen ? (
									<AdminCollectionPicker
										allowedSourceKeys={
											moveDialog
												? [
														moveDialog.collection
															.sourceConnectionKey,
													]
												: []
										}
										allowTopLevel
										autoFocus={finePointer}
										disabledAncestorKey={
											moveDialog?.collection.key
										}
										initialSourceKey={
											moveDialog?.collection
												.sourceConnectionKey
										}
										onSelect={(entry) => {
											setMoveParent(entry.key);
											setMoveParentLocation(
												collectionLocationFromCatalog(
													entry,
													library.sources,
												),
											);
											closeMoveParentPicker();
											setMoveDestinationChanged(true);
											setMoveErrors((current) =>
												withoutFieldErrors(
													current,
													"_form",
													"parentCollection",
												),
											);
										}}
										onSelectionChange={(keys) =>
											setMoveParent(keys[0] ?? null)
										}
										onSelectTopLevel={() => {
											setMoveParent(null);
											setMoveParentLocation(null);
											closeMoveParentPicker();
											setMoveDestinationChanged(true);
											setMoveErrors((current) =>
												withoutFieldErrors(
													current,
													"_form",
													"parentCollection",
												),
											);
										}}
										selectedKeys={
											moveParent ? [moveParent] : []
										}
										selectionMode="single"
										sources={library.sources}
									/>
								) : (
									<>
										<CollectionLocationButton
											buttonRef={moveLocationButtonRef}
											label="Destination"
											location={moveParentLocation}
											onPress={() =>
												setMoveParentPickerOpen(true)
											}
											topLevelSource={
												library.sources.find(
													({ key }) =>
														key ===
														moveDialog?.collection
															.sourceConnectionKey,
												)?.label ??
												moveDialog?.collection
													.sourceConnectionKey ??
												NATIVE_SOURCE_CONNECTION_KEY
											}
										/>
										{moveErrors.parentCollection ? (
											<p
												className="text-xs text-danger"
												role="alert"
											>
												{moveErrors.parentCollection}
											</p>
										) : null}
									</>
								)}
								{moveErrors._form ? (
									<p
										className="text-xs text-danger"
										role="alert"
									>
										{moveErrors._form}
									</p>
								) : null}
							</ModalBody>
							<ModalFooter>
								<Button
									onPress={onClose}
									size="xs"
									variant="transparent"
								>
									Cancel
								</Button>
								{!moveParentPickerOpen ? (
									<Button
										color="accent"
										isDisabled={
											busy || !moveDestinationChanged
										}
										isLoading={busy}
										onPress={submitCollectionMove}
										size="xs"
										startContent={
											<HugeiconsIcon
												icon={FolderInputIcon}
												aria-hidden
												size={14}
											/>
										}
										variant="solid"
									>
										Move
									</Button>
								) : null}
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</DialogModal>

			<AdminWritebackSourcesDialog
				busy={busy}
				onClose={() => setWritebackDialog(null)}
				onConfirm={confirmWritebackDialog}
				request={writebackDialog}
			/>

			<DialogModal
				isOpen={Boolean(confirmDialog)}
				size="md"
				onOpenChange={(open) => {
					if (!open) setConfirmDialog(null);
				}}
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>{confirmDialog?.title}</ModalHeader>
							<ModalBody>
								{confirmDialog?.error && <p role="alert" className="text-sm text-danger">{confirmDialog.error}</p>}
								<p className="text-sm text-black/60 dark:text-white/60">
									{confirmDialog?.message}
								</p>
							</ModalBody>
							<ModalFooter>
								<Button
									onPress={onClose}
									size="xs"
									variant="transparent"
								>
									Cancel
								</Button>
								<Button
									color={
										confirmDialog?.danger
											? "danger"
											: "accent"
									}
									isLoading={busy}
									onPress={() => {
										const request = confirmDialog;
										const action = request?.action;
										if (!action) return;
										void runBusy(async () => {
											await action();
											setConfirmDialog(null);
										}, (error) => {
											request?.onError?.(error);
											setConfirmDialog(current => current === request ? {...current, error: errorMessage(error)} : current);
										});
									}}
									size="xs"
									startContent={
										confirmDialog?.danger ? (
											<HugeiconsIcon icon={ArchiveIcon} aria-hidden size={14} />
										) : (
											<HugeiconsIcon icon={Tick01Icon} aria-hidden size={14} />
										)
									}
									variant="solid"
								>
									{confirmDialog?.confirmLabel ?? "Confirm"}
								</Button>
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</DialogModal>
		</main>
	);
}
