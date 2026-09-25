import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const search = vi.hoisted(() => vi.fn());
const publicationToolModelOutput = vi.hoisted(() => vi.fn());

vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: vi.fn(async () => ({ index: { search } })),
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
import { createResearchTools } from "@/lib/ai/tools";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { FULL_TEXT_PDF_FILTER } from "@/lib/search-filter-constants";
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

function searchOptions(callIndex = 0) {
	return search.mock.calls[callIndex]?.[1] as Record<string, unknown>;
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
		search.mockResolvedValue({
			hits: [
				{
					key: "ITEM0001",
					title: "Teaching by radio",
					abstractNote: "<p>Radio &amp; learning</p>",
					creators: [{ lastName: "Ada", firstName: "Grace" }],
					year: 2024,
				},
			],
			estimatedTotalHits: 1,
		});
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
			citation: "/lib/ITEM0001",
		});
	});

	it("uses the library's semantic search and its own filters", async () => {
		await runSearch("quick", { queries: ["radio teaching"] });

		const options = searchOptions();
		expect(options.hybrid).toEqual({
			embedder: "default",
			semanticRatio: 0.5,
		});
		expect(options.filter).toEqual(
			expect.arrayContaining(["deleted != 1"]),
		);
		expect(options.limit).toBe(10);
	});

	it("keeps Deep Research on publications that have full text", async () => {
		await runSearch("research", { queries: ["radio", "schools"] });

		expect(searchOptions().filter).toEqual(
			expect.arrayContaining([FULL_TEXT_PDF_FILTER]),
		);
	});

	it("lets Deep Research widen the search when full text is missing", async () => {
		await runSearch("research", {
			queries: ["radio", "schools"],
			filters: { fullTextOnly: false },
		});

		expect(searchOptions().filter).not.toContain(FULL_TEXT_PDF_FILTER);
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
		search.mockResolvedValue({
			hits: [
				{ key: "ITEM0001", title: "First", creators: [] },
				{ key: "ITEM0002", title: "Second", creators: [] },
			],
			estimatedTotalHits: 2,
		});
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

	it("keeps the reader's topic filter when reading their results", async () => {
		search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
		const tools = createResearchTools(
			"quick",
			{ ...config, topics: { ...config.topics, enabled: true } },
			normalizeLibrarySearchContext({ search: "radio", topics: ["T12260"] }),
		);

		await tools.searchLibrary.execute?.(
			searchInput("quick", { queries: [], withinCurrentResults: true }),
			{ messages: userMessages("what is on my list?") } as never,
		);

		expect(searchOptions().filter).toEqual(
			expect.arrayContaining([expect.stringContaining("T12260")]),
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
