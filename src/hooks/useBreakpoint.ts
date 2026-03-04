"use client";

import { breakpoints } from "@/../tailwind.config";
import { useMediaQuery } from "usehooks-ts";

type BreakpointKey = keyof typeof breakpoints;

const getScreenValue = (query: BreakpointKey | null, value?: string) => {
	if (!query) return value;

	const screen = breakpoints[query];
	if (typeof screen === "string") return screen;
	if ("max" in screen) return screen.max;
	return value;
};

export default function useBreakpoint(query: BreakpointKey): boolean {
	const screen = breakpoints[query];
	const mediaQuery =
		typeof screen === "string"
			? `(min-width: ${screen})`
			: `(max-width: ${screen.max})`;

	return useMediaQuery(mediaQuery);
}

export function useBreakpointBelow(
	query: BreakpointKey | null,
	value?: string
): boolean {
	const screen = getScreenValue(query, value);
	const mediaQuery = screen ? `(max-width: ${screen})` : "(max-width: 0px)";
	return useMediaQuery(mediaQuery);
}
