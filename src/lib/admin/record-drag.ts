import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import type { AdminItemSummary } from "./types";

export function recordDragSelection(
	record: AdminItemSummary,
	items: readonly AdminItemSummary[],
	selectedKeys: ReadonlySet<string>,
) {
	if (record.sourceConnectionKey !== NATIVE_SOURCE_CONNECTION_KEY) return [];
	if (!selectedKeys.has(record.key)) return [record.key];
	return items
		.filter(
			(item) =>
				item.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY &&
				selectedKeys.has(item.key),
		)
		.map(({ key }) => key);
}

export function recordDragLabel(
	record: AdminItemSummary,
	itemKeys: readonly string[],
) {
	return itemKeys.length === 1
		? record.title
		: `${itemKeys.length} selected records`;
}
