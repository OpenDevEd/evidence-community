"use client";

import {
	DragDropProvider,
	DragOverlay,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
} from "@dnd-kit/react";
import { Accessibility, defaultPreset } from "@dnd-kit/dom";
import { FileText, Folder } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";
import { focusAdminDragHandle } from "./admin-focus";

export const COLLECTION_DRAG_TYPE = "admin-collection";
export const RECORD_DRAG_TYPE = "admin-record";

export type CollectionDragData = {
	collection: AdminCollectionCatalogEntry;
	kind: "collection";
};

export type CollectionDropDestination =
	| {
			position: "after" | "before" | "inside";
			targetCollection: string;
			targetEntry?: AdminCollectionCatalogEntry;
	  }
	| {
			position: "root";
			targetCollection: null;
	  };

type CollectionDropData = CollectionDropDestination & {
	targetName?: string;
};

export type RecordDragData = {
	focusKey: string;
	itemKeys: string[];
	kind: "records";
	label: string;
	sourceConnectionKey: string;
};

type AdminDragData = CollectionDragData | RecordDragData;

type AdminDragState = {
	activeCollectionKey: string | null;
	activeRecordCount: number;
};

const AdminDragStateContext = createContext<AdminDragState>({
	activeCollectionKey: null,
	activeRecordCount: 0,
});

export function useAdminDragState() {
	return useContext(AdminDragStateContext);
}

export function isCollectionDragData(
	value: unknown,
): value is CollectionDragData {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<CollectionDragData>;
	return (
		data.kind === "collection" &&
		Boolean(data.collection) &&
		typeof data.collection?.key === "string" &&
		typeof data.collection.name === "string" &&
		typeof data.collection.revision === "number"
	);
}

export function isRecordDragData(value: unknown): value is RecordDragData {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<RecordDragData>;
	return (
		data.kind === "records" &&
		typeof data.focusKey === "string" &&
		Array.isArray(data.itemKeys) &&
		data.itemKeys.length > 0 &&
		data.itemKeys.every((key) => typeof key === "string") &&
		typeof data.label === "string" &&
		typeof data.sourceConnectionKey === "string"
	);
}

export function isCollectionDropDestination(
	value: unknown,
): value is CollectionDropDestination {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<CollectionDropDestination>;
	if (candidate.position === "root" && candidate.targetCollection === null) {
		return true;
	}
	return (
		(candidate.position === "before" ||
			candidate.position === "inside" ||
			candidate.position === "after") &&
		typeof candidate.targetCollection === "string"
	);
}

export function collectionDropIsAllowed(
	collection: AdminCollectionCatalogEntry,
	value: unknown,
) {
	if (!isCollectionDropDestination(value)) return false;
	if (value.position === "root") return true;
	const target = value.targetEntry;
	if (
		!target ||
		target.deleted ||
		target.sourceConnectionKey !== collection.sourceConnectionKey
	) {
		return false;
	}
	if (
		target.key === collection.key ||
		target.ancestors.some(({ key }) => key === collection.key)
	) {
		return false;
	}
	return true;
}

export function recordDropIsAllowed(
	record: RecordDragData,
	value: unknown,
): value is CollectionDropData & {
	position: "inside";
	targetCollection: string;
	targetEntry: AdminCollectionCatalogEntry;
} {
	if (!isCollectionDropDestination(value) || value.position !== "inside") {
		return false;
	}
	const target = value.targetEntry;
	return Boolean(
		target &&
		!target.deleted &&
		target.sourceConnectionKey === record.sourceConnectionKey,
	);
}

function destinationName(value: unknown) {
	if (!value || typeof value !== "object") return "the collection";
	const name = (value as { targetName?: unknown }).targetName;
	return typeof name === "string" ? name : "the collection";
}

function describeDestination(value: unknown) {
	if (!isCollectionDropDestination(value)) return null;
	if (value.position === "root") return "at the top level";
	const targetName = destinationName(value);
	if (value.position === "inside") return `inside ${targetName}`;
	return `${value.position} ${targetName}`;
}

function recordCollectionName(value: unknown) {
	if (!isCollectionDropDestination(value) || value.position !== "inside") {
		return null;
	}
	return destinationName(value);
}

