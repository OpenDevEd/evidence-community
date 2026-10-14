/** A click that follows a link in this tab: the main button, with no key held that opens it somewhere else. */
export function followsInThisTab(
	event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
) {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}
