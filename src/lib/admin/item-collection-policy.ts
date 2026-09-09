import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";

export function itemCollectionSourceIsAssignable(
	itemSourceConnectionKey: string,
	collectionSourceConnectionKey: string,
) {
	return (
		collectionSourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY ||
		collectionSourceConnectionKey === itemSourceConnectionKey
	);
}

export function editableItemCollectionSourceKeys(
	itemSourceConnectionKey: string,
	sources: readonly { key: string; readOnly: boolean }[],
) {
	return editableItemCollectionSourceKeysForItems(
		[itemSourceConnectionKey],
		sources,
	);
}

export function editableItemCollectionSourceKeysForItems(
	itemSourceConnectionKeys: readonly string[],
	sources: readonly { key: string; readOnly: boolean }[],
) {
	const uniqueItemSourceKeys = [...new Set(itemSourceConnectionKeys)];
	if (uniqueItemSourceKeys.length === 0) return [];
	return sources.flatMap(({ key, readOnly }) =>
		!readOnly &&
		uniqueItemSourceKeys.every((itemSourceConnectionKey) =>
			itemCollectionSourceIsAssignable(itemSourceConnectionKey, key),
		)
			? [key]
			: [],
	);
}

export function editableCollectionSourceKeys(sources: readonly { key: string; readOnly: boolean }[]) {
	return new Set(sources.filter(({ readOnly }) => !readOnly).map(({ key }) => key));
}
