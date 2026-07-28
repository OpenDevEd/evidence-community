// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const posthogInstances = vi.hoisted(
	() =>
		[] as Array<{
			capture: ReturnType<typeof vi.fn>;
			get_distinct_id: ReturnType<typeof vi.fn>;
			init: ReturnType<typeof vi.fn>;
			opt_in_capturing: ReturnType<typeof vi.fn>;
			opt_out_capturing: ReturnType<typeof vi.fn>;
		}>,
);

vi.mock("posthog-js", () => ({
	PostHog: class {
		capture = vi.fn();
		get_distinct_id = vi.fn(() => "runtime-distinct-id");
		init = vi.fn();
		opt_in_capturing = vi.fn();
		opt_out_capturing = vi.fn();

		constructor() {
			posthogInstances.push(this);
		}
	},
}));

import {
	getAnalyticsDistinctId,
	initializeClientAnalytics,
	markGoogleAnalyticsReady,
	trackPageView,
} from "@/lib/analytics";

describe("runtime browser analytics", () => {
	beforeEach(() => {
		window.dataLayer = [];
		window.gtag = undefined;
	});

	it("enables and flushes Google Analytics without PostHog", () => {
		expect(
			initializeClientAnalytics({
				posthog: {},
				google: { measurementId: "G-RUNTIME1" },
				utmDurationSeconds: 600,
			}),
		).toBe(true);

		trackPageView("/library?private=value");
		expect(window.dataLayer).toEqual([]);

		markGoogleAnalyticsReady("G-RUNTIME1");
		expect(window.dataLayer).toContainEqual([
			"event",
			"page_view",
			{
				page_path: "/library",
				send_to: "G-RUNTIME1",
			},
		]);
	});

	it("initializes and captures with the configured PostHog instance", () => {
		expect(
			initializeClientAnalytics({
				posthog: {
					host: "https://analytics.runtime.example",
					key: "phc_1234567890123456",
				},
				google: {},
				utmDurationSeconds: 600,
			}),
		).toBe(true);

		const client = posthogInstances.at(-1);
		expect(client?.init).toHaveBeenCalledWith(
			"phc_1234567890123456",
			expect.objectContaining({
				advanced_disable_flags: true,
				api_host: "https://analytics.runtime.example",
				disable_external_dependency_loading: true,
				opt_out_persistence_by_default: true,
			}),
		);
		expect(getAnalyticsDistinctId()).toBe("runtime-distinct-id");

		trackPageView("/configured");
		expect(client?.capture).toHaveBeenCalledWith("page_view", {
			pagePath: "/configured",
		});
	});

	it("disables analytics when no vendor is configured", () => {
		expect(
			initializeClientAnalytics({
				posthog: {},
				google: {},
				utmDurationSeconds: 600,
			}),
		).toBe(false);
		expect(getAnalyticsDistinctId()).toBeNull();
	});
});
