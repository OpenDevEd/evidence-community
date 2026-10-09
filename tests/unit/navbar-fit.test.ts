import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { computeNavbarFit, navbarFitCss, navbarWidths } from "@/lib/navbar-fit";
import { maximalLibraryConfig } from "../fixtures/library-config";

const base = libraryConfigSchema.parse(maximalLibraryConfig);
/** Every character is ten pixels wide, so widths can be worked out by hand. */
const measure = (value: string) => value.length * 10;
const labels = { link: (label: string) => label, gapMaps: "Gap Maps", signIn: "Sign in" };

function withFeatures(features: Partial<typeof base.features>) {
	return { ...base, features: { ...base.features, ...features } };
}

describe("header widths", () => {
	it("keeps room for the Sign in button only when readers can sign in, until it folds into the menu", () => {
		const features = { themeSwitcher: true, languageSwitcher: false };
		const signedOut = navbarWidths(withFeatures({ ...features, readerAccounts: true }), measure, labels, 120);
		const noAccounts = navbarWidths(withFeatures({ ...features, readerAccounts: false }), measure, labels, 120);
		// Theme and Sign in side by side, then one menu holding both.
		expect(signedOut.steps).toHaveLength(2);
		// The button's padding, icon and gap, its label, and the gap before it.
		expect(signedOut.steps[0]! - noAccounts.steps[0]!).toBe(16 + 20 + 8 + 16 + "Sign in".length * 10 + 24);
		// The menu keeps room for a signed-in reader's avatar, which is wider than the theme button.
		expect(signedOut.steps[1]! - noAccounts.steps[0]!).toBe(40 - 20);
	});

	it("needs less room at every step it folds", () => {
		const { steps } = navbarWidths(
			withFeatures({ themeSwitcher: true, languageSwitcher: true, readerAccounts: true }),
			measure,
			labels,
			120,
		);
		expect(steps).toHaveLength(2);
		expect(steps[0]).toBeGreaterThan(steps[1]!);
	});

	it("measures labels in capitals for the wide header", () => {
		const small = navbarWidths({ ...base, theme: { ...base.theme, layout: "small" } }, measure, labels, 120);
		const wide = navbarWidths({ ...base, theme: { ...base.theme, layout: "wide" } }, (value) => (value === value.toUpperCase() ? value.length * 12 : value.length * 10), labels, 120);
		expect(wide.steps.at(-1)).toBeGreaterThan(small.steps.at(-1)!);
	});

	it("shows the links from the xl breakpoint when the font could not be measured, even with one arrangement", () => {
		expect(navbarFitCss(null, 1)).toContain("@media (min-width: 1280px)");
		expect(navbarFitCss(null, 1)).not.toContain("1536px");
		const two = navbarFitCss(null, 2);
		expect(two.indexOf("1280px")).toBeLessThan(two.indexOf("1536px"));
	});
});

describe("loading the body font", () => {
	it("tries a failed load again a minute later, not on every page in between", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetch = vi.fn().mockRejectedValue(new Error("timed out"));
		vi.stubGlobal("fetch", fetch);
		const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, theme: { ...maximalLibraryConfig.theme, fonts: { ...maximalLibraryConfig.theme.fonts, body: { source: "google", family: "Poppins" } } } });
		try {
			expect(await computeNavbarFit(config, "en-US", undefined)).toBeNull();
			expect(await computeNavbarFit(config, "en-US", undefined)).toBeNull();
			expect(fetch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(await computeNavbarFit(config, "en-US", undefined)).toBeNull();
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			vi.unstubAllGlobals();
			vi.useRealTimers();
		}
	});
});
