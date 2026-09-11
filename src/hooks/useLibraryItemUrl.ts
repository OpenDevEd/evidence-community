"use client";

import { useLocale } from "next-intl";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { resolveRuntimeRequestLocale } from "@/i18n/runtime";
import { buildLocalizedSiteUrl } from "@/lib/language-alternates";

/** Public sharing URLs omit the reader's current search and page fragment. */
export function useLibraryItemUrl() {
	const { identity, localization } = useLibraryConfig();
	const locale = resolveRuntimeRequestLocale(useLocale(), localization);
	return (key: string) => buildLocalizedSiteUrl(`/lib/${key}`, locale, localization, identity.baseUrl);
}
