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
