import { PLATFORM_LOCALES } from "@/config/library-config/catalogs";
import { defineRouting } from "next-intl/routing";
import { RUNTIME_LOCALE_COOKIE } from "./runtime";

export const PLATFORM_DEFAULT_LOCALE = "en-GB" as const;

export const routing = defineRouting({
	locales: PLATFORM_LOCALES,
	defaultLocale: PLATFORM_DEFAULT_LOCALE,
	localeDetection: false,
	// Server redirects use explicit locales; client navigation reads the
	// library's default locale from its runtime configuration.
	localePrefix: "always",
	localeCookie: RUNTIME_LOCALE_COOKIE,
	alternateLinks: false,
});
