import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const search = vi.hoisted(() => vi.fn());
const publicationToolModelOutput = vi.hoisted(() => vi.fn());

vi.mock("@/lib/elasticsearch", () => ({
	getSearchForConfig: vi.fn(async () => ({ alias: "library", client: { search } })),
}));
vi.mock("@/lib/ai/attachments", () => ({ publicationToolModelOutput }));
// The search compiler reaches the collection cache and the sign-in actions,
// which drag in the whole authenticated app; these tests only need its
// search filters.
vi.mock("@/app/api/cache", () => ({
	getCachedCollections: vi.fn(async () => []),
	getCachedItem: vi.fn(),
}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn(async () => true) }));
// The topic catalog lives in OpenScholar; the reader's topic is a known leaf.
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/topics/catalog", () => ({
	resolveTopicAncestry: vi.fn(async () => [{ id: "T12260", parent: null }]),
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	createResearchToolSchemas,
	validateSearchFiltersAgainstUserRequest,
} from "@/lib/ai/tool-schemas";
import { PDF_HANDOFF_TEXT } from "@/lib/ai/prompt-context";
import { createResearchTools } from "@/lib/ai/tools";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { cloneLibraryConfig } from "../fixtures/library-config";

const config = libraryConfigSchema.parse(cloneLibraryConfig());

function userMessages(text: string) {
	return [{ role: "user" as const, content: text }];
}

function searchInput(
	mode: "quick" | "research",
	input: Record<string, unknown>,
) {
	return createResearchToolSchemas(mode).searchLibrary.parse(input);
}

async function runSearch(
	mode: "quick" | "research",
	input: Record<string, unknown>,
	text = "teacher training",
) {
	const tools = createResearchTools(mode, config);
	return tools.searchLibrary.execute?.(searchInput(mode, input), {
		messages: userMessages(text),
		toolCallId: "call-1",
	} as never);
}

/** An Elasticsearch answer holding these records. */
function found(records: Array<Record<string, unknown>>, total = records.length) {
	return { hits: { total: { value: total, relation: "eq" }, hits: records.map((record) => ({ _source: record })) } };
}

function searchOptions(callIndex = 0) {
	return search.mock.calls[callIndex]?.[0] as { size: number; query: { bool: { filter: unknown[] } } };
}

function filtersOf(callIndex = 0) {
	return searchOptions(callIndex).query.bool.filter;
}

describe("what the search tool may be asked for", () => {
	it("accepts at most five queries and ten results each", () => {
		expect(() =>
			searchInput("quick", {
				queries: ["a", "b", "c", "d", "e", "f"],
			}),
		).toThrow();
		expect(() =>
			searchInput("quick", { queries: ["a"], limitPerQuery: 11 }),
		).toThrow();
		expect(searchInput("quick", { queries: ["one"] }).limitPerQuery).toBe(
			10,
		);
	});

	it("asks Deep Research for more than one query", () => {
		expect(() => searchInput("research", { queries: ["only one"] })).toThrow(
			/at least 2 queries/i,
		);
		expect(
			searchInput("research", { queries: ["one", "two"] }).queries,
		).toHaveLength(2);
	});

	it("allows an empty query list only for listing the current results", () => {
		expect(() => searchInput("quick", { queries: [] })).toThrow();
		expect(
			searchInput("quick", { queries: [], withinCurrentResults: true })
				.withinCurrentResults,
		).toBe(true);
	});

	it("reads at most five publications at once, ten in Deep Research", () => {
		const keys = Array.from({ length: 6 }, (_, index) => `KEY${index}`);
		const quick = createResearchToolSchemas("quick").readPublications;
		const research = createResearchToolSchemas("research").readPublications;

		expect(() => quick.parse({ itemKeys: keys })).toThrow();
		expect(research.parse({ itemKeys: keys }).itemKeys).toHaveLength(6);
		expect(() =>
			research.parse({
				itemKeys: Array.from({ length: 11 }, (_, i) => `K${i}`),
			}),
		).toThrow();
	});

	it("drops a year range the reader never asked for", () => {
		const filters = { yearRange: [2019, 2024] as [number, number] };

		expect(
			validateSearchFiltersAgainstUserRequest(
				filters,
				"papers about teacher training",
			),
		).toMatchObject({
			effectiveFilters: {},
			ignoredFilters: [expect.stringContaining("yearRange")],
		});
		expect(
			validateSearchFiltersAgainstUserRequest(
				filters,
				"recent papers about teacher training",
			).effectiveFilters,
		).toEqual(filters);
	});
});

