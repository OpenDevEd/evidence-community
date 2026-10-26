import {
	MeilisearchApiError,
	type Index,
	type Meilisearch,
	type Task,
} from "meilisearch";
import { describe, expect, it, vi } from "vitest";

import type { MeilisearchService } from "@/lib/meilisearch-factory";
import {
	applySearchIndexEmbedder,
	EMBEDDER_TASK_POLL_INTERVAL_MS,
	EMBEDDER_TASK_TIMEOUT_MS,
	ensureSearchIndex,
	SearchIndexTaskError,
} from "@/lib/search-index/consumer";

function succeededTask(uid: number): Task {
	return {
		batchUid: null,
		canceledBy: null,
		details: {},
		duration: "PT0S",
		enqueuedAt: "2026-08-14T10:00:00.000Z",
		error: null,
		finishedAt: "2026-08-14T10:00:00.000Z",
		indexUid: "items",
		startedAt: "2026-08-14T10:00:00.000Z",
		status: "succeeded",
		type: "indexCreation",
		uid,
	};
}

function service(
	indexExists: boolean,
	events: string[] = [],
	options: {
		settingsCalls?: unknown[];
		taskStatus?: Task["status"];
	} = {},
): MeilisearchService {
	let taskUid = 0;
	const nextTask = () => Promise.resolve({ taskUid: ++taskUid });
	const index = {
		tasks: {
			getTask: async (uid: number) => ({
				...succeededTask(uid),
				status: options.taskStatus ?? "succeeded",
				error:
					options.taskStatus === "failed"
						? {
								code: "vector_embedding_error",
								link: "",
								message: "embedding failed",
								type: "invalid_request",
							}
						: null,
			}),
		},
		updateSettings: (settings: unknown) => {
			options.settingsCalls?.push(settings);
			return nextTask();
		},
	} as unknown as Index;
	const client = {
		createIndex: () => {
			events.push("create");
			return nextTask();
		},
		getRawIndex: async () => {
			if (indexExists) return { uid: "items" };
			throw new MeilisearchApiError(new Response(null, { status: 404 }), {
				code: "index_not_found",
				link: "https://www.meilisearch.com/docs/reference/errors/error_codes#index-not-found",
				message: "Index items not found.",
				type: "invalid_request",
			});
		},
	} as unknown as Meilisearch;
	return {
		client,
		index,
		indexName: "items",
		redirectsIndex: index,
	};
}

describe("search index setup", () => {
	it("reports a newly created index", async () => {
		const events: string[] = [];
		await expect(
			ensureSearchIndex(service(false, events), {
				onMissing: async () => {
					events.push("mark-pending");
				},
			}),
		).resolves.toEqual({
			created: true,
		});
		expect(events).toEqual(["mark-pending", "create"]);
	});

	it("reports an existing index", async () => {
		await expect(ensureSearchIndex(service(true))).resolves.toEqual({
			created: false,
		});
	});

	it("waits for a settings task as long as Meilisearch makes progress, and gives up once it stalls", async () => {
		// The task is queued for its first five polls, then in batch 7 until the tenth.
		const run = (progressFor: (poll: number) => number | Error) => {
			const target = service(true);
			let polls = 0;
			(target.index as unknown as { tasks: unknown }).tasks = {
				getTask: async (uid: number) => {
					polls++;
					return {
						...succeededTask(uid),
						batchUid: polls <= 5 ? null : 7,
						status: polls <= 5 ? "enqueued" : polls < 10 ? "processing" : "succeeded",
					};
				},
			};
			const progress = async () => {
				const value = progressFor(polls);
				if (value instanceof Error) throw value;
				return { uid: 6, progress: { percentage: value } };
			};
			(target.client as unknown as { batches: unknown }).batches = {
				getBatch: progress,
				getBatches: async () => ({ results: [await progress()] }),
			};
			return ensureSearchIndex(target, { taskTimeoutMs: 300 });
		};

		// Ten polls 100 ms apart take three times the timeout.
		await expect(run((poll) => poll)).resolves.toEqual({ created: false });
		await expect(run(() => 10)).rejects.toMatchObject({ name: "MeilisearchTaskTimeOutError" });
		// A failed progress read is not progress.
		await expect(run((poll) => (poll % 2 ? new Error("unavailable") : 10))).rejects.toMatchObject({
			name: "MeilisearchTaskTimeOutError",
		});
	});
});

describe("search index embedder", () => {
	const restEmbedder = {
		source: "rest" as const,
		url: "http://embedder.internal:8080/embed",
		request: { input: "{{text}}" },
		response: { embedding: "{{embedding}}" },
	};

	it("polls the embedder task at the slow interval", async () => {
		vi.useFakeTimers();
		try {
			const getTask = vi.fn();
			let calls = 0;
			getTask.mockImplementation(async (uid: number) => ({
				...succeededTask(uid),
				status: ++calls < 3 ? "processing" : "succeeded",
			}));
			const target = service(true);
			(target.index as unknown as { tasks: { getTask: unknown } }).tasks =
				{
					getTask,
				};
			const pending = applySearchIndexEmbedder(target, restEmbedder);
			await vi.advanceTimersByTimeAsync(
				EMBEDDER_TASK_POLL_INTERVAL_MS - 1,
			);
			expect(getTask).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(
				EMBEDDER_TASK_POLL_INTERVAL_MS * 2,
			);
			await pending;
			expect(getTask).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("sends only the embedders setting and returns the task", async () => {
		const settingsCalls: unknown[] = [];
		const result = await applySearchIndexEmbedder(
			service(true, [], { settingsCalls }),
			restEmbedder,
		);
		expect(result.status).toBe("succeeded");
		expect(settingsCalls).toHaveLength(1);
		expect(Object.keys(settingsCalls[0] as object)).toEqual(["embedders"]);
		expect(
			(settingsCalls[0] as { embedders: Record<string, unknown> })
				.embedders,
		).toHaveProperty("default.source", "rest");
	});

	it("removes the embedder when the library has none", async () => {
		const settingsCalls: unknown[] = [];
		await applySearchIndexEmbedder(
			service(true, [], { settingsCalls }),
			null,
		);
		expect(settingsCalls[0]).toEqual({
			embedders: { default: null, openai: null },
		});
	});

	it("throws the task error when Meilisearch rejects the embedder", async () => {
		await expect(
			applySearchIndexEmbedder(
				service(true, [], { taskStatus: "failed" }),
				restEmbedder,
			),
		).rejects.toBeInstanceOf(SearchIndexTaskError);
	});
});
