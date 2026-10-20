"use client";

import { useTranslations } from "next-intl";
import type { PublicSource } from "@/app/api/sources/types";
import { useFiltersContext } from "@/context/FiltersProvider";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { localizeOrUseIfCapitalized } from "@/lib/utils";

/** What the library calls its sources, as the institutions filter takes its name. */
export function useSourcesLabel() {
	const { filters } = useLibraryConfig();
	const t = useTranslations("ui");
	return localizeOrUseIfCapitalized(filters.sources.label, t);
}

/** The sources readers can filter by, none when the filter is off or there is one source. Undefined until their names arrive. */
export function useOfferedSources(): PublicSource[] | undefined {
	const { filters } = useLibraryConfig();
	const { sources } = useFiltersContext();
	if (!filters.sources.enabled) return [];
	// One source would filter nothing.
	return sources && (sources.length > 1 ? sources : []);
}
