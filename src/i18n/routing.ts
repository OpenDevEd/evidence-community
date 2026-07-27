import { PLATFORM_LOCALES } from "@/config/library-config/catalogs";
import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";
import { RUNTIME_LOCALE_COOKIE } from "./runtime";

export const PLATFORM_DEFAULT_LOCALE = "en-GB" as const;

export const routing = defineRouting({
	locales: PLATFORM_LOCALES,
	defaultLocale: PLATFORM_DEFAULT_LOCALE,
	localeDetection: false,
	// Client navigation cannot know the runtime default at module initialization.
	// Explicit prefixes keep every locale correct; the runtime proxy canonicalizes
	// the configured default locale to an unprefixed URL.
	localePrefix: "always",
	localeCookie: RUNTIME_LOCALE_COOKIE,
	alternateLinks: false,
});

export const localesNames = {
	"en-US": "English (US)",
	"en-GB": "English (UK)",
	de: "Deutsch",
	ar: "العربية",
	hi: "हिंदी",
	fr: "Français",
	cn: "中文",
	sw: "Swahili",
	pt: "Português",
} satisfies Record<(typeof PLATFORM_LOCALES)[number], string>;

export const shortLocalesNames = {
	"en-US": "EN-US",
	"en-GB": "EN-GB",
	de: "DE",
	ar: "AR",
	hi: "HI",
	fr: "FR",
	cn: "CN",
	sw: "SW",
	pt: "PT",
} satisfies Record<(typeof PLATFORM_LOCALES)[number], string>;

export const { Link, getPathname, redirect, usePathname, useRouter } =
	createNavigation(routing);
