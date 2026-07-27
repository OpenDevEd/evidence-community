import { PLATFORM_LOCALES } from "@/config/library-config/catalogs";
import type { LibraryPublicConfig } from "@/config/library-config/schema";

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number];
export type RuntimeLocalization = LibraryPublicConfig["localization"];
export type RuntimeLocaleList = [
	PlatformLocale,
	...PlatformLocale[],
];

export const RUNTIME_LOCALE_COOKIE = {
	name: "NEXT_LOCALE",
	sameSite: "lax",
} as const;

const platformLocaleSet = new Set<string>(PLATFORM_LOCALES);

export function isPlatformLocale(value: string): value is PlatformLocale {
	return platformLocaleSet.has(value);
}

export function getPlatformPathLocale(pathname: string) {
	const firstSegment = pathname.split("/").filter(Boolean)[0];
	return firstSegment && isPlatformLocale(firstSegment)
		? firstSegment
		: null;
}

export function getOrderedRuntimeLocales(
	localization: RuntimeLocalization,
): RuntimeLocaleList {
	const enabledLocales = new Set(localization.locales);
	const orderedLocales = [
		...localization.localePriority,
		...localization.locales,
	].filter(
		(locale, index, locales) =>
			enabledLocales.has(locale) &&
			locales.indexOf(locale) === index,
	);

	const [firstLocale, ...remainingLocales] = orderedLocales;
	if (!firstLocale) {
		throw new Error("At least one runtime locale must be enabled");
	}

	return [firstLocale, ...remainingLocales];
}

export function getDisabledLocaleRedirectPathname(
	pathname: string,
	localization: RuntimeLocalization,
) {
	const requestedLocale = getPlatformPathLocale(pathname);
	if (
		!requestedLocale ||
		localization.locales.includes(requestedLocale)
	) {
		return null;
	}

	const [, ...remainingSegments] = pathname.split("/").filter(Boolean);
	return remainingSegments.length
		? `/${remainingSegments.join("/")}`
		: "/";
}

export function buildRuntimeLocalizedPathname(
	pathname: string,
	locale: PlatformLocale,
	defaultLocale: PlatformLocale,
) {
	const normalizedPathname = pathname.startsWith("/")
		? pathname
		: `/${pathname}`;

	if (locale === defaultLocale) return normalizedPathname;
	return normalizedPathname === "/"
		? `/${locale}`
		: `/${locale}${normalizedPathname}`;
}

export function buildExplicitLocalizedPathname(
	pathname: string,
	locale: PlatformLocale,
) {
	const normalizedPathname = pathname.startsWith("/")
		? pathname
		: `/${pathname}`;

	return normalizedPathname === "/"
		? `/${locale}`
		: `/${locale}${normalizedPathname}`;
}

export function resolveRuntimeRequestLocale(
	acceptLanguage: string | null,
	localization: RuntimeLocalization,
) {
	if (!acceptLanguage) return localization.defaultLocale;

	const orderedLocales = getOrderedRuntimeLocales(localization);
	const requestedLocales = acceptLanguage
		.split(",")
		.map((part, index) => {
			const [locale = "", ...parameters] = part.trim().split(";");
			const qualityParameter = parameters.find((parameter) =>
				parameter.trim().startsWith("q="),
			);
			const quality = qualityParameter
				? Number(qualityParameter.trim().slice(2))
				: 1;

			return {
				locale: locale.toLowerCase(),
				quality: Number.isFinite(quality) ? quality : 0,
				index,
			};
		})
		.filter(({ locale, quality }) => locale && locale !== "*" && quality > 0)
		.sort(
			(a, b) =>
				b.quality - a.quality ||
				a.index - b.index,
		);

	for (const requested of requestedLocales) {
		const exactMatch = orderedLocales.find(
			(locale) => locale.toLowerCase() === requested.locale,
		);
		if (exactMatch) return exactMatch;

		const requestedLanguage = requested.locale.split("-")[0];
		const languageMatch = orderedLocales.find((locale) => {
			const normalizedLocale = locale.toLowerCase();
			return (
				normalizedLocale === requestedLanguage ||
				normalizedLocale.startsWith(`${requestedLanguage}-`)
			);
		});
		if (languageMatch) return languageMatch;
	}

	return localization.defaultLocale;
}
