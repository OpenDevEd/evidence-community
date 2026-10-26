import { describe, expect, it } from "vitest";

import {
	resolveIdleLastError,
	shouldRebuildSearchIndex,
} from "@/lib/search-index/bootstrap-state";

describe("search index bootstrap", () => {
	it.each([
		{ forceRebuild: true, indexCreated: false, rebuildPending: false },
		{ forceRebuild: false, indexCreated: true, rebuildPending: false },
		{ forceRebuild: false, indexCreated: false, rebuildPending: true },
	])("rebuilds for $forceRebuild/$indexCreated/$rebuildPending", (input) => {
		expect(shouldRebuildSearchIndex(input)).toBe(true);
	});

	it("does not rebuild a complete existing index", () => {
		expect(
			shouldRebuildSearchIndex({
				forceRebuild: false,
				indexCreated: false,
				rebuildPending: false,
			}),
		).toBe(false);
	});
});

describe("search index worker error state", () => {
	it("clears a delivery error once records index successfully", () => {
		expect(
			resolveIdleLastError({
				previousLastError: "SearchIndexWriteError: Elasticsearch could not write records (429)",
				processedEvents: 3,
			}),
		).toBeNull();
	});

	it("keeps the previous error when nothing was processed", () => {
		expect(
			resolveIdleLastError({
				previousLastError: "SearchIndexWriteError: Elasticsearch could not write records (429)",
				processedEvents: 0,
			}),
		).toBe("SearchIndexWriteError: Elasticsearch could not write records (429)");
	});
});
