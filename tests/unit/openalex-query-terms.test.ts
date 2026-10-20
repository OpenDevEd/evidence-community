import { describe, expect, it } from "vitest";

import { queryTerms } from "@/lib/source-ingestion/openalex/query-terms";

describe("counting what an OpenAlex search looks for", () => {
	it("counts each word, phrase and topic once across queries, leaving out operators and filters", () => {
		const first = `works where (title has (TVET or stemmed "vocational education" or (VET and not veterinary)) or topics.id is (T11122 or T10533)) and title/abstract has "formation professionnelle" and has_abstract is (true) and has DOI is (true) and authorships.institutions.display_name is ("School has Network") and open_access.is_oa is (true) and is_retracted is (false)`;
		const second = `works where title has (tvet or "职业训练" or "T12345 in quotes") and topics.id is (T10533)`;
		expect(queryTerms([{ oql: first }, { oql: second }])).toEqual({ terms: 7, topics: 2 });
	});

	it("counts a search and its filter the same way, so a library built without OQL shows its terms", () => {
		const classic = {
			filter: `publication_year:2019-2026,type:article|review,title_and_abstract.search:("wealth gap" OR wages) AND (income OR "Wealth gap" OR "a, b"),topics.id:T10001|T10002`,
			search: "poverty",
		};
		const oql = { oql: `works where title has (poverty or "wealth gap")` };
		expect(queryTerms([classic, oql])).toEqual({ terms: 5, topics: 2 });
	});

	it("reads filters as OpenAlex does: any case, no_stem searches, alternatives split by | and proximity left out", () => {
		const query = {
			filter: `TITLE.SEARCH:poverty|wages,abstract.search.no_stem:"climate change"~5 OR inequality,Topics.Id:t10001|T10002`,
		};
		expect(queryTerms([query])).toEqual({ terms: 4, topics: 2 });
	});
});
