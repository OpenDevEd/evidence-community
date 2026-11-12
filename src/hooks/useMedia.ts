import { useSyncExternalStore } from "react";

/** A media query a component follows as the screen changes. */
export function mediaQuery(query: string) {
	return {
		subscribe(onChange: () => void) {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		matches: () => window.matchMedia(query).matches,
	};
}

/** Whether the screen matches a media query; false on the server. */
export function useMedia(query: ReturnType<typeof mediaQuery>) {
	return useSyncExternalStore(query.subscribe, query.matches, () => false);
}

/**
 * The root font size in pixels, and whether the screen is a phone at large text: under 640px and under 20rem wide.
 * A phone at normal text is 20rem or wider (320px at 16px). Read when it's needed, such as when a list opens.
 */
export function readLargeText() {
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
	return { rem, phone: window.innerWidth < 640 && window.innerWidth / rem < 20 };
}
