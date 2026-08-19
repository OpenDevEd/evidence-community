import type { AdminItemDetail } from "./types";

export function resolveAdminSelection(
	currentKey: string | null,
	visibleKeys: ReadonlySet<string>,
	currentDetail: AdminItemDetail | null,
	firstVisibleKey: string | null,
	options: { pinned?: boolean } = {},
) {
	if (currentKey && visibleKeys.has(currentKey)) return currentKey;
	// While the editor picks records for the open draft (links), the open record
	// stays selected even when a filter hides it from the list.
	if (currentKey && options.pinned) return currentKey;
	if (
		currentKey &&
		currentDetail?.key === currentKey &&
		currentDetail.parentItem
	) {
		return currentKey;
	}
	return firstVisibleKey;
}
