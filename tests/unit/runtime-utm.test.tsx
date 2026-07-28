// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	consentState: "pending",
	query: {} as Record<string, string | null>,
	removeStored: vi.fn(),
	setStored: vi.fn(),
	utmDurationSeconds: 600,
}));

vi.mock("nuqs", () => ({
	parseAsString: {},
	useQueryStates: () => [runtime.query],
}));

vi.mock(
	"@/components/features/analytics/AnalyticsConsentProvider",
	() => ({
		useAnalyticsConsent: () => ({
			consentState: runtime.consentState,
		}),
	}),
);

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		analytics: {
			utmDurationSeconds: runtime.utmDurationSeconds,
		},
	}),
}));

vi.mock("usehooks-ts", () => ({
	useLocalStorage: () => [
		null,
		runtime.setStored,
		runtime.removeStored,
	],
}));

import {
	STORAGE_KEY,
	UtmAttributionProvider,
} from "@/components/features/UtmProvider";

describe("runtime UTM attribution", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT = true;
		window.localStorage.clear();
		runtime.consentState = "pending";
		runtime.query = {};
		runtime.utmDurationSeconds = 600;
		runtime.removeStored.mockReset();
		runtime.setStored.mockReset();
		container = document.createElement("div");
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
	});

	it("does not write or remove UTM storage before consent when none exists", async () => {
		await act(async () => {
			root.render(<UtmAttributionProvider />);
		});

		expect(runtime.setStored).not.toHaveBeenCalled();
		expect(runtime.removeStored).not.toHaveBeenCalled();
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("removes existing UTM storage when consent is absent", async () => {
		window.localStorage.setItem(STORAGE_KEY, '{"existing":true}');

		await act(async () => {
			root.render(<UtmAttributionProvider />);
		});

		expect(runtime.removeStored).toHaveBeenCalledOnce();
		expect(runtime.setStored).not.toHaveBeenCalled();
	});

	it("does not crash when browser storage is unavailable", async () => {
		const error = new DOMException(
			"Storage access is blocked",
			"SecurityError",
		);
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw error;
		});
		const consoleWarn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		await expect(
			act(async () => {
				root.render(<UtmAttributionProvider />);
			}),
		).resolves.toBeUndefined();
		expect(runtime.removeStored).not.toHaveBeenCalled();
		expect(runtime.setStored).not.toHaveBeenCalled();
		expect(consoleWarn).toHaveBeenCalledWith(
			"Unable to clear stored UTM attribution",
			error,
		);
	});

	it("applies the configured UTM duration after consent", async () => {
		runtime.consentState = "granted";
		runtime.query = {
			utm_source: "Newsletter",
			utm_medium: "Email",
		};
		runtime.utmDurationSeconds = 900;
		vi.spyOn(Date, "now").mockReturnValue(1_000);

		await act(async () => {
			root.render(<UtmAttributionProvider />);
		});

		const update = runtime.setStored.mock.calls[0]?.[0] as (
			current: null,
		) => unknown;
		expect(update(null)).toEqual({
			utm: {
				utm_source: "newsletter",
				utm_medium: "email",
			},
			startedAt: 1_000,
			expiresAt: 901_000,
		});
	});
});
