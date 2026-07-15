import { routing } from "@/i18n/routing";
import { buildSiteUrl } from "@/lib/site-url";

export function buildLocalizedSiteUrl(pathname: string, locale: string) {
	const localizedPath =
		locale === routing.defaultLocale ? pathname : `/${locale}${pathname}`;

	return buildSiteUrl(localizedPath);
}

export function buildLanguageAlternates(pathname: string) {
	return Object.fromEntries([
		...routing.locales.map((locale) => [
			locale,
			buildLocalizedSiteUrl(pathname, locale),
		]),
		["x-default", buildLocalizedSiteUrl(pathname, routing.defaultLocale)],
	]);
}
