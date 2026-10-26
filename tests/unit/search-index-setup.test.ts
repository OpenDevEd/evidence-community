import { errors } from "@elastic/elasticsearch";
import { describe, expect, it } from "vitest";

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
function search(options: { aliasExists: boolean; bulkItems?: Array<Record<string, unknown>> }) {
	const calls: Call[] = [];
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
				return { library_1793000000000: { aliases: { library: {} } } };
			},
			create: record("create"),
			updateAliases: record("updateAliases"),
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
	it("writes records and deletions through the alias, searchable when the last write returns", async () => {
		const { calls, service } = search({ aliasExists: true, bulkItems: [{ delete: { _id: "CCCC3333", status: 404, error: { type: "not_found" } } }] });

		await applySearchProjectionPlan(elasticsearchWriter(service), plan, 30_000, 1_024);

		const bulks = calls.filter((call) => call.api === "bulk").map((call) => call.request);
		expect(bulks.map((request) => request.refresh)).toEqual([false, "wait_for"]);
		expect(bulks[0]!.operations).toEqual([
			{ index: { _index: "library", _id: "AAAA1111" } },
			plan.documents[0],
			{ index: { _index: "library", _id: "BBBB2222" } },
			plan.documents[1],
		]);
		expect(bulks[1]!.operations).toEqual([{ delete: { _index: "library", _id: "CCCC3333" } }]);
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

	it("retries the whole write when Elasticsearch is overloaded", async () => {
		const { service } = search({
			aliasExists: true,
			bulkItems: [{ index: { _id: "AAAA1111", status: 429, error: { type: "es_rejected_execution_exception", reason: "queue full" } } }],
		});

		await expect(applySearchProjectionPlan(elasticsearchWriter(service), { ...plan, deleteKeys: [] })).rejects.toBeInstanceOf(SearchIndexWriteError);
	});
});
