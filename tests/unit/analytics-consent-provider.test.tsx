// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	analytics: {
		google: {},
		posthog: {
			host: "https://analytics.runtime.example",
			key: "phc_runtime_consent",
		},
		utmDurationSeconds: 600,
	},
	clearAnalyticsStorage: vi.fn(),
	initializeClientAnalytics: vi.fn(() => true),
	initializePostHog: vi.fn(),
	updateGoogleConsent: vi.fn(),
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({ analytics: runtime.analytics }),
}));

vi.mock("@/lib/analytics", () => ({
	clearAnalyticsStorage: runtime.clearAnalyticsStorage,
	initializeClientAnalytics: runtime.initializeClientAnalytics,
	initializePostHog: runtime.initializePostHog,
	updateGoogleConsent: runtime.updateGoogleConsent,
}));

import {
	AnalyticsConsentProvider,
	useAnalyticsConsent,
} from "@/components/features/analytics/AnalyticsConsentProvider";

function ConsentController() {
	const { setConsentState } = useAnalyticsConsent();
	return (
		<button
			type="button"
			onClick={() => setConsentState("granted")}
		>
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
		container = document.createElement("div");
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
	});

	it("does not initialize a vendor until consent is granted", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(runtime.initializePostHog).not.toHaveBeenCalled();
		expect(runtime.initializeClientAnalytics).not.toHaveBeenCalled();

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>("button")
				?.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(runtime.initializeClientAnalytics).toHaveBeenCalledOnce();
		expect(runtime.initializeClientAnalytics).toHaveBeenCalledWith(
			runtime.analytics,
		);
	});
});
