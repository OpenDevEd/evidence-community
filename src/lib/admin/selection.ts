import type { AdminItemDetail } from "./types";

export function resolveAdminSelection(
	currentKey: string | null,
	visibleKeys: ReadonlySet<string>,
	currentDetail: AdminItemDetail | null,
	firstVisibleKey: string | null,
) {
	if (currentKey && visibleKeys.has(currentKey)) return currentKey;
	if (
		currentKey &&
		currentDetail?.key === currentKey &&
		currentDetail.parentItem
	) {
		return currentKey;
	}
	return firstVisibleKey;
}