describe("searching the library for the assistant", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		search.mockResolvedValue(found([
			{
				key: "ITEM0001",
				title: "Teaching by radio",
				abstractNote: "<p>Radio &amp; learning</p>",
				creators: [{ lastName: "Ada", firstName: "Grace" }],
				year: 2024,
				hasPdf: true,
			},
		]));
	});

	it("returns publication metadata with a readable abstract and link", async () => {
		const result = (await runSearch("quick", {
			queries: ["radio teaching"],
		})) as {
			queries: Array<{ hits: Array<Record<string, unknown>> }>;
		};

		expect(result.queries[0].hits[0]).toMatchObject({
			key: "ITEM0001",
			abstract: "Radio & learning",
			hasPdf: true,
			citation: "/lib/ITEM0001",
		});
	});

	it("searches with the library's own filters", async () => {
		await runSearch("quick", { queries: ["radio teaching"] });

		expect(filtersOf()).toEqual(expect.arrayContaining([{ bool: { must_not: [{ term: { deleted: 1 } }] } }]));
		expect(searchOptions().size).toBe(10);
	});

	it("keeps Deep Research on publications that have a PDF", async () => {
		await runSearch("research", { queries: ["radio", "schools"] });

		expect(filtersOf()).toEqual(expect.arrayContaining([{ term: { hasPdf: true } }]));
	});

	it("lets Deep Research widen the search when PDFs are missing", async () => {
		await runSearch("research", {
			queries: ["radio", "schools"],
			filters: { pdfOnly: false },
		});

		expect(filtersOf()).not.toContainEqual({ term: { hasPdf: true } });
	});

	it("refuses to search inside results the reader does not have", async () => {
		await expect(
			runSearch("quick", {
				queries: ["radio"],
				withinCurrentResults: true,
			}),
		).rejects.toThrow(/no current library result set/i);
	});

	it("lists the reader's own results in their own order", async () => {
		search.mockResolvedValue(found([
			{ key: "ITEM0001", title: "First", creators: [] },
			{ key: "ITEM0002", title: "Second", creators: [] },
		]));
		const tools = createResearchTools(
			"quick",
			config,
			normalizeLibrarySearchContext({ search: "radio" }),
		);

		const result = (await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: [], withinCurrentResults: true }),
			{ messages: userMessages("what is on my list?") } as never,
		)) as {
			currentResults: {
				entries: Array<{ position: number; key: string }>;
				total: number;
			};
		};

		expect(result.currentResults.entries).toEqual([
			expect.objectContaining({ position: 1, key: "ITEM0001" }),
			expect.objectContaining({ position: 2, key: "ITEM0002" }),
		]);
		expect(result.currentResults.total).toBe(2);
	});

	it("reads only the records of a reader's list on their profile", async () => {
		search.mockResolvedValue(found([]));
		const tools = createResearchTools(
			"quick",
			config,
			normalizeLibrarySearchContext({ readerList: { userId: "reader-amina", collectionId: "" } }),
			"request-1",
			["SAVED001", "SAVED002"],
		);

		await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: [], withinCurrentResults: true }),
			{ messages: userMessages("compare these") } as never,
		);

		expect(filtersOf()).toEqual(expect.arrayContaining([{ terms: { key: ["SAVED001", "SAVED002"] } }]));
	});

	it("keeps the reader's year range when PDFs were read before the search", async () => {
		const tools = createResearchTools("quick", config);
		const messages = [
			{ role: "user" as const, content: "What else since 2020 fits this collection?" },
			{ role: "user" as const, content: [{ type: "text" as const, text: PDF_HANDOFF_TEXT }] },
		];

		const result = (await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: ["automated feedback"], filters: { yearRange: [2020, 2026] } }),
			{ messages } as never,
		)) as { appliedFilters: { yearRange?: number[] }; ignoredFilters: string[] };

		expect(result.ignoredFilters).toEqual([]);
		expect(result.appliedFilters.yearRange).toEqual([2020, 2026]);
	});

	it("tells which library hits are already on the reader's list, so only new ones are recommended", async () => {
		search.mockResolvedValue(found([{ key: "SAVED001" }, { key: "OTHER001" }]));
		const tools = createResearchTools(
			"quick",
			config,
			normalizeLibrarySearchContext({ readerList: { userId: "reader-amina", collectionId: "" } }),
			"request-1",
			["SAVED001", "SAVED002"],
		);

		const result = (await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: ["teacher training"], withinCurrentResults: false }),
			{ messages: userMessages("what else would fit this collection?") } as never,
		)) as { queries: Array<{ hits: Array<{ key: string; inCurrentList: boolean }> }> };

		expect(filtersOf()).not.toContainEqual({ terms: { key: ["SAVED001", "SAVED002"] } });
		expect(result.queries[0].hits.map(({ key, inCurrentList }) => ({ key, inCurrentList }))).toEqual([
			{ key: "SAVED001", inCurrentList: true },
			{ key: "OTHER001", inCurrentList: false },
		]);
	});

	it("keeps the reader's topic filter when reading their results", async () => {
		search.mockResolvedValue(found([]));
		const tools = createResearchTools(
			"quick",
			{ ...config, topics: { ...config.topics, enabled: true } },
			normalizeLibrarySearchContext({ search: "radio", topics: ["T12260"] }),
		);

		await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: [], withinCurrentResults: true }),
			{ messages: userMessages("what is on my list?") } as never,
		);

		expect(filtersOf()).toEqual(
			expect.arrayContaining([{ terms: { topicAncestors: expect.arrayContaining(["T12260"]) } }]),
		);
	});

	it("reads each requested publication once", async () => {
		const tools = createResearchTools("quick", config);
		const input = { itemKeys: ["ITEM0001", "ITEM0001", "ITEM0002"] };

		const result = (await tools.readPublications.execute?.(
			input,
			{} as never,
		)) as { requestedItemKeys: string[] };
		await tools.readPublications.toModelOutput?.({ input } as never);

		expect(result.requestedItemKeys).toEqual(["ITEM0001", "ITEM0002"]);
		expect(publicationToolModelOutput).toHaveBeenCalledWith([
			"ITEM0001",
			"ITEM0002",
		]);
	});
});
