"use client";

import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import {
	ArrowLeft,
	Archive,
	Check,
	ChevronRight,
	Clock3,
	Folder,
	FolderInput,
	Library,
	List,
	Menu,
	PanelRight,
	Plus,
	RefreshCw,
	Search,
	Send,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { LibraryLogoImages } from "@/components/library/LibraryIdentity";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Tooltip } from "@/components/nextui/Tooltip";
import type {
	AdminCollectionCatalogEntry,
	AdminItemDetail,
	AdminItemViewFilters,
	AdminLibrarySnapshot,
	AdminRecordState,
} from "@/lib/admin/types";
import type { AdminItemSortColumnId } from "@/lib/admin/item-list-contract";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResult,
} from "@/lib/admin/item-batch-contract";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { getRuntimeHomeHref } from "@/config/library-config/links";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { useFinePointer } from "@/hooks/useBreakpoint";
import { Link } from "@/i18n/routing";

import { AdminInspector } from "./AdminInspector";
import {
	adminCollectionPath,
	AdminCollectionPicker,
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
	completeAdminPdf,
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
	publishAdminItem,
	publishAdminPdf,
	renameAdminCollection,
	restoreAdminCollection,
	saveAdminDraft,
	sha256File,
	stageAdminPdf,
	unpublishAdminItem,
	unpublishAdminPdf,
	uploadAdminPdf,
} from "./admin-api";
import {
	type AdminSchemaDefinition,
	editablePayloadFromDetail,
	humanizeAdminField,
	payloadForItemType,
} from "./admin-schema";
import { focusAdminDragHandle } from "./admin-focus";
import {
	AdminDragDropRoot,
	type NativeCollectionDropDestination,
} from "./AdminDragDropProvider";
import { isTopLevelAdminItemType } from "@/lib/admin/item-fields";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";
import {
	clearChangedAdminFieldErrors,
	shouldClearAdminValidationErrors,
} from "./admin-validation";
import { useAdminItemList } from "./useAdminItemList";
import { useAdminItemTablePreferences } from "./useAdminItemTablePreferences";
import { AdminSearchIndexStatus } from "./AdminSearchIndexStatus";
import { useAdminSearchIndex } from "./useAdminSearchIndex";
import {
	setSingleAdminItemFilter,
	singleAdminItemFilterValue,
} from "@/lib/admin/item-filter-state";

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
	action: () => Promise<void>;
	confirmLabel?: string;
	danger?: boolean;
	message: string;
	onError?: (error: unknown) => void;
	title: string;
};

type RecordAssignment = {
	focusKey: string | null;
	itemKeys: string[];
};

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

function CollectionLocationButton({
	buttonRef,
	label,
	location,
	onPress,
}: {
	buttonRef?: React.RefObject<HTMLButtonElement | null>;
	label: string;
	location: CollectionLocation | null;
	onPress: () => void;
}) {
	return (
		<div className="space-y-1.5">
			<div className="text-xs font-medium text-black/60 dark:text-white/65">
				{label}
			</div>
			<button
				aria-label={`Change ${label.toLowerCase()}, current ${location?.name ?? "Top level"}, ${location?.path ?? "Native"}`}
				className="flex min-h-14 w-full items-center gap-2.5 rounded-xl bg-black/[0.035] px-3 text-left transition-colors hover:bg-black/[0.055] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:bg-white/[0.045] dark:hover:bg-white/[0.07]"
				data-admin-collection-location
				onClick={onPress}
				ref={buttonRef}
				type="button"
			>
				<Folder
					aria-hidden
					className="shrink-0 text-accent"
					size={15}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-black/75 dark:text-white/80">
						{location?.name ?? "Top level"}
					</span>
					<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
						{location?.path ?? "Native"}
					</span>
				</span>
				<ChevronRight
					aria-hidden
					className="shrink-0 text-black/30 dark:text-white/30"
					size={14}
				/>
			</button>
		</div>
	);
}

const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 1280px)";

function singleKey(keys: "all" | Set<React.Key>) {
	if (keys === "all") return null;
	const value = [...keys][0];
	return typeof value === "string" ? value : null;
}

