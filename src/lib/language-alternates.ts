import { routing } from "@/i18n/routing";
import { buildSiteUrl } from "@/lib/site-url";

export function buildLocalizedSiteUrl(
	pathname: string,
	locale: string,
	baseUrl?: string,
) {
	const localizedPath =
		locale === routing.defaultLocale ? pathname : `/${locale}${pathname}`;

	return buildSiteUrl(localizedPath, baseUrl);
}

export function buildLanguageAlternates(pathname: string, baseUrl?: string) {
	return Object.fromEntries([
		...routing.locales.map((locale) => [
			locale,
			buildLocalizedSiteUrl(pathname, locale, baseUrl),
		]),
		[
			"x-default",
			buildLocalizedSiteUrl(pathname, routing.defaultLocale, baseUrl),
		],
	]);
}
