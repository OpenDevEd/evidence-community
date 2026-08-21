import { z } from "zod";

import { PLATFORM_SEARCH_SCOPES } from "@/config/library-config/catalogs";
import { SORT_OPTIONS } from "@/constants/items";

const filterValuesSchema = z
	.array(z.string().trim().min(1).max(300))
	.max(100);

const RANGE_PATTERN = /^(?:|\d{4}|\d{4}-\d{4}|\d{4}-|-\d{4})$/;

const SORT_KEYS = SORT_OPTIONS.map(({ key }) => key);

/** An empty scope means the library's configured default scope. */
const scopeSchema = z
	.string()
	.refine(
		(value) =>
			value === "" ||
			(PLATFORM_SEARCH_SCOPES as readonly string[]).includes(value),
		{ message: "Unsupported search scope" },
	);

const sortSchema = z
	.string()
	.refine((value) => SORT_KEYS.includes(value), {
		message: "Unsupported search sort",
	});

export const librarySearchContextSchema = z
	.object({
		search: z.string().max(1000),
		scope: scopeSchema,
		sort: sortSchema,
		range: z.string().max(20).regex(RANGE_PATTERN),
		institution: filterValuesSchema,
		country: filterValuesSchema,
		author_country: filterValuesSchema,
		author: z.string().trim().max(300),
		collections: filterValuesSchema,
	})
	.strict();

export type LibrarySearchContext = z.infer<
	typeof librarySearchContextSchema
>;

/**
 * Builds the AI search context from the library's URL-derived query params.
 * This runs during render, so it must never throw on a transient or odd URL:
 * a bare "-" (the year range with no years picked yet) or any malformed range
 * simply carries no year constraint, and an unknown scope or sort falls back
 * to the library's default.
 */
export function normalizeLibrarySearchContext(
	value: Partial<LibrarySearchContext>,
): LibrarySearchContext {
	const range = value.range ?? "";
	const scope = value.scope ?? "";
	const sort = value.sort ?? SORT_KEYS[0];

	return librarySearchContextSchema.parse({
		search: (value.search ?? "").slice(0, 1000),
		scope: (PLATFORM_SEARCH_SCOPES as readonly string[]).includes(scope)
			? scope
			: "",
		sort: SORT_KEYS.includes(sort) ? sort : SORT_KEYS[0],
		range: RANGE_PATTERN.test(range) ? range : "",
		institution: value.institution ?? [],
		country: value.country ?? [],
		author_country: value.author_country ?? [],
		author: value.author ?? "",
		collections: value.collections ?? [],
	});
}

export function librarySearchContextSummary(
	context: LibrarySearchContext,
): string {
	return JSON.stringify({
		query: context.search,
		scope: context.scope || "library default",
		sort: context.sort,
		yearRange: context.range || undefined,
		institutions: context.institution,
		publicationCountries: context.country,
		authorCountries: context.author_country,
		author: context.author || undefined,
		collections: context.collections,
	});
}
