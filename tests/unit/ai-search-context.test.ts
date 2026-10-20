import { describe, expect, it } from "vitest";

import {
	CURRENT_RESULTS_WINDOW_SIZE,
	createCurrentResultsCursor,
	currentResultsOffset,
} from "@/lib/ai/current-results-cursor";
import {
	librarySearchContextSchema,
	librarySearchContextSummary,
	normalizeLibrarySearchContext,
	type LibrarySearchContext,
} from "@/lib/search-context";

function context(
	overrides: Partial<LibrarySearchContext> = {},
): LibrarySearchContext {
	return normalizeLibrarySearchContext({
		search: "teacher training",
		scope: "title_and_abstract",
		sort: "relevance",
		range: "2019-2024",
		institution: ["EdTech Hub"],
		country: [],
		author: "",
		collections: [],
		...overrides,
	});
}

describe("the library result set the assistant can see", () => {
	it("keeps the user's own search, scope, sort, and filters", () => {
		expect(context()).toEqual({
			search: "teacher training",
			scope: "title_and_abstract",
			sort: "relevance",
			range: "2019-2024",
			institution: ["EdTech Hub"],
			country: [],
			author_country: [],
			author: "",
			collections: [],
			topics: [],
			type: [],
			study: [],
			readerList: null,
		});
	});

	it("keeps the chosen study types, so the assistant and exports read the same results the list shows", () => {
		const chosen = context({ study: ["meta-analysis"] });
		expect(chosen.study).toEqual(["meta-analysis"]);
		expect(JSON.parse(librarySearchContextSummary(chosen)).studyTypes).toEqual(["meta-analysis"]);
	});

	it("keeps the chosen item types, so the assistant reads the same results the list shows", () => {
		const chosen = context({ type: ["Thesis", "Report"] });
		expect(chosen.type).toEqual(["Thesis", "Report"]);
		expect(JSON.parse(librarySearchContextSummary(chosen)).itemTypes).toEqual(["Thesis", "Report"]);
	});

	it("survives a half-typed year range instead of throwing", () => {
		expect(context({ range: "-" }).range).toBe("");
		expect(context({ range: "2020-" }).range).toBe("2020-");
	});

	it("falls back to the library default for an unknown scope or sort", () => {
		expect(context({ scope: "made-up-scope" }).scope).toBe("");
		expect(context({ sort: "made-up-sort" }).sort).toBe("relevance");
	});

	it("survives a filter value far longer than the search accepts", () => {
		const context = normalizeLibrarySearchContext({
			search: "teacher training",
			author: "a".repeat(500),
			institution: ["b".repeat(500), "  ", "EdTech Hub"],
		});

		expect(context.author).toHaveLength(300);
		expect(context.institution).toEqual(["b".repeat(300), "EdTech Hub"]);
	});

	it("rejects an unknown field rather than passing it to search", () => {
		expect(() =>
			librarySearchContextSchema.parse({
				...context(),
				injectedFilter: "anything",
			}),
		).toThrow();
	});

	it("describes itself to the model in plain fields", () => {
		const summary = JSON.parse(librarySearchContextSummary(context()));

		expect(summary).toMatchObject({
			query: "teacher training",
			scope: "title_and_abstract",
			yearRange: "2019-2024",
			institutions: ["EdTech Hub"],
		});
		expect(
			JSON.parse(librarySearchContextSummary(context({ scope: "" })))
				.scope,
		).toBe("library default");
	});
});

describe("reading further into the current results", () => {
	it("continues from where the last window stopped", () => {
		const cursor = createCurrentResultsCursor(
			context(),
			CURRENT_RESULTS_WINDOW_SIZE,
		);

		expect(currentResultsOffset(context(), cursor)).toBe(
			CURRENT_RESULTS_WINDOW_SIZE,
		);
		expect(currentResultsOffset(context())).toBe(0);
	});

	it("refuses a cursor from a search the user has since changed", () => {
		const cursor = createCurrentResultsCursor(context(), 200);

		expect(() =>
			currentResultsOffset(context({ search: "school meals" }), cursor),
		).toThrow(/current library search changed/i);
	});

	it("refuses a cursor someone tampered with", () => {
		expect(() => currentResultsOffset(context(), "not-a-cursor")).toThrow(
			/current library search changed/i,
		);
	});
});
