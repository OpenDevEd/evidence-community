"use client";

import { useLocale } from "next-intl";
import {
	routing,
	localesNames,
	shortLocalesNames,
} from "@/i18n/routing";
import { useMemo } from "react";

export function useSortedLocales() {
	const currentLocale = useLocale();

	const sortedLocales = useMemo(() => {
		const priority =
			process.env.NEXT_PUBLIC_LOCALES_PRIORITY?.split(",") || [];

		return routing.locales
			.filter((locale) => locale !== currentLocale)
			.sort((a, b) => {
				const aIndex = priority.indexOf(a);
				const bIndex = priority.indexOf(b);
				if (aIndex === -1) return 1;
				if (bIndex === -1) return -1;
				return aIndex - bIndex;
			});
	}, [currentLocale]);

	return {
		currentLocale,
		sortedLocales,
		localesNames,
		shortLocalesNames,
		currentLocaleName:
			shortLocalesNames[currentLocale as keyof typeof shortLocalesNames],
		currentLocaleFullName:
			localesNames[currentLocale as keyof typeof localesNames],
		hasMultipleLocales: routing.locales.length > 1,
	};
}
