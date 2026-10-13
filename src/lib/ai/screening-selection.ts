import { SCREENING_BATCH_LIMIT } from "./schemas";

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
		/** Every record the answer links, which OpenScholar screens past the limit. */
		allKeys,
		keys: allKeys.slice(0, SCREENING_BATCH_LIMIT),
		total: allKeys.length,
		omitted: Math.max(0, allKeys.length - SCREENING_BATCH_LIMIT),
	};
}

export type ScreeningSelection = ReturnType<typeof screeningSelection>;
