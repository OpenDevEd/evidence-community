import { describe, expect, it } from "vitest";

import { draftElasticsearchSearch } from "../../tools/search-comparison/draft-elasticsearch";

function request(overrides: Partial<Parameters<typeof draftElasticsearchSearch>[0]>) {
	return {
		search: "",
		pageNum: 1,
		limitNum: 20,
		sortOption: undefined,
		finalFilters: [],
		facetFilters: [],
		attributesToSearchOn: ["title", "abstractNote", "tags", "fullNames"],
		country: [],
		authorCountry: [],
		...overrides,
	} as Parameters<typeof draftElasticsearchSearch>[0];
}

describe("draft Elasticsearch search for the engine comparison", () => {
	it("translates the filters a reader's search sends to Meilisearch", () => {
		const body = draftElasticsearchSearch(
			request({
				search: "learning analytics",
				finalFilters: [
					'itemType NOT IN ["Note","Attachment","Annotation"]',
					"year >= 2023 AND year <= 2025",
					'collectionsAncestry = "COLL1234"',
					"deleted != 1",
					'tags NOT IN ["hidden"]',
					"fullTextPDFs.fullTextPDF.page EXISTS",
				],
			}),
			40,
		);

		expect(body).toMatchObject({ from: 40, size: 20, track_total_hits: true, _source: false });
		expect(body.query.bool.must).toEqual([
			{
				multi_match: {
					query: "learning analytics",
					type: "bool_prefix",
					fields: ["title", "abstractNote", "tags.text", "fullNames.text"],
					fuzziness: "AUTO",
				},
			},
		]);
		expect(body.query.bool.filter).toEqual([
			{ range: { year: { gte: 2023 } } },
			{ range: { year: { lte: 2025 } } },
			{ term: { collectionsAncestry: "COLL1234" } },
			{ exists: { field: "fullTextPDFs.fullTextPDF.page" } },
		]);
		expect(body.query.bool.must_not).toEqual([
			{ terms: { itemType: ["Note", "Attachment", "Annotation"] } },
			{ term: { deleted: 1 } },
			{ terms: { tags: ["hidden"] } },
		]);
	});

	it("sorts titles and authors on their whole-value fields, missing values last", () => {
		expect(draftElasticsearchSearch(request({ sortOption: ["title:asc"] }), 0).sort).toEqual([
			{ "title.sort": { order: "asc", missing: "_last" } },
		]);
		expect(draftElasticsearchSearch(request({ sortOption: ["fullNames:desc"] }), 0).sort).toEqual([
			{ fullNames: { order: "desc", missing: "_last", mode: "max" } },
		]);
	});

	it("refuses a filter it cannot translate instead of dropping it", () => {
		expect(() => draftElasticsearchSearch(request({ finalFilters: ['(country = "GB" OR authorCountry = "GB")'] }), 0)).toThrow(
			/cannot translate/,
		);
	});
});
