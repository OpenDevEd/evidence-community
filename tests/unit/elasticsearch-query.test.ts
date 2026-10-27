import { describe, expect, it } from "vitest";

import { fieldIn, fieldNotEquals, fieldPresent, yearRange } from "@/lib/search-engine";
import { facetAggregations, facetDistribution, filterClause, sortClauses, textQuery } from "@/lib/search-engines/elasticsearch-query";

const relevance = sortClauses(undefined, { text: "tutoring" });

describe("a filter in Elasticsearch", () => {
	it("becomes term, terms, exists and range clauses, negated or any of them", () => {
		expect(filterClause(fieldIn("country", ["KE", "QA"]))).toEqual({ terms: { country: ["KE", "QA"] } });
		expect(filterClause(fieldNotEquals("deleted", 1))).toEqual({ bool: { must_not: [{ term: { deleted: 1 } }] } });
		expect(filterClause(fieldPresent("hasPdf"))).toEqual({ exists: { field: "hasPdf" } });
		expect(filterClause(yearRange("2015-2020")!)).toEqual({ range: { year: { gte: 2015, lte: 2020 } } });
		expect(filterClause({ any: [fieldPresent("a"), fieldPresent("b")] })).toEqual({
			bool: { should: [{ exists: { field: "a" } }, { exists: { field: "b" } }], minimum_should_match: 1 },
		});
	});
});

describe("the order of results", () => {
	it("ranks a search by relevance, and always ends on the record key so ties keep one order", () => {
		expect(relevance).toEqual([{ _score: { order: "desc" } }, { key: { order: "asc" } }]);
		expect(sortClauses(["title:asc"])).toEqual([{ "title.sort": { order: "asc", missing: "_last" } }, { key: { order: "asc" } }]);
	});

	it("sorts a search's ties by the chosen order, as Meilisearch put its sort after relevance", () => {
		expect(sortClauses(["citationCount:desc"], { text: "knowledge tracing" })).toEqual([
			{ _score: { order: "desc" } },
			{ citationCount: { order: "desc", missing: "_last" } },
			{ key: { order: "asc" } },
		]);
	});

	it("lists records by key when nothing is searched or sorted", () => {
		expect(sortClauses(undefined)).toEqual([{ key: { order: "asc" } }]);
		expect(sortClauses(undefined, { text: "  " })).toEqual([{ key: { order: "asc" } }]);
	});

	it("reads backwards with every direction flipped", () => {
		expect(sortClauses(["year:desc"], { reverse: true })).toEqual([{ year: { order: "asc", missing: "_first" } }, { key: { order: "desc" } }]);
		expect(sortClauses(undefined, { text: "tutoring", reverse: true })).toEqual([{ _score: { order: "asc" } }, { key: { order: "desc" } }]);
	});
});

