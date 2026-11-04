import { MeilisearchApiError, type Index, type Meilisearch, type Task } from "meilisearch";
import { describe, expect, it, vi } from "vitest";

import type { MeilisearchService } from "@/lib/meilisearch-factory";
import { applySearchProjectionPlan, SearchOutboxAbortError, type SearchOutboxProgress } from "@/lib/search-index/consumer";
import { EMBEDDER_TASK_POLL_INTERVAL_MS } from "@/lib/search-index/embedder-settings";
import { applySearchIndexEmbedder, meilisearchWriter, SearchIndexTaskError } from "@/lib/search-index/meilisearch-writer";
import type { SearchProjectionPlan } from "@/lib/search-index/projection";

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
	options: { settingsCalls?: unknown[]; taskStatus?: Task["status"]; taskErrorCode?: string } = {},
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
						? { code: options.taskErrorCode ?? "vector_embedding_error", link: "", message: "embedding failed", type: "invalid_request" }
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
		deleteIndex: () => {
			events.push("delete");
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
	return { client, index, indexName: "items" };
}

const writer = (target: MeilisearchService, taskTimeoutMs = 10_000) => meilisearchWriter(target, { taskTimeoutMs });

describe("search index setup", () => {
	it("reports a newly created index", async () => {
		const events: string[] = [];
		await expect(writer(service(false, events)).ensure({ onMissing: async () => void events.push("mark-pending") })).resolves.toEqual({ created: true });
		expect(events).toEqual(["mark-pending", "create"]);
	});

	it("reports an existing index", async () => {
		await expect(writer(service(true)).ensure({})).resolves.toEqual({ created: false });
	});

	it("waits for a settings task as long as Meilisearch makes progress, and gives up once it stalls", async () => {
		// The task is queued for its first five polls, then in batch 7 until the tenth.
		const run = (progressFor: (poll: number) => number | Error) => {
			const target = service(true);
			let polls = 0;
			(target.index as unknown as { tasks: unknown }).tasks = {
				getTask: async (uid: number) => {
					polls++;
					return { ...succeededTask(uid), batchUid: polls <= 5 ? null : 7, status: polls <= 5 ? "enqueued" : polls < 10 ? "processing" : "succeeded" };
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
			return writer(target, 300).ensure({});
		};

		// Ten polls 100 ms apart take three times the timeout.
		await expect(run((poll) => poll)).resolves.toEqual({ created: false });
		await expect(run(() => 10)).rejects.toMatchObject({ name: "MeilisearchTaskTimeOutError" });
		// A failed progress read is not progress.
		await expect(run((poll) => (poll % 2 ? new Error("unavailable") : 10))).rejects.toMatchObject({ name: "MeilisearchTaskTimeOutError" });
	});

	it("keeps every result reachable, past the 10,000 Elasticsearch pages by number", async () => {
		const settingsCalls: unknown[] = [];
		await writer(service(true, [], { settingsCalls })).ensure({});
		expect(settingsCalls[0]).toMatchObject({ pagination: { maxTotalHits: 10_000_000 } });
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
			let calls = 0;
			const getTask = vi.fn(async (uid: number) => ({ ...succeededTask(uid), status: ++calls < 3 ? "processing" : "succeeded" }));
			const target = service(true);
			(target.index as unknown as { tasks: { getTask: unknown } }).tasks = { getTask };
			const pending = applySearchIndexEmbedder(target, restEmbedder);
			await vi.advanceTimersByTimeAsync(EMBEDDER_TASK_POLL_INTERVAL_MS - 1);
			expect(getTask).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(EMBEDDER_TASK_POLL_INTERVAL_MS * 2);
			await pending;
			expect(getTask).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("sends only the embedders setting and returns the task", async () => {
		const settingsCalls: unknown[] = [];
		const result = await applySearchIndexEmbedder(service(true, [], { settingsCalls }), restEmbedder);
		expect(result.status).toBe("succeeded");
		expect(Object.keys(settingsCalls[0] as object)).toEqual(["embedders"]);
		expect((settingsCalls[0] as { embedders: Record<string, unknown> }).embedders).toHaveProperty("default.source", "rest");
	});

	it("removes the embedder when the library has none", async () => {
		const settingsCalls: unknown[] = [];
		await applySearchIndexEmbedder(service(true, [], { settingsCalls }), null);
		expect(settingsCalls[0]).toEqual({ embedders: { default: null, openai: null } });
	});

	it("throws the task error when Meilisearch rejects the embedder", async () => {
		await expect(applySearchIndexEmbedder(service(true, [], { taskStatus: "failed" }), restEmbedder)).rejects.toBeInstanceOf(SearchIndexTaskError);
	});
});

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

const withIndex = (index: Index): MeilisearchService => ({ client: {} as Meilisearch, index, indexName: "items" });

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

		const processing = applySearchProjectionPlan(writer(withIndex(index)), plan, 10_000, 20 * 1024 * 1024, { signal: controller.signal });
		await started;
		controller.abort();

		await expect(processing).rejects.toBeInstanceOf(SearchOutboxAbortError);
		expect(observedSignal).toBe(controller.signal);
	});

	it("does not invent batch progress for a task without a batch", async () => {
		const progress: SearchOutboxProgress[] = [];
		const index = {
			addDocuments: () => taskPromise(72),
			tasks: { getTask: async () => ({ batchUid: null, error: null, status: "succeeded", uid: 72 }) as Task },
		} as unknown as Index;

		await applySearchProjectionPlan(writer(withIndex(index)), plan, 10_000, 20 * 1024 * 1024, {
			onProgress: async (nextProgress) => {
				progress.push(nextProgress);
			},
		});

		expect(progress.at(-1)).toMatchObject({ batchProgress: null, batchUid: null, stage: "indexing", taskUid: 72 });
	});
});

