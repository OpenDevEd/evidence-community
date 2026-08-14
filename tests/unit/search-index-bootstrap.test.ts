import { describe, expect, it } from "vitest";

import { shouldRebuildSearchIndex } from "@/lib/search-index/bootstrap-state";

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
