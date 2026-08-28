"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const getIsApplePlatform = () =>
	/Mac|iP(hone|ad|od)/.test(navigator.platform ?? "");
// The server cannot know which keyboard the reader has, so hints appear only
// once the page is running in the browser and never flash the wrong key.
const getServerSnapshot = () => null;

/** True on Apple keyboards, false elsewhere, null until the page is running. */
function useIsApplePlatform() {
	return useSyncExternalStore(
		emptySubscribe,
		getIsApplePlatform,
		getServerSnapshot,
	);
}

/** The right label for "hold and press Enter" on this keyboard. */
export function useModEnterHint() {
	const isApple = useIsApplePlatform();
	if (isApple === null) return null;

	return isApple ? "⌘↵" : "Ctrl ↵";
}
