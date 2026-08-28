import { describe, expect, it } from "vitest";

import {
	aggregateAnalyticsEventSchema,
	normalizeAggregateAnalyticsProperties,
} from "@/lib/analytics-event-schema";

describe("aggregate analytics events", () => {
	it("rejects unknown events and content-bearing properties", () => {
		expect(
			aggregateAnalyticsEventSchema.safeParse({
				event: "library_results_loaded",
				properties: {
					has_search: true,
					filter_count: 2,
					page: 1,
					page_result_count: 20,
					total_result_count: 125,
					scope: "all",
					sort: "relevance",
					query: "private search text",
				},
			}).success,
		).toBe(false);

		for (const forbidden of ["prompt", "title", "filename", "response"]) {
			expect(
				aggregateAnalyticsEventSchema.safeParse({
					event: "page_view",
					properties: { pagePath: "/lib", [forbidden]: "private" },
				}).success,
			).toBe(false);
		}

		expect(
			aggregateAnalyticsEventSchema.safeParse({
				event: "arbitrary_event",
				properties: {},
			}).success,
		).toBe(false);
	});

	it("removes query strings and fragments from page paths", () => {
		const parsed = aggregateAnalyticsEventSchema.parse({
			event: "page_view",
			properties: { pagePath: "/lib?search=secret#result" },
		});

		expect(normalizeAggregateAnalyticsProperties(parsed)).toEqual({
			page_path: "/lib",
		});
	});
});
