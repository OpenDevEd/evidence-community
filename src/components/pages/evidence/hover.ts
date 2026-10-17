import { useSyncExternalStore } from "react";

export type Hover = { index: number; x: number; y: number } | null;

/** The paper under the pointer, kept outside React's tree: only the card that shows it re-renders as the pointer moves. */
let current: Hover = null;
const listeners = new Set<() => void>();

const same = (a: Hover, b: Hover) => (a && b ? a.index === b.index && a.x === b.x && a.y === b.y : a === b);

export function setHover(next: Hover) {
	if (same(current, next)) return;
	current = next;
	for (const listener of listeners) listener();
}

export function useHover() {
	return useSyncExternalStore(
		(listener) => { listeners.add(listener); return () => listeners.delete(listener); },
		() => current,
		() => null,
	);
}
