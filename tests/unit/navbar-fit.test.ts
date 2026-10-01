import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { navbarWidths } from "@/lib/navbar-fit";
import { maximalLibraryConfig } from "../fixtures/library-config";

const base = libraryConfigSchema.parse(maximalLibraryConfig);
/** Every character is ten pixels wide, so widths can be worked out by hand. */
const measure = (value: string) => value.length * 10;
const labels = { link: (label: string) => label, gapMaps: "Gap Maps", signIn: "Sign in" };

function withFeatures(features: Partial<typeof base.features>) {
	return { ...base, features: { ...base.features, ...features } };
}

describe("header widths", () => {
	it("keeps room for the Sign in button only when readers can sign in", () => {
		const signedOut = navbarWidths(withFeatures({ readerAccounts: true, themeSwitcher: true }), measure, labels, 120);
		const noAccounts = navbarWidths(withFeatures({ readerAccounts: false, themeSwitcher: true }), measure, labels, 120);
		// The button's padding, icon and gap, its label, and the gap before it.
		expect(signedOut.full - noAccounts.full).toBe(16 + 20 + 8 + 16 + "Sign in".length * 10 + 24);
		expect(signedOut.links).toBe(noAccounts.links);
	});

	it("measures labels in capitals for the wide header", () => {
		const small = navbarWidths({ ...base, theme: { ...base.theme, layout: "small" } }, measure, labels, 120);
		const wide = navbarWidths({ ...base, theme: { ...base.theme, layout: "wide" } }, (value) => (value === value.toUpperCase() ? value.length * 12 : value.length * 10), labels, 120);
		expect(wide.links).toBeGreaterThan(small.links);
	});
});
