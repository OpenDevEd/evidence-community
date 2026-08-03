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

import {
	isNativeCollectionDropDestination,
	resolveNativeCollectionDrop,
	type NativeCollectionDropDestination,
} from "@/lib/admin/collection-tree";
import type { AdminCollection } from "@/lib/admin/types";

import { focusAdminDragHandle } from "./admin-focus";

export const COLLECTION_DRAG_TYPE = "admin-native-collection";
export const RECORD_DRAG_TYPE = "admin-native-record";

export type CollectionDragData = {
	collectionKey: string;
	kind: "collection";
	name: string;
};

export type RecordDragData = {
	focusKey: string;
	itemKeys: string[];
	kind: "records";
	label: string;
};

type AdminDragData = CollectionDragData | RecordDragData;

type AdminDragState = {
	activeCollectionKey: string | null;
	activeRecordCount: number;
};

class CollectionSnapshotStore {
	#collections: AdminCollection[];

	constructor(collections: AdminCollection[]) {
		this.#collections = collections;
	}

	read() {
		return this.#collections;
	}

	update(collections: AdminCollection[]) {
		this.#collections = collections;
	}
}

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
		typeof data.collectionKey === "string" &&
		typeof data.name === "string"
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
		typeof data.label === "string"
	);
}

function describeDestination(
	collections: readonly AdminCollection[],
	value: unknown,
) {
	if (!isNativeCollectionDropDestination(value)) return null;
	if (value.position === "root") return "at the top level";
	const targetName =
		collections.find(({ key }) => key === value.targetCollection)?.name ??
		"the collection";
	if (value.position === "inside") return `inside ${targetName}`;
	return `${value.position} ${targetName}`;
}

function recordCollectionName(
	collections: readonly AdminCollection[],
	value: unknown,
) {
	if (
		!isNativeCollectionDropDestination(value) ||
		value.position !== "inside"
	) {
		return null;
	}
	return (
		collections.find(({ key }) => key === value.targetCollection)?.name ??
		"the collection"
	);
}

export function AdminDragDropRoot({
	children,
	collections,
	enabled,
	onDropCollection,
	onDropRecords,
}: {
	children: ReactNode;
	collections: AdminCollection[];
	enabled: boolean;
	onDropCollection: (
		collection: AdminCollection,
		destination: NativeCollectionDropDestination,
	) => void;
	onDropRecords: (itemKeys: string[], collectionKey: string) => void;
}) {
	const [activeDrag, setActiveDrag] = useState<AdminDragData | null>(null);
	const pendingFocus = useRef<
		| { key: string; kind: "collection" }
		| { key: string; kind: "record" }
		| null
	>(null);
	const [collectionsStore] = useState(
		() => new CollectionSnapshotStore(collections),
	);
	useEffect(() => {
		collectionsStore.update(collections);
	}, [collections, collectionsStore]);

	const plugins = useMemo(
		() => [
			Accessibility.configure({
				announcements: {
					dragstart(event: DragStartEvent) {
						const data = event.operation.source?.data;
						if (isCollectionDragData(data)) {
							return `Picked up ${data.name}.`;
						}
						if (isRecordDragData(data)) {
							return `Picked up ${data.label}.`;
						}
					},
					dragover(event: DragOverEvent) {
						const data = event.operation.source?.data;
						const target = event.operation.target?.data;
						if (isCollectionDragData(data)) {
							const currentCollections = collectionsStore.read();
							if (
								isNativeCollectionDropDestination(target) &&
								!resolveNativeCollectionDrop(
									currentCollections,
									data.collectionKey,
									target,
								)
							) {
								return `${data.name} is already in that position.`;
							}
							const destination = describeDestination(
								currentCollections,
								target,
							);
							return destination
								? `${data.name} will move ${destination}.`
								: `${data.name} is not over a valid collection destination.`;
						}
						if (isRecordDragData(data)) {
							const name = recordCollectionName(
								collectionsStore.read(),
								target,
							);
							return name
								? `${data.label} will be added to ${name}.`
								: `${data.label} is not over a native collection.`;
						}
					},
					dragend(event: DragEndEvent) {
						const data = event.operation.source?.data;
						const target = event.operation.target?.data;
						if (isCollectionDragData(data)) {
							const currentCollections = collectionsStore.read();
							if (event.canceled) {
								return `Moving ${data.name} was cancelled.`;
							}
							if (
								isNativeCollectionDropDestination(target) &&
								!resolveNativeCollectionDrop(
									currentCollections,
									data.collectionKey,
									target,
								)
							) {
								return `${data.name} was not moved because it is already in that position.`;
							}
							const destination = describeDestination(
								currentCollections,
								target,
							);
							return destination
								? `${data.name} was moved ${destination}.`
								: `${data.name} was not moved.`;
						}
						if (isRecordDragData(data)) {
							if (event.canceled) {
								return `Adding ${data.label} was cancelled.`;
							}
							const name = recordCollectionName(
								collectionsStore.read(),
								target,
							);
							return name
								? `${data.label} was dropped on ${name}. Updating the draft.`
								: `${data.label} was not added to a collection.`;
						}
					},
				},
				screenReaderInstructions: {
					draggable:
						"Collection handles: press Space to pick up, use the arrow keys to choose a destination, then press Space to drop or Escape to cancel. Record handles: press Space or Enter to open the native collection picker, or use pointer drag and drop.",
				},
			}),
			...defaultPreset.plugins.filter(
				(plugin) => plugin !== Accessibility,
			),
		],
		[collectionsStore],
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
				key: data.collectionKey,
				kind: "collection",
			};
			if (
				event.canceled ||
				!isNativeCollectionDropDestination(destination)
			) {
				return;
			}
			const collection = collections.find(
				({ key }) => key === data.collectionKey,
			);
			if (collection) {
				onDropCollection(collection, destination);
			}
			return;
		}
		if (isRecordDragData(data)) {
			pendingFocus.current = {
				key: data.focusKey,
				kind: "record",
			};
			if (
				event.canceled ||
				!isNativeCollectionDropDestination(destination) ||
				destination.position !== "inside"
			) {
				return;
			}
			onDropRecords(data.itemKeys, destination.targetCollection);
		}
	};

	const activeCollection =
		activeDrag?.kind === "collection"
			? collections.find(({ key }) => key === activeDrag.collectionKey)
			: null;
	const dragState = useMemo<AdminDragState>(
		() => ({
			activeCollectionKey:
				activeDrag?.kind === "collection"
					? activeDrag.collectionKey
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
