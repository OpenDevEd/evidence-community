import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import type { AdminCollection } from "./types";

export type NativeCollectionDropDestination =
	| {
			position: "after" | "before" | "inside";
			targetCollection: string;
	  }
	| {
			position: "root";
			targetCollection: null;
	  };

export type NativeCollectionMove = {
	beforeCollection: string | null;
	parentCollection: string | null;
};

export function compareAdminCollectionOrder(
	left: AdminCollection,
	right: AdminCollection,
) {
	if (left.sourceConnectionKey !== right.sourceConnectionKey) {
		return left.sourceConnectionKey < right.sourceConnectionKey ? -1 : 1;
	}
	const leftOrder = left.sortOrder ?? Number.POSITIVE_INFINITY;
	const rightOrder = right.sortOrder ?? Number.POSITIVE_INFINITY;
	if (leftOrder !== rightOrder) return leftOrder - rightOrder;
	const leftName = left.name.toLowerCase();
	const rightName = right.name.toLowerCase();
	if (leftName !== rightName) return leftName < rightName ? -1 : 1;
	if (left.key === right.key) return 0;
	return left.key < right.key ? -1 : 1;
}

export function mergeAdminCollectionUpdates(
	current: AdminCollection[],
	updates: AdminCollection[],
) {
	if (updates.length === 0) return current;
	const updatesByKey = new Map(updates.map((entry) => [entry.key, entry]));
	const currentKeys = new Set(current.map(({ key }) => key));
	const currentIndex = new Map(current.map(({ key }, index) => [key, index]));
	return [
		...current.map((entry) => updatesByKey.get(entry.key) ?? entry),
		...updates.filter(({ key }) => !currentKeys.has(key)),
	].sort((left, right) => {
		if (left.sourceConnectionKey !== right.sourceConnectionKey) {
			return left.sourceConnectionKey < right.sourceConnectionKey
				? -1
				: 1;
		}
		if (left.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY) {
			return compareAdminCollectionOrder(left, right);
		}
		const leftIndex =
			currentIndex.get(left.key) ?? Number.POSITIVE_INFINITY;
		const rightIndex =
			currentIndex.get(right.key) ?? Number.POSITIVE_INFINITY;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		if (left.key === right.key) return 0;
		return left.key < right.key ? -1 : 1;
	});
}

