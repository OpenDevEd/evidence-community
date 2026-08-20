"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const getIsApplePlatform = () =>
	/Mac|iP(hone|ad|od)/.test(navigator.platform ?? "");
// The server cannot know the OS; hints render only after hydration so the
// markup never flashes the wrong modifier.
const getServerSnapshot = () => null;

/** `true` on Apple platforms, `false` elsewhere, `null` during SSR/hydration. */
export function useIsApplePlatform() {
	return useSyncExternalStore(
		emptySubscribe,
		getIsApplePlatform,
		getServerSnapshot,
	);
}

export const SHORTCUT_KEYS = {
	enter: "↵",
	shift: "⇧",
	escape: "Esc",
} as const;

/** OS-correct modifier+Enter label (`⌘↵` / `Ctrl ↵`), or null before hydration. */
export function useModEnterHint() {
	const isApple = useIsApplePlatform();
	if (isApple === null) return null;
	return isApple ? "⌘↵" : "Ctrl ↵";
}
