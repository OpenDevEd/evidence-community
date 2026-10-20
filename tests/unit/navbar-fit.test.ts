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

	it("measures labels as both headers show them, never in capitals", () => {
		const capitalsWider = (value: string) => (value === value.toUpperCase() ? value.length * 12 : value.length * 10);
		const small = navbarWidths({ ...base, theme: { ...base.theme, layout: "small" } }, capitalsWider, labels, 120);
		const wide = navbarWidths({ ...base, theme: { ...base.theme, layout: "wide" } }, capitalsWider, labels, 120);
		expect(wide.steps).toEqual(small.steps);
	});

	it("shows the links from the xl breakpoint when the font could not be measured, even with one arrangement", () => {
		expect(navbarFitCss(null, 1)).toContain("@media (min-width: 1280px)");
		expect(navbarFitCss(null, 1)).not.toContain("1536px");
		const two = navbarFitCss(null, 2);
		expect(two.indexOf("1280px")).toBeLessThan(two.indexOf("1536px"));
	});
});

describe("the name beside the logo", () => {
	const named = (name: string, shortName: string) => ({
		...withFeatures({ themeSwitcher: true, languageSwitcher: false, readerAccounts: true }),
		identity: { ...base.identity, name, shortName },
	});

	it("shows the full name while every action fits, the short one while they fold, then the logo alone, and on a phone the name that fits", () => {
		const { steps, arrangements } = navbarWidths(named("Vocational Training", "TVET"), measure, labels, 120, measure);
		expect(arrangements.map(({ step, name }) => [step, name])).toEqual([
			[0, "full"],
			[0, "short"],
			[1, "short"],
			[1, "none"],
			["compact", "full"],
			["compact", "short"],
		]);
		// A name takes the gap after the logo and its own width.
		expect(arrangements[0]!.width).toBe(steps[0]! + 12 + "Vocational Training".length * 10);
		expect(arrangements[1]!.width).toBe(steps[0]! + 12 + "TVET".length * 10);
		// Each arrangement needs less room than the one before, and a phone's never as much as the links inline.
		const widths = arrangements.map(({ width }) => width);
		expect(widths).toEqual([...widths].sort((a, b) => b - a));
		expect(widths.at(-2)).toBeLessThan(steps.at(-1)!);
	});

	it("keeps the full name as the actions fold when the short name is the same, and leaves out a phone name wider than the links", () => {
		const { steps, arrangements } = navbarWidths(named("A".repeat(100), "A".repeat(100)), measure, labels, 120, measure);
		expect(arrangements.map(({ step, name }) => [step, name])).toEqual([
			[0, "full"],
			[0, "full"],
			[1, "full"],
			[1, "none"],
		]);
		expect(arrangements.every((arrangement) => arrangement.step !== "compact" || arrangement.width < steps.at(-1)!)).toBe(true);
	});

	it("hides both names until an arrangement shows one", () => {
		const css = navbarFitCss(navbarWidths(named("Wealth Inequality and Social Mobility", "Wealth Inequality"), measure, labels, 120, measure), 2);
		expect(css).toContain(".nf-links, .nf-step, .nf-name { display: none !important; }");
		expect(css).toContain(".nf-name-full { display: inline !important; }");
		expect(css).toContain(".nf-name-short { display: inline !important; }");
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
