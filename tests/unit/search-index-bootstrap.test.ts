import { describe, expect, it } from "vitest";

import {
	resolveIdleLastError,
	resolveRebuildTaskTimeoutMs,
	shouldRebuildSearchIndex,
} from "@/lib/search-index/bootstrap-state";
import { EMBEDDER_TASK_TIMEOUT_MS } from "@/lib/search-index/consumer";

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

describe("search index worker embedder state", () => {
	it("keeps a failed embedder visible after records index successfully", () => {
		expect(
			resolveIdleLastError({
				embedderError: "SearchIndexTaskError: embedding failed",
				previousLastError: "SearchIndexTaskError: embedding failed",
				processedEvents: 12,
			}),
		).toBe("SearchIndexTaskError: embedding failed");
	});

	it("clears an ordinary batch error once records index successfully", () => {
		expect(
			resolveIdleLastError({
				embedderError: null,
				previousLastError: "MeilisearchTaskTimeOutError: task 9",
				processedEvents: 3,
			}),
		).toBeNull();
	});

	it("keeps the previous error when nothing was processed", () => {
		expect(
			resolveIdleLastError({
				embedderError: null,
				previousLastError: "MeilisearchTaskTimeOutError: task 9",
				processedEvents: 0,
			}),
		).toBe("MeilisearchTaskTimeOutError: task 9");
	});

	it("falls back to the embedder error when the previous state has none", () => {
		expect(
			resolveIdleLastError({
				embedderError: "SearchIndexTaskError: embedding failed",
				previousLastError: null,
				processedEvents: 0,
			}),
		).toBe("SearchIndexTaskError: embedding failed");
	});

	it("gives rebuild document tasks the embedding wait only when the embedder is active", () => {
		const embedder = {
			source: "openAi" as const,
			model: "text-embedding-3-small",
			apiKey: "key",
		};
		expect(
			resolveRebuildTaskTimeoutMs({ embedder, embedderError: null }),
		).toBe(EMBEDDER_TASK_TIMEOUT_MS);
		expect(
			resolveRebuildTaskTimeoutMs({
				embedder,
				embedderError: "SearchIndexTaskError: embedding failed",
			}),
		).toBeUndefined();
		expect(
			resolveRebuildTaskTimeoutMs({
				embedder: null,
				embedderError: null,
			}),
		).toBeUndefined();
	});
});
