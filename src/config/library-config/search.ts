import {
	PLATFORM_SEARCH_SCOPE_OPTIONS,
	type PlatformSearchScope,
} from "./catalogs";
import { INSTITUTION_FILTER_FIELD } from "./institutions";
import { PDF_PRESENCE_ATTRIBUTE } from "@/lib/search-filter-constants";
import type { LibraryPublicConfig } from "./schema";

export type RuntimeSearch = Omit<LibraryPublicConfig["search"], "embeddings">;
type RuntimeFilters = LibraryPublicConfig["filters"];

export function getRuntimeSearchScopeOptions(search: RuntimeSearch) {
	return PLATFORM_SEARCH_SCOPE_OPTIONS.filter(
		(option) =>
			search.scopes.includes(option.key) &&
			(search.fullText || option.key !== "documents"),
	);
}

export function resolveRuntimeSearchScope(
	requestedScope: string | null | undefined,
	search: RuntimeSearch,
): PlatformSearchScope {
	const enabledScopes = getRuntimeSearchScopeOptions(search);
	const requested = enabledScopes.find(
		(option) => option.key === requestedScope,
	);
	if (requested) return requested.key;

	const configuredDefault = enabledScopes.find(
		(option) => option.key === search.defaultScope,
	);
	return configuredDefault?.key ?? enabledScopes[0].key;
}

export function getRuntimeSearchAttributes(
	scope: PlatformSearchScope,
	search: RuntimeSearch,
) {
	const scopeOption =
		PLATFORM_SEARCH_SCOPE_OPTIONS.find((option) => option.key === scope) ??
		PLATFORM_SEARCH_SCOPE_OPTIONS[0];
	return scopeOption.attributesToSearchOn.filter((attribute) => {
		if (!search.fullText && attribute.startsWith("fullTextPDFs.")) {
			return false;
		}
		if (!search.tags && attribute === "tags") {
			return false;
		}
		return true;
	});
}

/**
 * The search field study types are counted and filtered by. With uncertain types apart, it holds "uncertain" in place of
 * the type of a record whose type is uncertain.
 */
export const studyTypeFacet = (filters: Pick<RuntimeFilters, "uncertainStudyTypes">) =>
	filters.uncertainStudyTypes === "separate" ? "studyTypeShown" : "studyType";

export function getRuntimeSearchFacets(
	search: RuntimeSearch,
	filters: RuntimeFilters,
	topicsEnabled: boolean,
) {
	// Item types, study types and PDFs describe the results beside the list. Authors are counted apart, on their own cached request.
	const facets = ["collectionsAncestry", "itemType", studyTypeFacet(filters), PDF_PRESENCE_ATTRIBUTE];
	if (topicsEnabled) {
		facets.push("topicAncestors");
	}
	if (filters.institution.mode !== "hidden") {
		facets.push(INSTITUTION_FILTER_FIELD);
	}
	if (filters.years.enabled) {
		facets.push("year");
	}
	if (search.country) {
		// Where a record is about, and where its authors work.
		facets.push("country", "authorCountry");
	}
	return facets;
}

function isYear(value: string) {
	if (!value) return true;
	return /^\d{4}$/u.test(value);
}

export function normalizeRuntimeYearRange(
	value: string | null | undefined,
	filters: RuntimeFilters,
) {
	if (!filters.years.enabled || !value) return "";

	if (!value.includes("-")) {
		return isYear(value) ? value : "";
	}

	const [start = "", end = "", ...extra] = value.split("-");
	if (
		extra.length > 0 ||
		(!start && !end) ||
		!isYear(start) ||
		!isYear(end)
	) {
		return "";
	}
	if (start && end && Number(end) < Number(start)) {
		return "";
	}

	return `${start}-${end}`;
}
