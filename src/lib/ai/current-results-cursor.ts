import { createHash } from "node:crypto";
import type { LibrarySearchContext } from "@/lib/search-context";

export const CURRENT_RESULTS_WINDOW_SIZE = 200;

type CurrentResultsCursor = {
	version: 1;
	offset: number;
	searchFingerprint: string;
};

function searchFingerprint(context: LibrarySearchContext) {
	return createHash("sha256")
		.update(JSON.stringify(context))
		.digest("base64url")
		.slice(0, 24);
}

export function createCurrentResultsCursor(
	context: LibrarySearchContext,
	offset: number,
) {
	const cursor: CurrentResultsCursor = {
		version: 1,
		offset,
		searchFingerprint: searchFingerprint(context),
	};

	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function currentResultsOffset(
	context: LibrarySearchContext,
	cursor?: string,
) {
	if (!cursor) return 0;

	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		) as Partial<CurrentResultsCursor>;
		// Offsets need not be window-aligned: the "last" window starts at
		// total - 200. Integrity comes from the search fingerprint.
		const validOffset =
			Number.isInteger(parsed.offset) &&
			(parsed.offset ?? -1) >= 0 &&
			(parsed.offset ?? 0) <= 1_000_000;

		if (
			parsed.version !== 1 ||
			!validOffset ||
			parsed.searchFingerprint !== searchFingerprint(context)
		) {
			throw new Error("Invalid current-results cursor");
		}

		return parsed.offset as number;
	} catch {
		throw new Error(
			"The current library search changed. Start again from its first results.",
		);
	}
}