describe("an in-place rebuild", () => {
	it("replaces records, deletes the ones PostgreSQL no longer has, then writes back any published again meanwhile", async () => {
		const target = service(true);
		const added: string[][] = [];
		const deleted: string[][] = [];
		let taskUid = 100;
		Object.assign(target.index, {
			getDocuments: async () => ({ results: [{ key: "ABRT2345" }, { key: "GONE2345" }] }),
			addDocuments: (documents: Array<{ key: string }>) => {
				added.push(documents.map(({ key }) => key));
				return taskPromise(++taskUid);
			},
			deleteDocuments: (keys: string[]) => {
				deleted.push(keys);
				return taskPromise(++taskUid);
			},
		});
		async function* plans() {
			yield plan;
		}
		const reproject = vi.fn(async function* (keys: readonly string[]) {
			yield { ...plan, documents: [{ ...plan.documents[0], key: keys[0]! }] };
		});
		await expect(writer(target).rebuild(plans(), { maxDocumentBatchBytes: 20 * 1024 * 1024, taskTimeoutMs: 10_000, reproject })).resolves.toEqual({ indexed: 1, deleted: 1 });
		expect(deleted).toEqual([["GONE2345"]]);
		expect(reproject).toHaveBeenCalledWith(["GONE2345"]);
		expect(added).toEqual([["ABRT2345"], ["GONE2345"]]);
	});
});

describe("removing a library's Meilisearch index", () => {
	it("deletes it, and counts an index already gone as removed", async () => {
		const events: string[] = [];
		await writer(service(true, events)).remove();
		expect(events).toEqual(["delete"]);
		await expect(writer(service(true, [], { taskStatus: "failed", taskErrorCode: "index_not_found" })).remove()).resolves.toBeUndefined();
		await expect(writer(service(true, [], { taskStatus: "failed", taskErrorCode: "internal" })).remove()).rejects.toBeInstanceOf(SearchIndexTaskError);
	});
});
