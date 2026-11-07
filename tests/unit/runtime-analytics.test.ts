// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
	moduleLoads: 0,
	instances: [] as Array<{
		capture: ReturnType<typeof vi.fn>;
		get_distinct_id: ReturnType<typeof vi.fn>;
		init: ReturnType<typeof vi.fn>;
		opt_in_capturing: ReturnType<typeof vi.fn>;
		opt_out_capturing: ReturnType<typeof vi.fn>;
		set_config: ReturnType<typeof vi.fn>;
		setPersonProperties: ReturnType<typeof vi.fn>;
		startSessionRecording: ReturnType<typeof vi.fn>;
		stopSessionRecording: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("posthog-js/dist/module.full.no-external", () => {
	posthog.moduleLoads += 1;
	return {
		PostHog: class {
			capture = vi.fn();
			get_distinct_id = vi.fn(() => "runtime-distinct-id");
			init = vi.fn();
			opt_in_capturing = vi.fn();
			opt_out_capturing = vi.fn();
			set_config = vi.fn();
			setPersonProperties = vi.fn();
			startSessionRecording = vi.fn();
			stopSessionRecording = vi.fn();

			constructor() {
				posthog.instances.push(this);
			}
		},
	};
});

import {
	applyClientAnalyticsConsent,
	clearAnalyticsStorage,
	getAnalyticsDistinctId,
	markGoogleAnalyticsReady,
	trackLibraryResultsLoaded,
	trackPageView,
} from "@/lib/analytics";

const baseConfiguration = {
	analytics: {
		consentPolicyVersion: 1,
		google: {},
		posthog: {},
		utmDurationSeconds: 600,
	},
	scope: "https://library.example.org",
};

describe("runtime browser analytics", () => {
	beforeEach(() => {
		window.dataLayer = [];
		window.gtag = undefined;
		posthog.instances.length = 0;
		clearAnalyticsStorage();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 202 })),
		);
	});

	afterEach(() => vi.unstubAllGlobals());

	it("does not load a vendor while consent is pending or denied", async () => {
		await applyClientAnalyticsConsent(baseConfiguration, "pending", {
			analytics: false,
			sessionReplay: false,
		});
		await applyClientAnalyticsConsent(baseConfiguration, "denied", {
			analytics: false,
			sessionReplay: false,
		});

		expect(posthog.instances).toHaveLength(0);
		expect(window.dataLayer).toEqual([]);
	});

	it("enables Google only after consent and strips query text", async () => {
		await expect(
			applyClientAnalyticsConsent(
				{
					...baseConfiguration,
					analytics: {
						...baseConfiguration.analytics,
						google: { measurementId: "G-RUNTIME1" },
					},
				},
				"granted",
				{ analytics: true, sessionReplay: false },
			),
		).resolves.toBe(true);

		trackPageView("/library?private=value");
		expect(window.dataLayer).not.toContainEqual(
			expect.arrayContaining(["private"]),
		);

		markGoogleAnalyticsReady("G-RUNTIME1");
		expect(window.dataLayer).toContainEqual([
			"event",
			"page_view",
			{
				page_location: "http://localhost:3000/library",
				page_path: "/library",
				send_to: "G-RUNTIME1",
			},
		]);
	});

	it("creates a consented anonymous profile and keeps replay separate", async () => {
		await applyClientAnalyticsConsent(
			{
				...baseConfiguration,
				analytics: {
					...baseConfiguration.analytics,
					posthog: {
						host: "https://analytics.runtime.example",
						uiHost: "https://analytics-ui.runtime.example",
						key: "phc_1234567890123456",
					},
				},
			},
			"granted",
			{ analytics: true, sessionReplay: false },
		);

		const client = posthog.instances.at(-1);
		expect(client?.init).toHaveBeenCalledWith(
			"phc_1234567890123456",
			expect.objectContaining({
				api_host: "https://analytics.runtime.example",
				ui_host: "https://analytics-ui.runtime.example",
				// Its own host-only cookie, which a site on the parent domain never reads or clears.
				cross_subdomain_cookie: false,
				persistence_name: "community",
				person_profiles: "always",
				disable_session_recording: true,
			}),
		);
		expect(client?.setPersonProperties).toHaveBeenCalledWith(
			expect.objectContaining({
				consent_policy_version: 1,
				session_replay_enabled: false,
			}),
		);
		expect(client?.startSessionRecording).not.toHaveBeenCalled();
		expect(getAnalyticsDistinctId()).toBe("runtime-distinct-id");
	});

	it("keeps the ingestion token while removing private event properties", async () => {
		const key = "phc_1234567890123456";
		await applyClientAnalyticsConsent(
			{
				...baseConfiguration,
				analytics: {
					...baseConfiguration.analytics,
					posthog: { host: "https://analytics.runtime.example", key },
				},
			},
			"granted",
			{ analytics: true, sessionReplay: false },
		);
		const options = posthog.instances.at(-1)?.init.mock.calls[0]?.[1];
		const event = options.before_send({
			event: "$pageview",
			$set: { locale: "en", email: "reader@example.org" },
			$set_once: {
				$initial_current_url: "https://library.example.org/lib?search=private",
			},
			properties: {
				token: key,
				distinct_id: "visitor-id",
				$current_url: "https://library.example.org/lib?search=private",
				password: "private",
				access_token: "private",
				search_query: "private",
				$heatmap_data: {
					"https://library.example.org/lib?search=one": [{ x: 1, y: 2 }],
					"https://library.example.org/lib?search=two": [{ x: 3, y: 4 }],
					"https://library.example.org/lib": [{ x: 5, y: 6 }],
				},
				$set_once: {
					$initial_current_url: "https://library.example.org/lib?email=reader@example.org",
					$initial_referrer: "https://example.org/private",
					access_token: "private",
				},
				$web_vitals_LCP_event: {
					$current_url: "https://library.example.org/lib?search=private",
					value: 123,
					attribution: [{ target: "reader@example.org", token: "private" }],
				},
			},
		});
		expect(event).toEqual({
			event: "$pageview",
			$set: { locale: "en" },
			$set_once: { $initial_current_url: "https://library.example.org/lib" },
			properties: {
				token: key,
				distinct_id: "visitor-id",
				$current_url: "https://library.example.org/lib",
				environment: "library.example.org",
				$heatmap_data: {
					"https://library.example.org/lib": [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }],
				},
				$set_once: { $initial_current_url: "https://library.example.org/lib" },
				$web_vitals_LCP_event: {
					$current_url: "https://library.example.org/lib",
					value: 123,
					attribution: [{ target: "[redacted-email]" }],
				},
			},
		});
	});

	it("tears down the old client when the tenant changes or consent is revoked", async () => {
		const analytics = {
			...baseConfiguration.analytics,
			posthog: {
				host: "https://analytics.runtime.example",
				key: "phc_1234567890123456",
			},
		};
		await applyClientAnalyticsConsent(
			{ analytics, scope: "https://one.example.org" },
			"granted",
			{ analytics: true, sessionReplay: true },
		);
		const first = posthog.instances.at(-1);

		await applyClientAnalyticsConsent(
			{ analytics, scope: "https://two.example.org" },
			"granted",
			{ analytics: true, sessionReplay: false },
		);
		expect(first?.stopSessionRecording).toHaveBeenCalled();
		expect(first?.opt_out_capturing).toHaveBeenCalled();

		const second = posthog.instances.at(-1);
		await applyClientAnalyticsConsent(
			{ analytics, scope: "https://two.example.org" },
			"denied",
			{ analytics: false, sessionReplay: false },
		);
		expect(second?.opt_out_capturing).toHaveBeenCalled();
		expect(getAnalyticsDistinctId()).toBeNull();
	});

	it("keeps rejected results aggregate but adds allowlisted filters after consent", async () => {
		const payload = {
			hasSearch: true,
			filterCount: 2,
			page: 3,
			pageResultCount: 20,
			totalResultCount: 82,
			scope: "title_abstract",
			sort: "relevance",
			categoricalFilters: {
				country: ["Morocco"],
				year_range: "2020-2026",
			},
		};
		await applyClientAnalyticsConsent(baseConfiguration, "denied", {
			analytics: false,
			sessionReplay: false,
		});
		trackLibraryResultsLoaded(payload);

		const aggregateBody = JSON.parse(
			String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
		);
		expect(aggregateBody.properties).not.toHaveProperty(
			"categoricalFilters",
		);
		expect(JSON.stringify(aggregateBody)).not.toContain("Morocco");

		await applyClientAnalyticsConsent(
			{
				...baseConfiguration,
				analytics: {
					...baseConfiguration.analytics,
					posthog: {
						host: "https://analytics.runtime.example",
						key: "phc_1234567890123456",
					},
				},
			},
			"granted",
			{ analytics: true, sessionReplay: false },
		);
		const client = posthog.instances.at(-1);
		trackLibraryResultsLoaded(payload);
		await vi.waitFor(() => {
			expect(client?.capture).toHaveBeenCalledWith(
				"library_results_loaded",
				expect.objectContaining({
					filter_country: ["Morocco"],
					filter_year_range: ["2020-2026"],
					has_search: true,
				}),
			);
		});
	});
});
