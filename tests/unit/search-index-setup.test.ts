import { errors } from "@elastic/elasticsearch";
import { describe, expect, it, vi } from "vitest";

import type { SearchService } from "@/lib/elasticsearch-factory";
import {
	applySearchProjectionPlan,
	ensureSearchIndex,
	SearchIndexDocumentError,
	SearchIndexWriteError,
} from "@/lib/search-index/consumer";
import { SEARCH_INDEX_VERSION } from "@/lib/search-index/elasticsearch-index";
import { elasticsearchWriter } from "@/lib/search-index/elasticsearch-writer";
import type { SearchProjectionPlan } from "@/lib/search-index/projection";

type Call = { api: string; request: Record<string, unknown> };

function notFound() {
	return new errors.ResponseError({
		body: { error: { type: "aliases_not_found_exception" }, status: 404 },
		statusCode: 404,
		headers: {},
		warnings: null,
		meta: {} as never,
	});
}

/** A stand-in for the Elasticsearch client: it records requests and answers bulk writes with `bulkItems`. */
function search(options: { aliasExists: boolean; bulkItems?: Array<Record<string, unknown>>; aliasMoveTimesOut?: boolean }) {
	const calls: Call[] = [];
	let aliased = "library_1793000000000";
	const record = (api: string) => async (request: Record<string, unknown>) => {
		calls.push({ api, request });
		return {};
	};
	const client = {
		bulk: async (request: Record<string, unknown>) => {
			calls.push({ api: "bulk", request });
			const items = options.bulkItems ?? [];
			return { errors: items.some((item) => Object.values(item)[0] && (Object.values(item)[0] as { error?: unknown }).error), items };
		},
		indices: {
			getAlias: async (request: Record<string, unknown>) => {
				calls.push({ api: "getAlias", request });
				if (!options.aliasExists) throw notFound();
				return { [aliased]: { aliases: { library: {} } } };
			},
			create: record("create"),
			updateAliases: async (request: { actions: Array<{ add?: { index: string } }> }) => {
				calls.push({ api: "updateAliases", request });
				aliased = request.actions.find((action) => action.add)?.add?.index ?? aliased;
				// Elasticsearch moved the alias, but the answer never reached the worker.
				if (options.aliasMoveTimesOut) throw new Error("Request timed out");
				return {};
			},
			refresh: record("refresh"),
			putSettings: record("putSettings"),
			delete: record("delete"),
			forcemerge: record("forcemerge"),
			stats: async () => ({ _all: { primaries: { store: { size_in_bytes: 12 * 1024 ** 3 } } } }),
			resolveIndex: async () => ({ indices: [{ name: "library_1793000000000" }, { name: "library_1792000000000" }] }),
		},
	};
	return { calls, service: { alias: "library", client } as unknown as SearchService };
}

// Only the keys matter to the writer; the rest of a search document passes through unchanged.
const plan = {
	documents: [{ key: "AAAA1111", title: "One" }, { key: "BBBB2222", title: "Two" }],
	deleteKeys: ["CCCC3333"],
} as unknown as SearchProjectionPlan;

describe("search index setup", () => {
	it("creates the first index behind the library's alias after marking the rebuild", async () => {
		const events: string[] = [];
		const { calls, service } = search({ aliasExists: false });

		await expect(ensureSearchIndex(elasticsearchWriter(service), { onMissing: async () => void events.push("mark-pending") })).resolves.toEqual({
			created: true,
		});

		const create = calls.find((call) => call.api === "create")!;
		expect(events).toEqual(["mark-pending"]);
		expect(create.request.index).toMatch(/^library_\d+$/);
		expect((create.request.mappings as { _meta: unknown })._meta).toEqual({ version: SEARCH_INDEX_VERSION });
		expect(calls.find((call) => call.api === "updateAliases")!.request).toEqual({
			actions: [{ add: { index: create.request.index, alias: "library", is_write_index: true } }],
		});
	});

	it("leaves an existing index alone", async () => {
		const { calls, service } = search({ aliasExists: true });

		await expect(ensureSearchIndex(elasticsearchWriter(service))).resolves.toEqual({ created: false });
		expect(calls.map((call) => call.api)).toEqual(["getAlias"]);
	});
});

