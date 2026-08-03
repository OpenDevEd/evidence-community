export type AdminDragFocusTarget = {
	key: string;
	kind: "collection" | "record";
};

export function focusAdminDragHandle({
	key,
	kind,
}: AdminDragFocusTarget): void {
	const attribute =
		kind === "collection"
			? "data-collection-drag-handle"
			: "data-record-drag-handle";
	const target = Array.from(
		document.querySelectorAll<HTMLElement>(`[${attribute}]`),
	).find((element) => element.getAttribute(attribute) === key);
	const fallback = document.getElementById(
		kind === "collection" ? "admin-navigation-pane" : "admin-list-pane",
	);
	(target ?? fallback)?.focus({ preventScroll: true });
}