describe("the text of a search", () => {
	const clauses = (text: string, attributes = ["title", "abstractNote", "tags", "fullNames"]) => JSON.stringify(textQuery(text, attributes));

	it("is no query when there are no words", () => {
		expect(textQuery("  ", ["title"])).toBeNull();
	});

	it("needs only the first word, with Meilisearch's typos, and ranks records with the other words higher", () => {
		const query = textQuery("knowledge tracing", ["title"]) as { bool: { filter: unknown[]; should: unknown[] } };
		expect(JSON.stringify(query.bool.filter)).toContain('"query":"knowledge"');
		expect(JSON.stringify(query.bool.filter)).not.toContain("tracing");
		expect(clauses("knowledge tracing")).toContain('"fuzziness":"AUTO:5,9"');
		expect(JSON.stringify(query.bool.should)).toContain('"query":"tracing"');
	});

	it("takes the last word as the start of every longer word", () => {
		expect(clauses("generat")).toContain('"type":"bool_prefix"');
		expect(clauses("generat")).not.toContain("phrase_prefix");
	});

	it("leaves out words with no letter or digit, as Meilisearch read them as separators", () => {
		const query = textQuery("- teacher & learning", ["title"]) as { bool: { filter: unknown[] } };
		expect(JSON.stringify(query.bool.filter)).toContain('"query":"teacher"');
		expect(clauses("- teacher & learning")).not.toContain('"query":"&"');
		expect(textQuery("& -", ["title"])).toBeNull();
		// The exact title keeps what was typed.
		expect(clauses("Teaching & Learning", ["title"])).toContain('"title.sort":{"value":"Teaching & Learning"');
	});

	it("searches whole-value fields by their words, and an earlier field ranks higher", () => {
		const query = textQuery("tutoring", ["title", "abstractNote", "tags", "fullNames"]) as { bool: { should: Array<{ dis_max?: { queries: unknown[] } }> } };
		const fieldTier = query.bool.should.find((clause) => clause.dis_max)!.dis_max!.queries.map((clause) => [
			(clause as { constant_score: { boost: number } }).constant_score.boost,
			JSON.stringify(clause).match(/"fields":\["([^"]+)"\]/u)?.[1],
		]);
		expect(fieldTier).toEqual([[90, "title"], [80, "abstractNote"], [70, "tags.text"], [60, "fullNames.text"]]);
	});

	it("searches the first ten words, as Meilisearch did", () => {
		expect(clauses("one two three four five six seven eight nine ten eleven")).not.toContain("eleven");
	});

	it("ranks titles that start with the words, then the exact title, only without a chosen order", () => {
		expect(clauses("tutor copilot")).toContain('"title.start"');
		const sorted = JSON.stringify(textQuery("tutor copilot", ["title"], { sorted: true }));
		expect(sorted).not.toContain("title.start");
		expect(sorted).not.toContain("title.sort");
	});

	it("finds the start of a title with typos, and a long enough last word as the start of a longer one", () => {
		expect(clauses("machne")).toContain('"fuzzy":{"term":"machne"');
		expect(clauses("generat")).toContain('"prefix":{"prefix":"generat"}');
		// A short prefix can name more words than Elasticsearch expands, which would fail the search.
		expect(clauses("ab")).not.toContain('"prefix":{"prefix"');
		// A word the index holds as several terms is matched as a phrase.
		expect(clauses("self-regulated")).toContain('"match":{"query":"self-regulated"');
		expect(clauses("教育")).toContain('"match":{"query":"教育"');
	});

	it("ranks a record whose title is the search first only when titles are searched", () => {
		expect(clauses("Tutor CoPilot", ["title"])).toContain('"title.sort":{"value":"Tutor CoPilot"');
		expect(clauses("Tutor CoPilot", ["abstractNote"])).not.toContain("title.sort");
	});

	it("orders records the rules tie by Elasticsearch's relevance, worth less than the smallest rule, only without a chosen order", () => {
		const query = textQuery("machine learning", ["fullTextPDFs.fullTextPDF.text"]) as { bool: { should: Array<{ multi_match?: { boost?: number; type?: string } }> } };
		const relevance = query.bool.should.filter((clause) => clause.multi_match && !clause.multi_match.type);
		expect(relevance).toHaveLength(1);
		expect(relevance[0]!.multi_match!.boost! * 50).toBeLessThan(2);
		expect(JSON.stringify(textQuery("machine learning", ["title"], { sorted: true }))).not.toContain('"boost":0.01');
	});
});

describe("facet counts", () => {
	it("lists counted facets by count and the rest by value", () => {
		expect(facetAggregations(["country", "year"])).toEqual({
			country: { terms: { field: "country", size: 10_000, order: { _count: "desc" } } },
			year: { terms: { field: "year", size: 10_000, order: { _key: "asc" } } },
		});
	});

	it("counts tags and names ignoring case and accents, each named as most of its records spell it", () => {
		expect(facetAggregations(["tags"])).toMatchObject({
			tags: { terms: { field: "tags" }, aggs: { spelling: { terms: { field: "tags.raw", size: 1 } } } },
		});
		expect(
			facetDistribution({
				tags: {
					buckets: [
						{ key: "oecd", doc_count: 8, spelling: { buckets: [{ key: "OECD", doc_count: 5 }] } },
						// An index from before the spelling was kept names the value as it is filtered.
						{ key: "policy brief", doc_count: 2, spelling: { buckets: [] } },
					],
				},
			}),
		).toEqual({ tags: { OECD: 8, "policy brief": 2 } });
	});

	it("reads each value's count, naming true and false as words", () => {
		expect(
			facetDistribution({
				country: { buckets: [{ key: "KE", doc_count: 4 }, { key: "QA", doc_count: 1 }] },
				hasPdf: { buckets: [{ key: 1, key_as_string: "true", doc_count: 2 }] },
			}),
		).toEqual({ country: { KE: 4, QA: 1 }, hasPdf: { true: 2 } });
		expect(facetDistribution(undefined)).toEqual({});
	});
});
