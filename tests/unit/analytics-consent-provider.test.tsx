// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
import {
	createAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
} from "@/lib/analytics-consent";

function ConsentController() {
	const {
		consentState,
		isPreferencesOpen,
		preferences,
		savePreferences,
		setConsentState,
	} = useAnalyticsConsent();
	return (
		<>
			<output data-testid="consent-state">
				{consentState}:{String(preferences.analytics)}:
				{String(preferences.sessionReplay)}
			</output>
			<output data-testid="consent-open">{String(isPreferencesOpen)}</output>
			<button type="button" onClick={() => setConsentState("granted")}>
				Grant consent
			</button>
			<button type="button" onClick={() => setConsentState("denied")}>
				Decline consent
			</button>
			<button
				type="button"
				onClick={() =>
					savePreferences({ analytics: true, sessionReplay: false })
				}
			>
				Save analytics only
			</button>
		</>
	);
}

function clickButton(container: HTMLElement, label: string) {
	const button = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent === label,
	);
	if (!button) throw new Error(`Missing button: ${label}`);
	button.click();
}

describe("analytics consent provider", () => {
	let container: HTMLDivElement;
	let root: Root;

	/** What one of the test screen's own readouts says right now. */
	const shown = (testId: string) =>
		container.querySelector(`[data-testid="${testId}"]`)?.textContent;

	beforeEach(() => {
		(
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT = true;
		document.cookie = "analytics_consent=; Max-Age=0; Path=/";
		runtime.config.identity.baseUrl = "https://library.example.org";
		runtime.config.analytics = {
			...runtime.config.analytics,
			consentPolicyVersion: 2,
		};
		runtime.applyClientAnalyticsConsent.mockClear();
		container = document.createElement("div");
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
	});

	it("lets a reader who already answered straight through", async () => {
		const record = createAnalyticsConsentRecord(
			{ scope: "https://library.example.org", version: 2 },
			{ analytics: false, sessionReplay: false },
		);
		document.cookie = `analytics_consent=${serializeAnalyticsConsentRecord(
			record,
		)}; Path=/`;

		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});

		expect(shown("consent-open")).toBe("false");
	});

	it("asks again when the policy the reader agreed to has moved on", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});
		expect(shown("consent-open")).toBe("true");

		// The reader answers, so the dialog closes and stays closed.
		await act(async () => {
			clickButton(container, "Decline consent");
		});
		await vi.waitFor(() => {
			expect(shown("consent-open")).toBe("false");
			expect(shown("consent-state")).toContain("denied");
		});

		// A new policy means the old answer no longer covers what we do.
		runtime.config.analytics = {
			...runtime.config.analytics,
			consentPolicyVersion: 3,
		};
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});
		await vi.waitFor(() => {
			expect(shown("consent-state")).toContain("pending");
			expect(shown("consent-open")).toBe("true");
		});
	});

	it("applies pending first and then stores scoped consent before granting", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
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
			clickButton(container, "Grant consent");
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

	it("saves product analytics without enabling replay", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});
		await act(async () => {
			clickButton(container, "Save analytics only");
		});

		expect(container.querySelector("output")?.textContent).toBe(
			"granted:true:false",
		);
		expect(decodeURIComponent(document.cookie)).toContain(
			'"preferences":{"analytics":true,"sessionReplay":false}',
		);
	});

	it("declines both product analytics and replay", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});
		await act(async () => {
			clickButton(container, "Grant consent");
			clickButton(container, "Decline consent");
		});

		expect(container.querySelector("output")?.textContent).toBe(
			"denied:false:false",
		);
	});

	it("asks again when the runtime changes to a different library", async () => {
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});
		await act(async () => {
			clickButton(container, "Grant consent");
		});

		runtime.config.identity.baseUrl = "https://other-library.example.org";
		await act(async () => {
			root.render(
				<AnalyticsConsentProvider>
					<ConsentController />
				</AnalyticsConsentProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(container.querySelector("output")?.textContent).toBe(
				"pending:false:false",
			);
		});
		expect(runtime.applyClientAnalyticsConsent).toHaveBeenLastCalledWith(
			{
				analytics: runtime.config.analytics,
				scope: "https://other-library.example.org",
			},
			"pending",
			{ analytics: false, sessionReplay: false },
		);
	});

	it("uses the answer the server read, before anything is drawn", () => {
		const answered = renderToStaticMarkup(
			<AnalyticsConsentProvider
				storedConsentFromServer={serializeAnalyticsConsentRecord(
					createAnalyticsConsentRecord(
						{ scope: "https://library.example.org", version: 2 },
						{ analytics: false, sessionReplay: false },
					),
				)}
			>
				<ConsentController />
			</AnalyticsConsentProvider>,
		);

		expect(answered).toContain('data-testid="consent-open">false');

		const unanswered = renderToStaticMarkup(
			<AnalyticsConsentProvider>
				<ConsentController />
			</AnalyticsConsentProvider>,
		);

		expect(unanswered).toContain('data-testid="consent-open">true');
	});
});
