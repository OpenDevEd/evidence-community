import {
	PLATFORM_SEARCH_SCOPE_OPTIONS,
	type PlatformSearchScope,
} from "./catalogs";
import type { LibraryPublicConfig } from "./schema";

type RuntimeSearch = LibraryPublicConfig["search"];
type RuntimeFilters = LibraryPublicConfig["filters"];

const PLATFORM_EVERYWHERE_ATTRIBUTES = Array.from(
	new Set(
		PLATFORM_SEARCH_SCOPE_OPTIONS.flatMap((option) =>
			option.attributesToSearchOn.filter(
				(attribute) => attribute !== "*",
			),
		),
	),
);

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
		PLATFORM_SEARCH_SCOPE_OPTIONS.find(
			(option) => option.key === scope,
		) ?? PLATFORM_SEARCH_SCOPE_OPTIONS[0];
	const configuredAttributes = scopeOption.attributesToSearchOn;
	const candidateAttributes = (
		configuredAttributes as readonly string[]
	).includes("*")
		? PLATFORM_EVERYWHERE_ATTRIBUTES
		: configuredAttributes;

	return candidateAttributes.filter((attribute) => {
		if (
			!search.fullText &&
			attribute.startsWith("fullTextPDFs.")
		) {
			return false;
		}
		if (!search.tags && attribute === "tags") {
			return false;
		}
		return true;
	});
}

export function getRuntimeSearchFacets(
	search: RuntimeSearch,
	filters: RuntimeFilters,
) {
	const facets = ["collectionsAncestry"];
	if (filters.institution.mode !== "hidden") {
		facets.push("institution");
	}
	if (search.country) {
		facets.push("country");
	}
	if (search.authorCountry) {
		facets.push("creators.institutions.country_code");
	}
	return facets;
}

export function getRuntimeYears(filters: RuntimeFilters) {
	if (!filters.years.enabled) return [];

	return Array.from(
		{
			length:
				filters.years.maximum -
				filters.years.minimum +
				1,
		},
		(_, index) => String(filters.years.maximum - index),
	);
}

function isYearWithinRuntimeRange(
	value: string,
	filters: RuntimeFilters,
) {
	if (!value) return true;
	if (!/^\d{4}$/u.test(value)) return false;

	const year = Number(value);
	return (
		year >= filters.years.minimum &&
		year <= filters.years.maximum
	);
}

export function normalizeRuntimeYearRange(
	value: string | null | undefined,
	filters: RuntimeFilters,
) {
	if (!filters.years.enabled || !value) return "";

	if (!value.includes("-")) {
		return isYearWithinRuntimeRange(value, filters) ? value : "";
	}

	const [start = "", end = "", ...extra] = value.split("-");
	if (
		extra.length > 0 ||
		(!start && !end) ||
		!isYearWithinRuntimeRange(start, filters) ||
		!isYearWithinRuntimeRange(end, filters)
	) {
		return "";
	}
	if (start && end && Number(end) < Number(start)) {
		return "";
	}

	return `${start}-${end}`;
}
