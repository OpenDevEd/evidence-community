import {
	MeilisearchApiError,
	type Index,
	type Meilisearch,
	type Task,
} from "meilisearch";
import { describe, expect, it } from "vitest";

import type { MeilisearchService } from "@/lib/meilisearch-factory";
import { ensureSearchIndex } from "@/lib/search-index/consumer";

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
): MeilisearchService {
	let taskUid = 0;
	const nextTask = () => Promise.resolve({ taskUid: ++taskUid });
	const index = {
		tasks: {
			getTask: async (uid: number) => succeededTask(uid),
		},
		updateSettings: nextTask,
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
		cacheIndex: index,
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
});
