import type { Index, Task } from "meilisearch";
import { describe, expect, it } from "vitest";

import {
	applySearchProjectionPlan,
	SearchOutboxAbortError,
	type SearchOutboxProgress,
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

function taskPromise(taskUid: number) {
	return Promise.resolve({ taskUid }) as ReturnType<Index["addDocuments"]>;
}

describe("search task cancellation", () => {
	it("passes the worker signal into a pending Meilisearch task request", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | null | undefined;
		let requestStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const index = {
			addDocuments: () => taskPromise(71),
			tasks: {
				getTask: (_uid: number, request?: RequestInit) => {
					observedSignal = request?.signal;
					requestStarted();
					return new Promise<Task>(() => undefined);
				},
			},
		} as unknown as Index;

		const processing = applySearchProjectionPlan(
			index,
			plan,
			10_000,
			20 * 1024 * 1024,
			{ signal: controller.signal },
		);
		await started;
		controller.abort();

		await expect(processing).rejects.toBeInstanceOf(SearchOutboxAbortError);
		expect(observedSignal).toBe(controller.signal);
	});

	it("does not invent batch progress for a task without a batch", async () => {
		const progress: SearchOutboxProgress[] = [];
		const index = {
			addDocuments: () => taskPromise(72),
			tasks: {
				getTask: async () =>
					({
						batchUid: null,
						error: null,
						status: "succeeded",
						uid: 72,
					}) as Task,
			},
		} as unknown as Index;

		await applySearchProjectionPlan(index, plan, 10_000, 20 * 1024 * 1024, {
			onProgress: async (nextProgress) => {
				progress.push(nextProgress);
			},
		});

		expect(progress.at(-1)).toMatchObject({
			batchProgress: null,
			batchUid: null,
			stage: "indexing",
			taskUid: 72,
		});
	});
});
