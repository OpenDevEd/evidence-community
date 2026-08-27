// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
	moduleLoads: 0,
	instances: [] as Array<{
		capture: ReturnType<typeof vi.fn>;
		get_distinct_id: ReturnType<typeof vi.fn>;
		init: ReturnType<typeof vi.fn>;
		opt_in_capturing: ReturnType<typeof vi.fn>;
		opt_out_capturing: ReturnType<typeof vi.fn>;
		reset: ReturnType<typeof vi.fn>;
		setPersonProperties: ReturnType<typeof vi.fn>;
		startSessionRecording: ReturnType<typeof vi.fn>;
		stopSessionRecording: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("posthog-js", () => {
	posthog.moduleLoads += 1;
	return {
		PostHog: class {
			capture = vi.fn();
			get_distinct_id = vi.fn(() => "runtime-distinct-id");
			init = vi.fn();
			opt_in_capturing = vi.fn();
			opt_out_capturing = vi.fn();
			reset = vi.fn();
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
	});

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
		expect(first?.reset).toHaveBeenCalledWith(true);
		expect(first?.opt_out_capturing).toHaveBeenCalled();

		const second = posthog.instances.at(-1);
		await applyClientAnalyticsConsent(
			{ analytics, scope: "https://two.example.org" },
			"denied",
			{ analytics: false, sessionReplay: false },
		);
		expect(second?.reset).toHaveBeenCalledWith(true);
		expect(getAnalyticsDistinctId()).toBeNull();
	});
});
