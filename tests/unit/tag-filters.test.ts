import { describe, expect, it } from "vitest";
import { pageTagCounts } from "../../src/lib/admin/openscholar-tags";
import { parseOpenScholarInstitutionRequest } from "../../src/lib/admin/institution-catalog-contract";
import { collectionNodes, deepestTicked } from "../../src/lib/collections-match";
import { tagFilterOptions, tagParam, tagSelections, WHOLE_LIBRARY_TAGS, type TagFilter } from "../../src/lib/tag-filters";

const status: TagFilter = {
	id: "status", label: "Status", enabled: true, placement: "card", defaults: ["Reviewed"],
	options: [{ value: "Selected", prefix: false }, { value: "Reviewed", prefix: false }],
};
const domain: TagFilter = {
	id: "domain", label: "Domain", enabled: true, placement: "picker", defaults: [],
	options: [{ value: "Domain: ", prefix: true }, { value: "Domain: AIG", prefix: false, label: "Item Generation" }],
};
const filters = [status, domain];

describe("tag filter ticks in the address", () => {
	it("ticks a filter's defaults when the address says nothing, and leaves them out of it", () => {
		const ticks = tagSelections([], filters);
		expect(ticks).toEqual({ status: ["Reviewed"], domain: [] });
		expect(tagParam(ticks, filters)).toEqual([]);
	});

	it("keeps a filter the reader emptied empty, rather than its defaults coming back", () => {
		const param = tagParam({ status: [], domain: [] }, filters);
		expect(param).toEqual(["status:*"]);
		expect(tagSelections(param, filters).status).toEqual([]);
	});

	it("applies no defaults where the whole library is asked for", () => {
		expect(tagSelections(WHOLE_LIBRARY_TAGS, filters)).toEqual({ status: [], domain: [] });
	});

	it("reads a tag that contains the separator whole", () => {
		const param = tagParam({ status: ["Reviewed"], domain: ["Domain: AIG"] }, filters);
		expect(param).toEqual(["domain:Domain: AIG"]);
		expect(tagSelections(param, filters)).toEqual({ status: ["Reviewed"], domain: ["Domain: AIG"] });
	});
});

describe("a tag filter's options", () => {
	it("lists a prefix's tags by count without the prefix, and a named tag under its own label in its own place", () => {
		const options = tagFilterOptions(domain, { "Domain: Feedback": 5, "Domain: AIG": 9, "Domain: Scoring": 7, Other: 3 }, []);
		expect(options).toEqual([
			{ tag: "Domain: Scoring", label: "Scoring", count: 7 },
			{ tag: "Domain: Feedback", label: "Feedback", count: 5 },
			{ tag: "Domain: AIG", label: "Item Generation", count: 9 },
		]);
	});

	it("keeps a ticked option that no result carries", () => {
		expect(tagFilterOptions(status, { Selected: 2 }, ["Reviewed"]).map((option) => option.tag)).toEqual(["Selected", "Reviewed"]);
	});
});

describe("collections that match any", () => {
	it("lets a ticked child narrow its ticked parent and keeps other branches", () => {
		const nodes = collectionNodes([
			{ key: "IG", parentCollection: null },
			{ key: "IG-R", parentCollection: "IG" },
			{ key: "FF", parentCollection: null },
			{ key: "FF-R", parentCollection: "FF" },
			{ key: "AS", parentCollection: null },
		]);
		expect(deepestTicked(["IG", "IG-R", "FF", "FF-R", "AS"], nodes).sort()).toEqual(["AS", "FF-R", "IG-R"]);
	});
});

describe("the tag list OpenScholar pages through", () => {
	const counts = { b: 2, a: 2, c: 5, d: 1 };
	it("pages by count, ties by name, without skipping or repeating", () => {
		const first = pageTagCounts(counts, parseOpenScholarInstitutionRequest({ pageSize: "2" }));
		const second = pageTagCounts(counts, parseOpenScholarInstitutionRequest({ pageSize: "2", cursor: first.nextCursor }));
		expect([...first.items, ...second.items].map((row) => row.name)).toEqual(["c", "a", "b", "d"]);
		expect(second.nextCursor).toBeNull();
	});

	it("finds tags by any part of their name, whatever the case", () => {
		expect(pageTagCounts({ "Domain: AIG": 1, Reviewed: 2 }, parseOpenScholarInstitutionRequest({ query: "aig" })).items).toEqual([{ name: "Domain: AIG", count: 1 }]);
	});
});
