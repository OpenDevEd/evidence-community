import assert from "node:assert/strict";
import test from "node:test";
import {
	aggregateAnalyticsEventSchema,
	normalizeAggregateAnalyticsProperties,
} from "./analytics-event-schema";

test("aggregate events reject unlisted and content-bearing properties", () => {
	assert.equal(
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
		false,
	);

	assert.equal(
		aggregateAnalyticsEventSchema.safeParse({
			event: "arbitrary_event",
			properties: {},
		}).success,
		false,
	);
});

test("aggregate page events remove query strings and fragments", () => {
	const parsed = aggregateAnalyticsEventSchema.parse({
		event: "page_view",
		properties: { pagePath: "/lib?search=secret#result" },
	});

	assert.deepEqual(normalizeAggregateAnalyticsProperties(parsed), {
		page_path: "/lib",
	});
});
