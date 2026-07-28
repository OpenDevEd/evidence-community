import type { RuntimeLocalization } from "@/i18n/runtime";
import { buildRuntimeLocalizedPathname } from "@/i18n/runtime";
import { buildSiteUrl } from "@/lib/site-url";

export function buildLocalizedSiteUrl(
	pathname: string,
	locale: RuntimeLocalization["defaultLocale"],
	localization: RuntimeLocalization,
	baseUrl: string,
) {
	return buildSiteUrl(
		buildRuntimeLocalizedPathname(
			pathname,
			locale,
			localization.defaultLocale,
		),
		baseUrl,
	);
}

export function buildLanguageAlternates(
	pathname: string,
	localization: RuntimeLocalization,
	baseUrl: string,
) {
	return Object.fromEntries([
		...localization.locales.map((locale) => [
			locale,
			buildLocalizedSiteUrl(
				pathname,
				locale,
				localization,
				baseUrl,
			),
		]),
		[
			"x-default",
			buildLocalizedSiteUrl(
				pathname,
				localization.defaultLocale,
				localization,
				baseUrl,
			),
		],
	]);
}