export function isNativeCollectionDropDestination(
	value: unknown,
): value is NativeCollectionDropDestination {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<NativeCollectionDropDestination>;
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

export function addCollectionToSavedExpansion(
	savedExpansion: string,
	collectionKeys: string[],
) {
	if (!savedExpansion) return null;
	try {
		const keys = new Set(JSON.parse(savedExpansion) as string[]);
		for (const collectionKey of collectionKeys) keys.add(collectionKey);
		return JSON.stringify([...keys]);
	} catch {
		return JSON.stringify(collectionKeys);
	}
}

export function collectionAncestorKeys(
	rows: Array<{ key: string; parentCollection: string | null }>,
	collectionKey: string,
) {
	const rowsByKey = new Map(rows.map((row) => [row.key, row]));
	const ancestors: string[] = [];
	const visited = new Set([collectionKey]);
	let parentKey = rowsByKey.get(collectionKey)?.parentCollection ?? null;

	while (parentKey && !visited.has(parentKey)) {
		visited.add(parentKey);
		ancestors.unshift(parentKey);
		parentKey = rowsByKey.get(parentKey)?.parentCollection ?? null;
	}
	return ancestors;
}

export function collectionDescendantKeys(
	rows: Array<{ key: string; parentCollection: string | null }>,
	rootKey: string,
) {
	const children = new Map<string, string[]>();
	for (const row of rows) {
		if (!row.parentCollection) continue;
		const current = children.get(row.parentCollection) ?? [];
		current.push(row.key);
		children.set(row.parentCollection, current);
	}

	const descendants = new Set<string>();
	const pending = [...(children.get(rootKey) ?? [])];
	while (pending.length > 0) {
		const key = pending.pop()!;
		if (descendants.has(key)) continue;
		descendants.add(key);
		pending.push(...(children.get(key) ?? []));
	}
	return descendants;
}

export function collectionSubtreeKeys(
	rows: Array<{ key: string; parentCollection: string | null }>,
	rootKey: string,
) {
	return new Set([rootKey, ...collectionDescendantKeys(rows, rootKey)]);
}

export function legalNativeCollectionParents(
	collections: AdminCollection[],
	collectionKey?: string,
) {
	const excluded = collectionKey
		? collectionSubtreeKeys(collections, collectionKey)
		: new Set<string>();
	return collections.filter(
		(collection) =>
			!collection.deleted &&
			collection.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY &&
			!excluded.has(collection.key),
	);
}

export function nativeCollectionSiblings(
	collections: AdminCollection[],
	parentCollection: string | null,
	collectionKey?: string,
) {
	return collections.filter(
		(collection) =>
			!collection.deleted &&
			collection.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY &&
			collection.parentCollection === parentCollection &&
			collection.key !== collectionKey,
	);
}

export function collectionMovePositionOptions(
	collections: AdminCollection[],
	parentCollection: string | null,
	collectionKey: string,
) {
	const siblings = nativeCollectionSiblings(
		collections,
		parentCollection,
		collectionKey,
	);
	return [
		{ key: "first", label: "At the start" },
		...siblings.map((sibling) => ({
			key: `after:${sibling.key}`,
			label: `After ${sibling.name}`,
		})),
	];
}

export function currentCollectionMovePosition(
	collections: AdminCollection[],
	collection: AdminCollection,
) {
	const siblings = collections.filter(
		(candidate) =>
			!candidate.deleted &&
			candidate.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY &&
			candidate.parentCollection === collection.parentCollection,
	);
	const index = siblings.findIndex(({ key }) => key === collection.key);
	return index > 0 ? `after:${siblings[index - 1]!.key}` : "first";
}

export function resolveBeforeCollection(
	collections: AdminCollection[],
	parentCollection: string | null,
	collectionKey: string,
	position: string,
) {
	const siblings = nativeCollectionSiblings(
		collections,
		parentCollection,
		collectionKey,
	);
	if (position === "first") return siblings[0]?.key ?? null;
	if (!position.startsWith("after:")) {
		throw new Error("Unknown collection position");
	}
	const previousKey = position.slice("after:".length);
	const previousIndex = siblings.findIndex(({ key }) => key === previousKey);
	if (previousIndex < 0) {
		throw new Error("Collection position is no longer available");
	}
	return siblings[previousIndex + 1]?.key ?? null;
}

export function resolveNativeCollectionDrop(
	collections: AdminCollection[],
	collectionKey: string,
	destination: NativeCollectionDropDestination,
): NativeCollectionMove | null {
	const collection = collections.find(
		(candidate) =>
			candidate.key === collectionKey &&
			!candidate.deleted &&
			candidate.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY,
	);
	if (!collection) return null;

	let parentCollection: string | null;
	let beforeCollection: string | null;

	if (destination.position === "root") {
		parentCollection = null;
		beforeCollection = null;
	} else {
		const target = collections.find(
			(candidate) =>
				candidate.key === destination.targetCollection &&
				!candidate.deleted &&
				candidate.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY,
		);
		if (!target) return null;

		const excludedTargets = collectionSubtreeKeys(
			collections,
			collectionKey,
		);
		if (excludedTargets.has(target.key)) return null;

		if (destination.position === "inside") {
			parentCollection = target.key;
			beforeCollection = null;
		} else {
			parentCollection = target.parentCollection;
			const siblings = nativeCollectionSiblings(
				collections,
				parentCollection,
				collectionKey,
			);
			const targetIndex = siblings.findIndex(
				(candidate) => candidate.key === target.key,
			);
			if (targetIndex < 0) return null;
			beforeCollection =
				destination.position === "before"
					? target.key
					: (siblings[targetIndex + 1]?.key ?? null);
		}
	}

	const currentSiblings = collections.filter(
		(candidate) =>
			!candidate.deleted &&
			candidate.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY &&
			candidate.parentCollection === collection.parentCollection,
	);
	const currentIndex = currentSiblings.findIndex(
		(candidate) => candidate.key === collectionKey,
	);
	const currentBefore = currentSiblings[currentIndex + 1]?.key ?? null;

	if (
		parentCollection === collection.parentCollection &&
		beforeCollection === currentBefore
	) {
		return null;
	}

	return { beforeCollection, parentCollection };
}
