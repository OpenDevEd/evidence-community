import type { RuntimeLocalization } from "@/i18n/runtime";
import { buildRuntimeLocalizedPathname } from "@/i18n/runtime";
import { buildSiteUrl } from "@/lib/site-url";
import { intlLocale } from "@/i18n/intl-locale";

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
			// Keyed by the language tag search engines know: `cn` is ours for Chinese, `zh-CN` theirs.
			intlLocale(locale),
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
