import { SMART_SCREENING_LIMITS } from "./schemas";

export function screeningSelection(content: string) {
	const allKeys = [
		...new Set(
			Array.from(
				content.matchAll(/\/lib\/([A-Za-z0-9:_-]+)/g),
				(match) => match[1],
			),
		),
	];

	return {
		keys: allKeys.slice(0, SMART_SCREENING_LIMITS.items),
		total: allKeys.length,
		omitted: Math.max(0, allKeys.length - SMART_SCREENING_LIMITS.items),
	};
}
