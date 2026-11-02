import { PLATFORM_LOCALES } from "@/config/library-config/catalogs";
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing-config";

export { PLATFORM_DEFAULT_LOCALE, routing } from "./routing-config";
export { Link, useRouter } from "./client-navigation";

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
	es: "Español",
	af: "Afrikaans",
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
	es: "ES",
	af: "AF",
} satisfies Record<(typeof PLATFORM_LOCALES)[number], string>;

export const { getPathname, redirect, usePathname } =
	createNavigation(routing);
