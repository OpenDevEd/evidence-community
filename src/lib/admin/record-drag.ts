import type { AdminItemSummary } from "./types";

export function recordDragSelection(
	record: AdminItemSummary,
	items: readonly AdminItemSummary[],
	selectedKeys: ReadonlySet<string>,
	editableSourceKeys: ReadonlySet<string>,
) {
	if (!editableSourceKeys.has(record.sourceConnectionKey)) return [];
	if (!selectedKeys.has(record.key)) return [record.key];
	return items
		.filter(
			(item) =>
				item.sourceConnectionKey === record.sourceConnectionKey &&
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
