import { describe, expect, it } from "vitest";

import type { SearchService } from "@/lib/elasticsearch-factory";
import {
	applySearchProjectionPlan,
	SearchOutboxAbortError,
} from "@/lib/search-index/consumer";
import type { SearchProjectionPlan } from "@/lib/search-index/projection";

const plan = {
	deleteKeys: [],
	documents: [
		{
			collections: [],
			collectionsAncestry: [],
			deleted: 0,
			key: "ABRT2345",
			provider: "native",
			revision: 1,
			sourceConnectionKey: "native",
			sourceExternalScopeKey: null,
			sourceRecordKey: "ABRT2345",
			tags: [],
			topicAncestors: [],
			topics: [],
		},
	],
} satisfies SearchProjectionPlan;

describe("search write cancellation", () => {
	it("passes the worker signal into a pending Elasticsearch write and reports a stop, not a failure", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		let requestStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const search = {
			alias: "library",
			client: {
				bulk: (_request: unknown, options: { signal?: AbortSignal }) => {
					observedSignal = options.signal;
					requestStarted();
					return new Promise((_, reject) => {
						options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")));
					});
				},
			},
		} as unknown as SearchService;

		const writing = applySearchProjectionPlan(search, plan, 10_000, 20 * 1024 * 1024, { signal: controller.signal });
		await started;
		controller.abort();

		await expect(writing).rejects.toBeInstanceOf(SearchOutboxAbortError);
		expect(observedSignal).toBe(controller.signal);
	});
});
