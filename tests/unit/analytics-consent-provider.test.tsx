// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	config: {
		identity: { baseUrl: "https://library.example.org" },
		analytics: {
			consentPolicyVersion: 2,
			google: {},
			posthog: {
				host: "https://analytics.runtime.example",
				key: "phc_runtime_consent",
			},
			utmDurationSeconds: 600,
		},
	},
	applyClientAnalyticsConsent: vi.fn(
		async (_config, state) => state === "granted",
	),
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => runtime.config,
}));

vi.mock("@/lib/analytics", () => ({
	applyClientAnalyticsConsent: runtime.applyClientAnalyticsConsent,
}));

import {
	AnalyticsConsentProvider,
	useAnalyticsConsent,
} from "@/components/features/analytics/AnalyticsConsentProvider";

function ConsentController() {
	const { setConsentState } = useAnalyticsConsent();
	return (
		<button type="button" onClick={() => setConsentState("granted")}>
			Grant consent
		</button>
	);
}

describe("analytics consent provider", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT = true;
		document.cookie = "analytics_consent=; Max-Age=0; Path=/";
		runtime.applyClientAnalyticsConsent.mockClear();
		container = document.createElement("div");
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
	});

	it("applies pending first and then stores scoped consent before granting", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		await vi.waitFor(() => {
			expect(runtime.applyClientAnalyticsConsent).toHaveBeenCalledWith(
				{
					analytics: runtime.config.analytics,
					scope: "https://library.example.org",
				},
				"pending",
				{ analytics: false, sessionReplay: false },
			);
		});

		await act(async () => {
			container.querySelector<HTMLButtonElement>("button")?.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		await vi.waitFor(() => {
			expect(
				runtime.applyClientAnalyticsConsent,
			).toHaveBeenLastCalledWith(
				{
					analytics: runtime.config.analytics,
					scope: "https://library.example.org",
				},
				"granted",
				{ analytics: true, sessionReplay: true },
			);
		});
		expect(decodeURIComponent(document.cookie)).toContain(
			'"scope":"https://library.example.org"',
		);
		expect(decodeURIComponent(document.cookie)).toContain('"version":2');
	});
});
