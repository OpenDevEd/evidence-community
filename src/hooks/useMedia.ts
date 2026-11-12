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

const subscribeResize = (onChange: () => void) => {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
};

/**
 * The root font size in pixels, and whether the screen is a phone at large text: under 640px and under 20rem wide.
 * A phone at normal text is 20rem or wider (320px at 16px). Read on each render, since a page can change its text size
 * without a resize; 16 and false on the server.
 */
export function useLargeText() {
	const rem = useSyncExternalStore(subscribeResize, () => parseFloat(getComputedStyle(document.documentElement).fontSize), () => 16);
	const width = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1024);
	return { rem, phone: width < 640 && width / rem < 20 };
}
