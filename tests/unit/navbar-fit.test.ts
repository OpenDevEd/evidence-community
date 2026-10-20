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
			// Beside the sign-in icon below 640px, then beside its label from 640px, where the full name still fits.
			["compact", "full"],
			["compact", "short"],
			["compact", "full"],
		]);
		// A name takes the gap after the logo and its own width.
		expect(arrangements[0]!.width).toBe(steps[0]! + 12 + "Vocational Training".length * 10);
		expect(arrangements[1]!.width).toBe(steps[0]! + 12 + "TVET".length * 10);
		// With the links inline each arrangement needs less room than the one before, and a phone's never as much.
		const inline = arrangements.filter(({ step }) => step !== "compact").map(({ width }) => width);
		expect(inline).toEqual([...inline].sort((a, b) => b - a));
		expect(arrangements.filter(({ step }) => step === "compact").every(({ width }) => width < steps.at(-1)!)).toBe(true);
	});

	it("from 640px, where the sign-in shows its label, shows only the name that still fits beside it", () => {
		const { arrangements } = navbarWidths(named("A".repeat(28), "AB"), measure, labels, 120, measure);
		const phone = arrangements.filter(({ step }) => step === "compact").map(({ width, name }) => [width, name]);
		// Phone bar: logo 120, two gaps, the 32px menu, a gap and the 40px icon, and 8 to spare; a name adds 12 and its letters.
		const icon = 8 + 120 + 24 + 24 + 32 + 24 + 40;
		// The full name beside the labelled sign-in would need more room than the links inline, so the short name stays.
		expect(phone).toEqual([
			[icon + 12 + 280, "full"],
			[icon + 12 + 20, "short"],
			[608, "short"],
		]);
	});

	it("keeps the full name as the actions fold when the short name is the same, and leaves out a phone name wider than the links", () => {
		const { steps, arrangements } = navbarWidths(named("A".repeat(100), "A".repeat(100)), measure, labels, 120, measure);
		expect(arrangements.map(({ step, name }) => [step, name])).toEqual([
			[0, "full"],
			[0, "full"],
			[1, "full"],
			[1, "none"],
			// No name fits beside the labelled sign-in at 640px.
			["compact", "none"],
		]);
		expect(arrangements.every((arrangement) => arrangement.step !== "compact" || arrangement.width < steps.at(-1)!)).toBe(true);
	});
});

describe("a short name no narrower than the full one", () => {
	it("is never shown in its place", () => {
		const config = { ...withFeatures({ themeSwitcher: true, languageSwitcher: false, readerAccounts: true }), identity: { ...base.identity, name: "IOE", shortName: "Institute" } };
		const { arrangements } = navbarWidths(config, measure, labels, 120, measure);
		expect(arrangements.some(({ name }) => name === "short")).toBe(false);
		expect(arrangements[0]).toMatchObject({ step: 0, name: "full" });
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
			expect(await computeNavbarFit(config, "en-US", [])).toBeNull();
			expect(await computeNavbarFit(config, "en-US", [])).toBeNull();
			expect(fetch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(await computeNavbarFit(config, "en-US", [])).toBeNull();
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			vi.unstubAllGlobals();
			vi.useRealTimers();
		}
	});
});
