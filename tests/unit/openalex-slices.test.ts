import { describe, expect, it } from "vitest";

import { slicedQuery } from "@/lib/source-ingestion/openalex/slices";

describe("slicedQuery", () => {
	it("adds a slice's dates to a search and filter, ending the day before the next slice", () => {
		const query = { search: "AI in education", filter: "type:article" };
		expect(slicedQuery(query, { from: "2024-01-01", to: "2024-03-01" })).toEqual({
			search: "AI in education",
			filter: "type:article,from_publication_date:2024-01-01,to_publication_date:2024-02-29",
		});
		expect(slicedQuery({ search: "AI" }, { from: null, to: "2020-01-01" })).toEqual({ search: "AI", filter: "to_publication_date:2019-12-31" });
		expect(slicedQuery({ search: "AI" }, null)).toEqual({ search: "AI", filter: "publication_date:null" });
	});

	it("wraps an OQL query's conditions before adding a slice's dates", () => {
		expect(slicedQuery({ oql: "works where title has AI or abstract has AI" }, { from: "2024-01-01", to: null })).toEqual({
			oql: "works where (title has AI or abstract has AI) and publication_date >= 2024-01-01",
		});
		expect(slicedQuery({ oql: "works where title has AI" }, null)).toEqual({ oql: "works where (title has AI) and publication_date is null" });
	});
});
