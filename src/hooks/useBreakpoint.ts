import { useMediaQuery } from "usehooks-ts";

import { BREAKPOINTS } from "@/../design-tokens";

export default function useBreakpoint(
	query: keyof typeof BREAKPOINTS,
): boolean {
	return useMediaQuery(`(min-width: ${BREAKPOINTS[query]})`);
}

export function useBreakpointBelow(
	query: keyof typeof BREAKPOINTS | null,
	value?: string,
): boolean {
	return useMediaQuery(
		`(max-width: ${query ? BREAKPOINTS[query] : value})`,
	);
}