describe("search index writes", () => {
	it("writes records and deletions through the alias, then makes them searchable once", async () => {
		const { calls, service } = search({ aliasExists: true, bulkItems: [{ delete: { _id: "CCCC3333", status: 404, error: { type: "not_found" } } }] });

		await applySearchProjectionPlan(elasticsearchWriter(service), plan, 30_000, 1_024);

		expect(calls.map((call) => call.api)).toEqual(["bulk", "bulk", "refresh"]);
		const bulks = calls.filter((call) => call.api === "bulk").map((call) => call.request);
		// A missing alias fails the write rather than create an index under its name.
		expect(bulks.map((request) => request.require_alias)).toEqual([true, true]);
		expect(bulks[0]!.operations).toEqual([
			{ index: { _index: "library", _id: "AAAA1111" } },
			plan.documents[0],
			{ index: { _index: "library", _id: "BBBB2222" } },
			plan.documents[1],
		]);
		expect(bulks[1]!.operations).toEqual([{ delete: { _index: "library", _id: "CCCC3333" } }]);
	});

	it("writes each record as of when its claim began reading, leaving one a later read already wrote", async () => {
		const { calls, service } = search({
			aliasExists: true,
			bulkItems: [{ index: { _id: "AAAA1111", status: 409, error: { type: "version_conflict_engine_exception", reason: "current version is higher" } } }],
		});

		await applySearchProjectionPlan(elasticsearchWriter(service), plan, 30_000, 1_024, { readFrom: 1_793_000_000_000 });

		const bulks = calls.filter((call) => call.api === "bulk").map((call) => call.request);
		const versioned = { version: 1_793_000_000_000, version_type: "external_gte" };
		expect(bulks[0]!.operations).toContainEqual({ index: { _index: "library", _id: "AAAA1111", ...versioned } });
		expect(bulks[1]!.operations).toEqual([{ delete: { _index: "library", _id: "CCCC3333", ...versioned } }]);
	});

	it("names the records Elasticsearch refused for their content", async () => {
		const { service } = search({
			aliasExists: true,
			bulkItems: [
				{ index: { _id: "AAAA1111", status: 201 } },
				{ index: { _id: "BBBB2222", status: 400, error: { type: "document_parsing_exception", reason: "failed to parse field [year]" } } },
			],
		});

		const failure = applySearchProjectionPlan(elasticsearchWriter(service), { ...plan, deleteKeys: [] });
		await expect(failure).rejects.toBeInstanceOf(SearchIndexDocumentError);
		await expect(failure).rejects.toMatchObject({
			failures: [{ key: "BBBB2222", reason: "document_parsing_exception: failed to parse field [year]" }],
		});
	});

	it("retries a deletion when the index itself is missing", async () => {
		const { service } = search({
			aliasExists: true,
			bulkItems: [{ delete: { _id: "CCCC3333", status: 404, error: { type: "index_not_found_exception", reason: "no such index [library]" } } }],
		});

		await expect(applySearchProjectionPlan(elasticsearchWriter(service), { ...plan, documents: [] })).rejects.toBeInstanceOf(SearchIndexWriteError);
	});

	it("retries the whole write when Elasticsearch is overloaded", async () => {
		const { service } = search({
			aliasExists: true,
			bulkItems: [{ index: { _id: "AAAA1111", status: 429, error: { type: "es_rejected_execution_exception", reason: "queue full" } } }],
		});

		await expect(applySearchProjectionPlan(elasticsearchWriter(service), { ...plan, deleteKeys: [] })).rejects.toBeInstanceOf(SearchIndexWriteError);
	});
});

describe("an Elasticsearch rebuild", () => {
	const rebuildOptions = { maxDocumentBatchBytes: 1_024 * 1_024, taskTimeoutMs: 30_000, reproject: async function* () {} };
	async function* plans() {
		yield { documents: plan.documents, deleteKeys: [] } as unknown as SearchProjectionPlan;
	}

	it("deletes what an earlier rebuild left behind, swaps the alias, then merges into segments Elasticsearch still merges", async () => {
		const { calls, service } = search({ aliasExists: true });
		await expect(elasticsearchWriter(service).rebuild(plans(), rebuildOptions)).resolves.toMatchObject({ indexed: 2, deleted: 2 });
		const deletes = calls.filter((call) => call.api === "delete").map((call) => call.request.index);
		expect(deletes).toEqual([["library_1792000000000"], ["library_1793000000000"]]);
		// 12 GiB merges into three segments of at most 5 GiB.
		expect(calls.find((call) => call.api === "forcemerge")?.request).toMatchObject({ max_num_segments: 3, wait_for_completion: false });
	});

	it("keeps its new index when the alias moved though the request failed, as readers search it", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { calls, service } = search({ aliasExists: true, aliasMoveTimesOut: true });
		await expect(elasticsearchWriter(service).rebuild(plans(), rebuildOptions)).rejects.toThrow("Request timed out");
		const created = calls.find((call) => call.api === "create")?.request.index;
		expect(calls.filter((call) => call.api === "delete").map((call) => call.request.index)).not.toContainEqual(created);
		error.mockRestore();
	});

	it("deletes its half-built index when a write fails, and leaves readers on the old one", async () => {
		const { calls, service } = search({
			aliasExists: true,
			bulkItems: [{ index: { _id: "AAAA1111", status: 503, error: { type: "unavailable_shards_exception", reason: "no shard" } } }],
		});
		await expect(elasticsearchWriter(service).rebuild(plans(), rebuildOptions)).rejects.toBeInstanceOf(SearchIndexWriteError);
		const created = calls.find((call) => call.api === "create")?.request.index;
		expect(calls.filter((call) => call.api === "delete").map((call) => call.request.index)).toContainEqual(created);
		expect(calls.some((call) => call.api === "updateAliases")).toBe(false);
	});
});