export function AdminDragDropRoot({
	children,
	enabled,
	onDropCollection,
	onDropRecords,
}: {
	children: ReactNode;
	enabled: boolean;
	onDropCollection: (
		collection: AdminCollectionCatalogEntry,
		destination: CollectionDropDestination,
	) => void;
	onDropRecords: (itemKeys: string[], collectionKey: string) => void;
}) {
	const [activeDrag, setActiveDrag] = useState<AdminDragData | null>(null);
	const pendingFocus = useRef<
		| { key: string; kind: "collection" }
		| { key: string; kind: "record" }
		| null
	>(null);

	const plugins = useMemo(
		() => [
			Accessibility.configure({
				announcements: {
					dragstart(event: DragStartEvent) {
						const data = event.operation.source?.data;
						if (isCollectionDragData(data)) {
							return `Picked up ${data.collection.name}.`;
						}
						if (isRecordDragData(data)) {
							return `Picked up ${data.label}.`;
						}
					},
					dragover(event: DragOverEvent) {
						const data = event.operation.source?.data;
						const target = event.operation.target?.data;
						if (isCollectionDragData(data)) {
							if (
								!collectionDropIsAllowed(
									data.collection,
									target,
								)
							) {
								return `${data.collection.name} is not over a valid collection destination.`;
							}
							const destination = describeDestination(target);
							return destination
								? `${data.collection.name} will move ${destination}.`
								: `${data.collection.name} is not over a valid collection destination.`;
						}
						if (isRecordDragData(data)) {
							const name = recordDropIsAllowed(data, target)
								? recordCollectionName(target)
								: null;
							return name
								? `${data.label} will be added to ${name}.`
								: `${data.label} is not over an editable collection.`;
						}
					},
					dragend(event: DragEndEvent) {
						const data = event.operation.source?.data;
						const target = event.operation.target?.data;
						if (isCollectionDragData(data)) {
							if (event.canceled) {
								return `Moving ${data.collection.name} was cancelled.`;
							}
							if (
								!collectionDropIsAllowed(
									data.collection,
									target,
								)
							) {
								return `${data.collection.name} was not moved.`;
							}
							const destination = describeDestination(target);
							return destination
								? `${data.collection.name} was dropped ${destination}. Updating.`
								: `${data.collection.name} was not moved.`;
						}
						if (isRecordDragData(data)) {
							if (event.canceled) {
								return `Adding ${data.label} was cancelled.`;
							}
							const name = recordDropIsAllowed(data, target)
								? recordCollectionName(target)
								: null;
							return name
								? `${data.label} was dropped on ${name}. Updating the draft.`
								: `${data.label} was not added to a collection.`;
						}
					},
				},
				screenReaderInstructions: {
					draggable:
						"Collection handles: press Space to pick up, use the arrow keys to choose a destination, then press Space to drop or Escape to cancel. Record handles: press Space or Enter to open the collection picker, or use pointer drag and drop.",
				},
			}),
			...defaultPreset.plugins.filter(
				(plugin) => plugin !== Accessibility,
			),
		],
		[],
	);
	useEffect(() => {
		if (activeDrag || !enabled || !pendingFocus.current) return;
		const focus = pendingFocus.current;
		pendingFocus.current = null;
		focusAdminDragHandle(focus);
	}, [activeDrag, enabled]);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.operation.source?.data;
		setActiveDrag(
			isCollectionDragData(data) || isRecordDragData(data) ? data : null,
		);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const data = event.operation.source?.data;
		const destination = event.operation.target?.data;
		setActiveDrag(null);
		if (isCollectionDragData(data)) {
			pendingFocus.current = {
				key: data.collection.key,
				kind: "collection",
			};
			if (
				event.canceled ||
				!isCollectionDropDestination(destination) ||
				!collectionDropIsAllowed(data.collection, destination)
			) {
				return;
			}
			onDropCollection(data.collection, destination);
			return;
		}
		if (isRecordDragData(data)) {
			pendingFocus.current = {
				key: data.focusKey,
				kind: "record",
			};
			if (event.canceled || !recordDropIsAllowed(data, destination)) {
				return;
			}
			onDropRecords(data.itemKeys, destination.targetCollection);
		}
	};

	const activeCollection =
		activeDrag?.kind === "collection" ? activeDrag.collection : null;
	const dragState = useMemo<AdminDragState>(
		() => ({
			activeCollectionKey:
				activeDrag?.kind === "collection"
					? activeDrag.collection.key
					: null,
			activeRecordCount:
				activeDrag?.kind === "records" ? activeDrag.itemKeys.length : 0,
		}),
		[activeDrag],
	);

	return (
		<DragDropProvider
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
			plugins={plugins}
		>
			<AdminDragStateContext.Provider value={dragState}>
				{children}
			</AdminDragStateContext.Provider>
			<DragOverlay dropAnimation={null}>
				{activeCollection ? (
					<div className="flex min-h-8 w-[220px] items-center gap-2 rounded-lg bg-card_light px-3 text-xs text-black shadow-lg ring-1 ring-black/10 dark:bg-card dark:text-white dark:ring-white/10">
						<Folder aria-hidden className="opacity-55" size={14} />
						<span className="truncate">
							{activeCollection.name}
						</span>
					</div>
				) : activeDrag?.kind === "records" ? (
					<div className="flex min-h-9 max-w-[320px] items-center gap-2 rounded-lg bg-card_light px-3 text-xs text-black shadow-lg ring-1 ring-black/10 dark:bg-card dark:text-white dark:ring-white/10">
						<FileText
							aria-hidden
							className="shrink-0 opacity-55"
							size={14}
						/>
						<span className="truncate">{activeDrag.label}</span>
					</div>
				) : null}
			</DragOverlay>
		</DragDropProvider>
	);
}