function UpdatedSortButton({
	className,
	iconOnly = false,
	onPress,
	selected,
	sortDirection,
}: {
	className?: string;
	iconOnly?: boolean;
	onPress: () => void;
	selected: boolean;
	sortDirection: AdminItemViewFilters["sortDirection"];
}) {
	const label = `Sort by last updated${
		selected
			? `, currently ${
					sortDirection === "asc" ? "ascending" : "descending"
				}`
			: ""
	}`;
	const button = (
		<Button
			aria-label={label}
			aria-pressed={selected}
			className={className}
			isIconOnly={iconOnly}
			onPress={onPress}
			size="xs"
			startContent={
				iconOnly ? undefined : <Clock3 aria-hidden size={14} />
			}
			variant={selected ? "solid" : "transparent"}
		>
			{iconOnly ? <Clock3 aria-hidden size={15} /> : "Last updated"}
		</Button>
	);

	return iconOnly ? (
		<Tooltip content="Sort by last updated">{button}</Tooltip>
	) : (
		button
	);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Admin operation failed";
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

function indexingToastDescription(result: AdminSearchIndexMutationResult) {
	return result.indexingReceipts.length > 0
		? "Search indexing has started."
		: "Search is already up to date.";
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

export default function AdminWorkbench({
	definitions,
	initialFilters,
}: {
	definitions: AdminSchemaDefinition[];
	initialFilters: AdminItemViewFilters;
}) {
	const finePointer = useFinePointer();
	const { navigation } = useLibraryConfig();
	const homeHref = getRuntimeHomeHref(navigation.links);
	const [library, setLibrary] = useState<AdminLibrarySnapshot>({
		sources: [],
	});
	const [detail, setDetail] = useState<AdminItemDetail | null>(null);
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
		selectedKey,
		setBulkKeys,
		setFilters,
		setItems,
		setSelectedKey,
	} = useAdminItemList(detail, requestedColumns, initialFilters);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [draftPayload, setDraftPayload] = useState<Record<string, unknown>>(
		{},
	);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] = useState<AdminFieldErrors>(
		{},
	);
	const [validationRevision, setValidationRevision] = useState(0);
	const [busy, setBusy] = useState(false);
	const [recordAssignment, setRecordAssignment] =
		useState<RecordAssignment | null>(null);
	const [mobilePane, setMobilePane] = useState<
		"inspector" | "list" | "navigation"
	>("list");
	const [newItemOpen, setNewItemOpen] = useState(false);
	const [newItemSearch, setNewItemSearch] = useState("");
	const [collectionDialog, setCollectionDialog] =
		useState<CollectionDialog | null>(null);
	const [collectionName, setCollectionName] = useState("");
	const [collectionParent, setCollectionParent] = useState<string | null>(
		null,
	);
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
	const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(
		null,
	);
	const searchIndex = useAdminSearchIndex();

	const detailRequest = useRef(0);
	const moveLocationButtonRef = useRef<HTMLButtonElement>(null);
	const selectedKeyRef = useRef<string | null>(null);
	const detailRef = useRef<AdminItemDetail | null>(null);
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
	const savedPayloadByKey = useRef(new Map<string, string>());
	const saveFailureByKey = useRef(
		new Map<
			string,
			{
				fields: AdminFieldErrors;
				message: string;
				state: SaveState;
			}
		>(),
	);
	const serverReloadKeys = useRef(new Map<string, number>());
	const busyOperations = useRef(0);
	const mobilePaneMounted = useRef(false);
	selectedKeyRef.current = selectedKey;
	detailRef.current = detail;
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
			document.getElementById(`admin-${mobilePane}-pane`)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [mobilePane]);

	const loadLibrary = useCallback(async () => {
		try {
			setLibrary(await getAdminLibrary());
		} catch (error) {
			toast.error(errorMessage(error));
		}
	}, []);

	useEffect(() => {
		void loadLibrary();
	}, [loadLibrary]);

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
		savedPayloadByKey.current.delete(key);
		saveFailureByKey.current.delete(key);
	}, []);

	const applyDetail = useCallback(
		(next: AdminItemDetail, replaceLocal = false) => {
			if (replaceLocal) abandonPendingDraft(next.key);
			const knownRevision = revisionByKey.current.get(next.key);
			const staleDraft =
				!replaceLocal &&
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
					revisionByKey.current.set(
						next.key,
						next.draft.draftRevision,
					);
					savedPayloadByKey.current.set(
						next.key,
						JSON.stringify(next.draft.payload),
					);
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
				revisionByKey.current.set(next.key, next.draft.draftRevision);
				savedPayloadByKey.current.set(
					next.key,
					JSON.stringify(next.draft.payload),
				);
			} else {
				revisionByKey.current.delete(next.key);
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
					replaceLocal,
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
		[abandonPendingDraft, definitions],
	);

	const loadDetail = useCallback(
		async (key: string, discardLocal = false) => {
			const requestId = ++detailRequest.current;
			setDetailLoading(true);
			setDetailError(null);
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
			} catch (error) {
				if (requestId === detailRequest.current) {
					const message = errorMessage(error);
					setDetail((current) =>
						current?.key === key ? current : null,
					);
					setDetailError(message);
					toast.error(message);
				}
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
		[abandonPendingDraft, applyDetail],
	);

	useEffect(() => {
		if (selectedKey) void loadDetail(selectedKey);
		else {
			detailRequest.current += 1;
			setDetail(null);
			setDetailError(null);
			setDetailLoading(false);
		}
	}, [loadDetail, selectedKey]);

	const refreshCurrent = useCallback(
		async (detailKey: string | null = selectedKeyRef.current) => {
			await Promise.all([
				loadLibrary(),
				loadItems(),
				detailKey ? loadDetail(detailKey) : Promise.resolve(),
			]);
		},
		[loadDetail, loadItems, loadLibrary],
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
				const revision = revisionByKey.current.get(key);
				if (!revision) {
					throw new Error(`Draft revision is missing for ${key}`);
				}
				const saved = await saveAdminDraft(key, revision, payload);
				revisionByKey.current.set(key, saved.draftRevision);
				savedPayloadByKey.current.set(key, serialized);
				saveFailureByKey.current.delete(key);
				if (selectedKeyRef.current === key) {
					setDetail((current) =>
						current?.key === key
							? { ...current, draft: saved }
							: current,
					);
				}
				if (saveGeneration.current.get(key) !== generation) return;
				if (
					pendingPayloadByKey.current.get(key)?.generation ===
					generation
				) {
					pendingPayloadByKey.current.delete(key);
				}
				if (selectedKeyRef.current === key) {
					setSaveState("saved");
					setSaveMessage(null);
				}
			} catch (error) {
				if (saveGeneration.current.get(key) !== generation) return;
				const failure = {
					fields:
						error instanceof AdminApiError &&
						error.code === "validation_failed"
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
			saveFailureByKey.current.delete(key);
			const generation = (saveGeneration.current.get(key) ?? 0) + 1;
			saveGeneration.current.set(key, generation);
			pendingPayloadByKey.current.set(key, { generation, payload });
			const existingTimer = saveTimers.current.get(key);
			if (existingTimer) clearTimeout(existingTimer);

			const queue = () => {
				saveTimers.current.delete(key);
				const pending = pendingPayloadByKey.current.get(key);
				const queuedPayload =
					pending?.generation === generation
						? pending.payload
						: payload;
				const next = saveQueue.current.then(() =>
					executeSave(key, queuedPayload, generation),
				);
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
		(next: Record<string, unknown>) => {
			if (!detail?.draft) return;
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
			setValidationErrors((current) =>
				clearChangedAdminFieldErrors(current, draftPayload, normalized),
			);
			setDraftPayload(normalized);
			const title =
				typeof normalized.title === "string"
					? normalized.title.trim() || "Untitled"
					: detail.title;
			setDetail((current) =>
				current
					? {
							...current,
							itemType: String(
								normalized.itemType ?? current.itemType,
							),
							title,
						}
					: current,
			);
			setItems((current) =>
				current.map((record) =>
					record.key === detail.key
						? {
								...record,
								itemType: String(
									normalized.itemType ?? record.itemType,
								),
								state:
									record.state === "deleted"
										? "deleted"
										: record.revision
											? "edited"
											: "draft",
								title,
							}
						: record,
				),
			);
			setSaveState("idle");
			setSaveMessage(null);
			void queueDraftSave(detail.key, normalized);
		},
		[definitions, detail, draftPayload, queueDraftSave],
	);

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

	const trackIndexing = useCallback(
		(result: AdminSearchIndexMutationResult) =>
			searchIndex.track(result.indexingReceipts),
		[searchIndex.track],
	);

	const publishCurrent = () => {
		if (!detail?.draft) return;
		const recordKey = detail.key;
		void runBusy(
			async () => {
				await flushDraft(recordKey, draftPayload);
				const result = await publishAdminItem(recordKey);
				trackIndexing(result);
				clearRecordErrors([recordKey]);
				setValidationErrors({});
				toast.success("Record published", {
					description: indexingToastDescription(result),
				});
				await Promise.all([loadDetail(recordKey), loadItems()]);
			},
			(error) => captureInspectorValidation(recordKey, error),
		);
	};

	const openCurrentDraft = () =>
		void runBusy(async () => {
			if (!detail) return;
			await openAdminDraft(detail.key);
			await Promise.all([loadDetail(detail.key), loadItems()]);
		});

	const restoreCurrent = () => {
		if (!detail) return;
		const recordKey = detail.key;
		void runBusy(
			async () => {
				await openAdminDraft(recordKey);
				const result = await publishAdminItem(recordKey);
				trackIndexing(result);
				clearRecordErrors([recordKey]);
				setValidationErrors({});
				toast.success("Record restored", {
					description: indexingToastDescription(result),
				});
				await Promise.all([loadDetail(recordKey), loadItems()]);
			},
			(error) => captureInspectorValidation(recordKey, error),
		);
	};

	const duplicateCurrent = () =>
		void runBusy(async () => {
			if (!detail) return;
			const payload = editablePayloadFromDetail(detail, definitions);
			delete payload.parentItem;
			payload.collections = [];
			const created = await createAdminDraft(payload);
			await loadItems();
			setSelectedKey(created.itemKey);
			setMobilePane("inspector");
			toast.success("Native draft created");
		});

	const discardCurrent = () => {
		if (!detail?.draft) return;
		setConfirmDialog({
			title: detail.published ? "Discard changes?" : "Delete draft?",
			message: detail.published
				? "The published record will stay unchanged."
				: "This draft has never been published.",
			danger: !detail.published,
			action: async () => {
				abandonPendingDraft(detail.key);
				await saveQueue.current;
				await discardAdminDraft(detail.key);
				if (detail.published) {
					await loadDetail(detail.key);
				} else {
					setSelectedKey(null);
					setDetail(null);
				}
				await loadItems();
				toast.success(
					detail.published ? "Changes discarded" : "Draft deleted",
				);
			},
		});
	};

	const unpublishCurrent = () => {
		if (!detail) return;
		setConfirmDialog({
			title: "Unpublish record?",
			message:
				"It will leave the public library and remain recoverable here.",
			danger: true,
			action: async () => {
				const result = await unpublishAdminItem(detail.key);
				trackIndexing(result);
				await Promise.all([loadDetail(detail.key), loadItems()]);
				toast.success("Record unpublished", {
					description: indexingToastDescription(result),
				});
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

	const uploadPdf = (key: string, file: File) =>
		void runBusy(
			async () => {
				setFileErrors((current) => withoutRecordError(current, key));
				if (
					file.type !== "application/pdf" &&
					!file.name.toLowerCase().endsWith(".pdf")
				) {
					throw new Error("Choose a PDF file");
				}
				toast.info("Preparing PDF");
				const expectedSha256 = await sha256File(file);
				const staged = await stageAdminPdf(key, {
					expectedSha256,
					expectedSizeBytes: file.size,
					filename: file.name,
				});
				await uploadAdminPdf(staged.upload.signedUrl, file);
				await completeAdminPdf(key, staged.fileDraft.uploadRevision);
				if (detail) await loadDetail(detail.key);
				await loadItems();
				toast.success("PDF staged and processed");
			},
			(error) =>
				setFileErrors((current) => ({
					...current,
					[key]: fileErrorMessage(error),
				})),
		);

	const publishPdf = (key: string, uploadRevision: number) =>
		void runBusy(
			async () => {
				setFileErrors((current) => withoutRecordError(current, key));
				const result = await publishAdminPdf(key, uploadRevision);
				trackIndexing(result);
				if (detail) await loadDetail(detail.key);
				await loadItems();
				toast.success("PDF published", {
					description: indexingToastDescription(result),
				});
			},
			(error) =>
				setFileErrors((current) => ({
					...current,
					[key]: fileErrorMessage(error),
				})),
		);

	const discardPdfDraft = (key: string) => {
		setConfirmDialog({
			danger: true,
			title: "Discard staged PDF?",
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

	const unpublishPdf = (key: string) => {
		setConfirmDialog({
			title: "Unpublish PDF?",
			message:
				"The attachment metadata will stay published. The PDF can be staged again later.",
			action: async () => {
				const result = await unpublishAdminPdf(key);
				trackIndexing(result);
				setFileErrors((current) => withoutRecordError(current, key));
				if (detail) await loadDetail(detail.key);
				await loadItems();
				toast.success("PDF unpublished", {
					description: indexingToastDescription(result),
				});
			},
			onError: (error) =>
				setFileErrors((current) => ({
					...current,
					[key]: fileErrorMessage(error),
				})),
		});
	};

	const openCreateCollection = (
		parentCollection: AdminCollectionCatalogEntry | null,
	) => {
		setCollectionErrors({});
		setCollectionDialog({
			mode: "create",
			parentCollection: parentCollection?.key ?? null,
		});
		setCollectionName("");
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
	};

	const openRenameCollection = (collection: AdminCollectionCatalogEntry) => {
		setCollectionErrors({});
		setCollectionDialog({ collection, mode: "rename" });
		setCollectionName(collection.name);
		setCollectionParentPickerOpen(false);
	};

	const openMoveCollection = (collection: AdminCollectionCatalogEntry) => {
		setMoveErrors({});
		setMoveDialog({ collection });
		setMoveParent(collection.parentCollection);
		setMoveParentLocation(
			parentCollectionLocation(collection, library.sources),
		);
		setMoveParentPickerOpen(false);
		setMoveDestinationChanged(false);
	};

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
					trackIndexing(result);
					focusKey = result.collection.key;
					toast.success("Collection renamed");
				} else {
					const result = await createAdminCollection({
						name: collectionName,
						parentCollection: collectionParent,
					});
					trackIndexing(result);
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
				focusAdminCollection(focusKey);
				setCollectionDialog(null);
				await refreshCurrent();
			},
			(error) => setCollectionErrors(formErrors(error)),
		);

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
				trackIndexing(result);
				invalidateAdminCollectionCatalogue();
				focusAdminCollection(moveDialog.collection.key);
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
		destination: NativeCollectionDropDestination,
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
				trackIndexing(result);
				invalidateAdminCollectionCatalogue();
				focusAdminCollection(collection.key);
				toast.success(
					result.collections.length
						? "Collection moved"
						: "Collection is already there",
				);
			},
			() => {
				invalidateAdminCollectionCatalogue();
				focusAdminCollection(collection.key);
			},
		);
	};

	const removeCollection = (collection: AdminCollectionCatalogEntry) =>
		setConfirmDialog({
			title: `Delete ${collection.name}?`,
			message:
				"This deletes the collection and its active descendants. Records stay in the library. Restore only brings back collections deleted by this action.",
			confirmLabel: "Delete",
			danger: true,
			action: async () => {
				const result = await deleteAdminCollection(
					collection.key,
					collection.revision,
				);
				trackIndexing(result);
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
		});

	const restoreCollection = (collection: AdminCollectionCatalogEntry) =>
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
				trackIndexing(result);
				invalidateAdminCollectionCatalogue();
				await refreshCurrent();
				toast.success("Collection restored");
			},
		});

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

	const executeBatchMutation = async (
		request: AdminItemBatchRequest,
		feedback: BatchFeedback,
		localResults: readonly AdminItemBatchResult[] = [],
	) => {
		const remoteResults =
			request.keys.length > 0
				? (await mutateAdminItems(request)).results
				: [];
		const results = [...localResults, ...remoteResults];
		searchIndex.track(
			remoteResults.flatMap(({ indexingReceipts }) => indexingReceipts),
		);
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
		const summary = batchResultSummary(results, feedback.changedLabels);
		if (summary.failed.length) {
			toast.error(summary.message, {
				description: failureDescription(
					summary.failed.map(
						({ key, message }) =>
							`${key}: ${message ?? "Operation failed."}`,
					),
				),
			});
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
						"Publish the drafts to update the public library.",
				},
				failures,
			);
		});

	const requestRecordAssignment = (itemKeys: string[], focusKey: string) => {
		setRecordAssignment({ focusKey, itemKeys });
	};

	const closeRecordAssignment = () => {
		const focusKey = recordAssignment?.focusKey;
		setRecordAssignment(null);
		if (!focusKey) return;
		requestAnimationFrame(() => {
			focusAdminDragHandle({ key: focusKey, kind: "record" });
		});
	};

	const bulkPublish = () =>
		void runBusy(async () => {
			const { failures, readyKeys } = await flushBatchDrafts([
				...bulkKeys,
			]);
			await executeBatchMutation(
				{ action: "publish", keys: [...readyKeys] },
				{
					changedLabels: ["record published", "records published"],
					emptyMessage: "No records were published",
				},
				failures,
			);
		});

	const bulkDelete = () =>
		setConfirmDialog({
			title: "Remove selected records?",
			message:
				"Native drafts will be deleted. Published native records will be unpublished. Imported records are skipped.",
			danger: true,
			action: async () => {
				for (const key of bulkKeys) {
					abandonPendingDraft(key);
				}
				await saveQueue.current;
				await executeBatchMutation(
					{ action: "remove", keys: [...bulkKeys] },
					{
						changedLabels: ["record removed", "records removed"],
						clearChangedInspector: true,
						emptyMessage: "No records were removed",
					},
				);
			},
		});

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

	const selectedCollectionFilter = singleAdminItemFilterValue(
		filters.filters,
		"collections",
	);
	const collectionFilter =
		selectedCollectionFilter === undefined
			? "all"
			: selectedCollectionFilter;
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

	return (
		<main className="fixed inset-x-0 top-0 z-0 flex h-dvh min-h-0 flex-col bg-background_light text-black dark:bg-background dark:text-white">
			<h1 className="sr-only">Library administration</h1>
			<header
				className="grid min-h-[104px] shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 sm:flex sm:min-h-14 sm:py-0"
				data-admin-region="toolbar"
			>
				<Link
					aria-label="Open library"
					className="col-start-1 row-start-1 flex h-8 min-w-0 max-w-[120px] items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus sm:mr-1 sm:w-[120px] sm:shrink-0 xl:w-[150px] xl:max-w-none"
					href={homeHref}
				>
					<LibraryLogoImages className="max-h-7 max-w-full object-contain" />
				</Link>
				<div className="col-span-3 row-start-2 flex min-w-0 items-center gap-2 sm:min-w-[260px] sm:max-w-[520px] sm:flex-1">
					<Input
						aria-label="Search records"
						className="min-w-0 flex-1"
						classNames={{
							input: "text-sm",
							inputWrapper: "h-10 min-h-10 rounded-xl",
						}}
						isClearable
						placeholder="Search title, creator, date or tag"
						startContent={
							<Search
								aria-hidden
								className="text-black/35 dark:text-white/35"
								size={15}
							/>
						}
						value={filters.query}
						onClear={() =>
							setFilters((current) => ({
								...current,
								query: "",
							}))
						}
						onValueChange={(query) =>
							setFilters((current) => ({
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
				<div className="hidden flex-1 sm:block" />
				<div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1">
					<div className="flex rounded-xl bg-black/[0.035] p-1 xl:hidden dark:bg-white/[0.035]">
						{[
							{
								icon: Menu,
								key: "navigation" as const,
								label: "Filters",
							},
							{
								icon: List,
								key: "list" as const,
								label: "Records",
							},
							{
								icon: PanelRight,
								key: "inspector" as const,
								label: "Editor",
							},
						].map((entry) => {
							const Icon = entry.icon;
							return (
								<Tooltip key={entry.key} content={entry.label}>
									<Button
										aria-controls={`admin-${entry.key}-pane`}
										aria-label={entry.label}
										aria-pressed={mobilePane === entry.key}
										isIconOnly
										onPress={() => setMobilePane(entry.key)}
										size="xs"
										variant={
											mobilePane === entry.key
												? "solid"
												: "transparent"
										}
									>
										<Icon aria-hidden size={15} />
									</Button>
								</Tooltip>
							);
						})}
					</div>
					<AdminSearchIndexStatus
						error={searchIndex.error}
						onRefresh={() => void searchIndex.refresh()}
						onRetry={() => void searchIndex.retry()}
						view={searchIndex.view}
					/>
				</div>
				<Tooltip content="Refresh">
					<Button
						aria-label="Refresh"
						className="hidden text-black/45 hover:bg-black/[0.05] hover:text-black/80 xl:flex dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/80"
						isIconOnly
						onPress={() => void refreshCurrent()}
						size="xs"
						variant="transparent"
					>
						<RefreshCw aria-hidden size={15} />
					</Button>
				</Tooltip>
				<UpdatedSortButton
					className="hidden xl:flex"
					iconOnly
					onPress={() => changeSort("updated")}
					selected={filters.sort === "updated"}
					sortDirection={filters.sortDirection}
				/>
				<Button
					aria-label="New item"
					className="col-start-3 row-start-1 lg:hidden"
					color="accent"
					isIconOnly
					onPress={() => setNewItemOpen(true)}
					size="xs"
					variant="solid"
				>
					<Plus aria-hidden size={15} />
				</Button>
				<Button
					className="hidden h-9 rounded-xl px-3 font-semibold shadow-sm shadow-accent/10 lg:flex"
					color="accent"
					onPress={() => setNewItemOpen(true)}
					size="xs"
					startContent={<Plus aria-hidden size={15} />}
					variant="solid"
				>
					New item
				</Button>
			</header>

			<AdminDragDropRoot
				enabled={!busy}
				onDropCollection={dropCollection}
				onDropRecords={(itemKeys, collectionKey) =>
					assignRecordsToCollection(itemKeys, collectionKey)
				}
			>
				<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[240px_minmax(0,1fr)_360px]">
					<aside
						id="admin-navigation-pane"
						aria-label="Filters and collections"
						tabIndex={-1}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "navigation" ? "block" : "hidden"
						} xl:block`}
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
									<RefreshCw aria-hidden size={14} />
								</Button>
								<UpdatedSortButton
									iconOnly
									onPress={() => changeSort("updated")}
									selected={filters.sort === "updated"}
									sortDirection={filters.sortDirection}
								/>
							</div>
							<div className="min-h-0 flex-1">
								<AdminNavigation
									collection={collectionFilter}
									isBusy={busy}
									onCreateCollection={openCreateCollection}
									onDeleteCollection={removeCollection}
									onEditCollection={openRenameCollection}
									onMoveCollection={openMoveCollection}
									onRestoreCollection={restoreCollection}
									onSelectCollection={(collection) =>
										setFilters((current) => ({
											...current,
											filters: setSingleAdminItemFilter(
												current.filters,
												"collections",
												collection === "all"
													? null
													: collection,
											),
										}))
									}
									onSelectSource={(source) =>
										setFilters((current) => ({
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
										setFilters((current) => ({
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
								/>
							</div>
						</div>
					</aside>

					<section
						aria-label="Records"
						id="admin-list-pane"
						tabIndex={-1}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "list" ? "flex" : "hidden"
						} flex-col xl:flex`}
					>
						<AdminItemTable
							bulkActions={
								bulkKeys.size ? (
									<div
										aria-label="Bulk actions"
										className="flex h-full min-w-0 items-center gap-1 overflow-hidden"
										role="toolbar"
									>
										<span className="hidden shrink-0 px-1 text-xs font-medium text-black/60 dark:text-white/65 sm:inline">
											{bulkKeys.size} selected
										</span>
										<Tooltip content="Publish selected">
											<Button
												aria-label="Publish selected"
												isDisabled={busy}
												isIconOnly
												onPress={bulkPublish}
												size="xs"
												variant="transparent"
											>
												<Send aria-hidden size={14} />
											</Button>
										</Tooltip>
										<Tooltip content="Add selected to collection">
											<button
												aria-label="Add selected to collection"
												className="grid size-8 shrink-0 place-items-center rounded-lg text-black/55 hover:bg-black/[0.05] hover:text-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/85"
												disabled={busy}
												onClick={() =>
													setRecordAssignment({
														focusKey: null,
														itemKeys: [...bulkKeys],
													})
												}
												type="button"
											>
												<FolderInput
													aria-hidden
													size={14}
												/>
											</button>
										</Tooltip>
										<Tooltip content="Remove selected">
											<Button
												aria-label="Remove selected"
												className="text-danger"
												isDisabled={busy}
												isIconOnly
												onPress={bulkDelete}
												size="xs"
												variant="transparent"
											>
												<Trash2 aria-hidden size={14} />
											</Button>
										</Tooltip>
										<Tooltip content="Clear selection">
											<Button
												aria-label="Clear selection"
												isIconOnly
												onPress={() =>
													setBulkKeys(new Set())
												}
												size="xs"
												variant="transparent"
											>
												<X aria-hidden size={14} />
											</Button>
										</Tooltip>
									</div>
								) : undefined
							}
							bulkKeys={bulkKeys}
							dragEnabled={!busy}
							error={listError}
							hasMore={hasMore}
							items={items}
							loading={listLoading}
							preferences={itemTablePreferences}
							onLoadMore={() => {
								if (nextCursor !== null && !listLoading) {
									void loadItems(nextCursor, true);
								}
							}}
							onRequestCollectionAssignment={
								requestRecordAssignment
							}
							onRetry={() => void loadItems()}
							onPreferencesChange={setItemTablePreferences}
							onResetPreferences={resetItemTablePreferences}
							onSelect={(key) => {
								setSelectedKey(key);
								setMobilePane("inspector");
							}}
							onSort={changeSort}
							onToggleBulk={(key, selected) =>
								setBulkKeys((current) => {
									const next = new Set(current);
									if (selected) next.add(key);
									else next.delete(key);
									return next;
								})
							}
							onToggleVisible={(selected) =>
								setBulkKeys(
									selected
										? new Set(items.map(({ key }) => key))
										: new Set(),
								)
							}
							selectedKey={selectedKey}
							sort={filters.sort}
							sortDirection={filters.sortDirection}
							sources={library.sources}
						/>
					</section>

					<aside
						aria-label="Record editor"
						id="admin-inspector-pane"
						tabIndex={-1}
						className={`min-h-0 overflow-hidden rounded-2xl bg-card_light focus-visible:outline-none dark:bg-card ${
							mobilePane === "inspector" ? "block" : "hidden"
						} xl:block`}
					>
						<AdminInspector
							busy={busy}
							definitions={definitions}
							detail={detail}
							error={detailError}
							fileErrors={fileErrors}
							loading={detailLoading}
							onBackToParent={(key) => setSelectedKey(key)}
							onChange={updatePayload}
							onCreateAttachment={createAttachment}
							onDiscardDraft={discardCurrent}
							onDiscardFile={discardPdfDraft}
							onDuplicate={duplicateCurrent}
							onOpenDraft={openCurrentDraft}
							onPublish={publishCurrent}
							onPublishFile={publishPdf}
							onReloadDraft={reloadConflictedDraft}
							onRetry={() =>
								selectedKey
									? void loadDetail(selectedKey)
									: undefined
							}
							onRestore={restoreCurrent}
							onSelectAttachment={(key) => setSelectedKey(key)}
							onUnpublish={unpublishCurrent}
							onUnpublishFile={unpublishPdf}
							onUpload={uploadPdf}
							payload={draftPayload}
							saveMessage={saveMessage}
							saveState={saveState}
							sources={library.sources}
							validationErrors={validationErrors}
							validationRevision={validationRevision}
						/>
					</aside>
				</div>
			</AdminDragDropRoot>

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
									editableOnly
									autoFocus={finePointer}
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
				isOpen={newItemOpen}
				size="lg"
				onOpenChange={(open) => setNewItemOpen(open)}
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>New item</ModalHeader>
							<ModalBody>
								<Input
									aria-label="Find an item type"
									autoFocus={finePointer}
									placeholder="Find an item type"
									startContent={
										<Search aria-hidden size={15} />
									}
									value={newItemSearch}
									onValueChange={setNewItemSearch}
								/>
								<div className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
									{filteredDefinitions.map((definition) => (
										<button
											key={definition.itemType}
											className="flex min-h-12 items-center gap-2 rounded-xl bg-black/[0.035] px-3 text-left text-sm hover:bg-accent/10 dark:bg-white/[0.035] dark:hover:bg-accent/15"
											onClick={() =>
												createItem(definition)
											}
											type="button"
										>
											<Library
												aria-hidden
												className="shrink-0 opacity-45"
												size={16}
											/>
											{humanizeAdminField(
												definition.itemType,
											)}
										</button>
									))}
								</div>
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
				<ModalContent>
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
											<ArrowLeft aria-hidden size={14} />
										</button>
										Choose location
									</span>
								) : collectionDialog?.mode === "rename" ? (
									"Rename collection"
								) : (
									"New collection"
								)}
							</ModalHeader>
							<ModalBody>
								{collectionParentPickerOpen ? (
									<AdminCollectionPicker
										allowTopLevel
										autoFocus={finePointer}
										editableOnly
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
										onSelectTopLevel={() => {
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
										<Input
											autoFocus={finePointer}
											errorMessage={collectionErrors.name}
											isInvalid={Boolean(
												collectionErrors.name,
											)}
											label="Name"
											labelPlacement="outside"
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
										{collectionDialog?.mode === "create" ? (
											<>
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
										onPress={submitCollection}
										size="xs"
										startContent={
											<FolderInput
												aria-hidden
												size={14}
											/>
										}
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
											<ArrowLeft aria-hidden size={14} />
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
										allowTopLevel
										autoFocus={finePointer}
										disabledAncestorKey={
											moveDialog?.collection.key
										}
										editableOnly
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
											<FolderInput
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
										const action = confirmDialog?.action;
										if (!action) return;
										void runBusy(async () => {
											await action();
											setConfirmDialog(null);
										}, confirmDialog?.onError);
									}}
									size="xs"
									startContent={
										confirmDialog?.danger ? (
											<Archive aria-hidden size={14} />
										) : (
											<Check aria-hidden size={14} />
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
