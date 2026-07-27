"use client";

import { useLocale } from "next-intl";
import {
	localesNames,
	shortLocalesNames,
} from "@/i18n/routing";
import { useMemo } from "react";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getOrderedRuntimeLocales } from "@/i18n/runtime";

export function useSortedLocales() {
	const currentLocale = useLocale();
	const { localization } = useLibraryConfig();

	const sortedLocales = useMemo(() => {
		return getOrderedRuntimeLocales(localization).filter(
			(locale) => locale !== currentLocale,
		);
	}, [currentLocale, localization]);

	return {
		currentLocale,
		sortedLocales,
		localesNames,
		shortLocalesNames,
		currentLocaleName:
			shortLocalesNames[currentLocale as keyof typeof shortLocalesNames],
		currentLocaleFullName:
			localesNames[currentLocale as keyof typeof localesNames],
		hasMultipleLocales: localization.locales.length > 1,
	};
}
