import { useMediaQuery } from "usehooks-ts";

import { BREAKPOINTS } from "@/../design-tokens";

export default function useBreakpoint(
	query: keyof typeof BREAKPOINTS,
): boolean {
	return useMediaQuery(`(min-width: ${BREAKPOINTS[query]})`, { initializeWithValue: false });
}

export function useBreakpointBelow(
	query: keyof typeof BREAKPOINTS | null,
	value?: string,
): boolean {
	return useMediaQuery(`(max-width: ${query ? BREAKPOINTS[query] : value})`, { initializeWithValue: false });
}

export function useFinePointer(): boolean {
	return useMediaQuery("(hover: hover) and (pointer: fine)", { initializeWithValue: false });
}
