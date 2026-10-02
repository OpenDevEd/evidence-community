import { describe, expect, it } from "vitest";

import { queryTerms } from "@/lib/source-ingestion/openalex/query-terms";

describe("counting what an OpenAlex search looks for", () => {
	it("counts each word, phrase and topic once across queries, leaving out operators and filters", () => {
		const first = `works where (title has (TVET or stemmed "vocational education" or (VET and not veterinary)) or topics.id is (T11122 or T10533)) and title/abstract has "formation professionnelle" and has_abstract is (true) and open_access.is_oa is (true) and is_retracted is (false)`;
		const second = `works where title has (tvet or "职业训练" or "T12345 in quotes") and topics.id is (T10533)`;
		expect(queryTerms([first, second])).toEqual({ terms: 7, topics: 2 });
	});
});
