import { describe, expect, it } from "vitest";

import {
	buildExplicitLocalizedPathname,
	buildRuntimeLocalizedPathname,
	getDisabledLocaleRedirectPathname,
	getOrderedRuntimeLocales,
	resolveRuntimeRequestLocale,
	type RuntimeLocalization,
} from "@/i18n/runtime";
import {
	buildLanguageAlternates,
	buildLocalizedSiteUrl,
} from "@/lib/language-alternates";

const localization = {
	locales: ["en-GB", "fr", "de"],
	defaultLocale: "fr",
	detectLocale: true,
	localePriority: ["de", "fr"],
} satisfies RuntimeLocalization;

describe("runtime localization", () => {
	it("orders priority locales first and appends every remaining enabled locale", () => {
		expect(getOrderedRuntimeLocales(localization)).toEqual([
			"de",
			"fr",
			"en-GB",
		]);
	});

	it("redirects supported but disabled locale prefixes without changing the route", () => {
		expect(
			getDisabledLocaleRedirectPathname("/pt/lib/item", localization),
		).toBe("/lib/item");
		expect(
			getDisabledLocaleRedirectPathname("/pt", localization),
		).toBe("/");
		expect(
			getDisabledLocaleRedirectPathname("/de/lib", localization),
		).toBeNull();
		expect(
			getDisabledLocaleRedirectPathname("/unknown/lib", localization),
		).toBeNull();
	});

	it("builds canonical paths from the configured default locale", () => {
		expect(buildRuntimeLocalizedPathname("/lib", "fr", "fr")).toBe(
			"/lib",
		);
		expect(buildRuntimeLocalizedPathname("/lib", "de", "fr")).toBe(
			"/de/lib",
		);
		expect(buildRuntimeLocalizedPathname("/", "de", "fr")).toBe("/de");
	});

	it("builds explicit locale paths for deterministic locale switches", () => {
		expect(buildExplicitLocalizedPathname("/lib", "fr")).toBe("/fr/lib");
		expect(buildExplicitLocalizedPathname("lib", "en-GB")).toBe(
			"/en-GB/lib",
		);
		expect(buildExplicitLocalizedPathname("/", "de")).toBe("/de");
	});

	it("matches Accept-Language quality, base language, and runtime priority", () => {
		expect(
			resolveRuntimeRequestLocale(
				"en-US;q=0.7, de-DE;q=0.9",
				localization,
			),
		).toBe("de");
		expect(
			resolveRuntimeRequestLocale("en-US", localization),
		).toBe("en-GB");
		expect(
			resolveRuntimeRequestLocale("pt-BR", localization),
		).toBe("fr");
		expect(resolveRuntimeRequestLocale(null, localization)).toBe("fr");
	});

	it("emits alternates only for enabled locales and honors the runtime default", () => {
		expect(
			buildLocalizedSiteUrl(
				"/lib",
				"fr",
				localization,
				"https://library.example.org",
			),
		).toBe("https://library.example.org/lib");
		expect(
			buildLanguageAlternates(
				"/lib",
				localization,
				"https://library.example.org",
			),
		).toEqual({
			"en-GB": "https://library.example.org/en-GB/lib",
			fr: "https://library.example.org/lib",
			de: "https://library.example.org/de/lib",
			"x-default": "https://library.example.org/lib",
		});
	});
});
