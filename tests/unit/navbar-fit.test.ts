import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { navbarWidths } from "@/lib/navbar-fit";
import { maximalLibraryConfig } from "../fixtures/library-config";

const base = libraryConfigSchema.parse(maximalLibraryConfig);
/** Every character is ten pixels wide, so widths can be worked out by hand. */
const measure = (value: string) => value.length * 10;
const labels = { link: (label: string) => label, gapMaps: "Gap Maps", signIn: "Sign in", language: "English (UK)" };

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
		expect(steps).toHaveLength(3);
		expect([...steps].sort((a, b) => b - a)).toEqual(steps);
		expect(new Set(steps).size).toBe(3);
	});

	it("measures labels in capitals for the wide header", () => {
		const small = navbarWidths({ ...base, theme: { ...base.theme, layout: "small" } }, measure, labels, 120);
		const wide = navbarWidths({ ...base, theme: { ...base.theme, layout: "wide" } }, (value) => (value === value.toUpperCase() ? value.length * 12 : value.length * 10), labels, 120);
		expect(wide.steps.at(-1)).toBeGreaterThan(small.steps.at(-1)!);
	});
});
