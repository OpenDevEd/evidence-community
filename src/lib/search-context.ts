import { SCOPE_OPTIONS, SORT_OPTIONS } from "@/constants/items";
import { z } from "zod";

const filterValuesSchema = z
	.array(z.string().trim().min(1).max(300))
	.max(100);

const RANGE_PATTERN = /^(?:|\d{4}|\d{4}-\d{4}|\d{4}-|-\d{4})$/;

const knownKey = <T extends { key: string }>(options: readonly T[]) =>
	z
		.string()
		.refine((value) => options.some(({ key }) => key === value), {
			message: "Unsupported search option",
		});

export const librarySearchContextSchema = z
	.object({
		search: z.string().max(1000),
		scope: knownKey(SCOPE_OPTIONS),
		sort: knownKey(SORT_OPTIONS),
		range: z.string().max(20).regex(RANGE_PATTERN),
		institution: filterValuesSchema,
		country: filterValuesSchema,
		author_country: filterValuesSchema,
		author: z.string().trim().max(300),
		collections: filterValuesSchema,
		/** The reader hid the results found by meaning. */
		wordsOnly: z.boolean().default(false),
	})
	.strict();

export type LibrarySearchContext = z.infer<
	typeof librarySearchContextSchema
>;

/**
 * Builds the AI search context from the library's URL-derived query params.
 * This runs during render, so it must never throw on transient or odd URL
 * states: a bare "-" (range mode with no years picked yet) or any malformed
 * range simply carries no year constraint, and unknown scope/sort fall back
 * to their defaults.
 */
export function normalizeLibrarySearchContext(
	value: Partial<LibrarySearchContext>,
): LibrarySearchContext {
	const range = value.range ?? "";
	const scope = value.scope ?? SCOPE_OPTIONS[0].key;
	const sort = value.sort ?? SORT_OPTIONS[0].key;
	return librarySearchContextSchema.parse({
		search: (value.search ?? "").slice(0, 1000),
		scope: SCOPE_OPTIONS.some(({ key }) => key === scope)
			? scope
			: SCOPE_OPTIONS[0].key,
		sort: SORT_OPTIONS.some(({ key }) => key === sort)
			? sort
			: SORT_OPTIONS[0].key,
		range: RANGE_PATTERN.test(range) ? range : "",
		institution: value.institution ?? [],
		country: value.country ?? [],
		author_country: value.author_country ?? [],
		author: value.author ?? "",
		collections: value.collections ?? [],
		wordsOnly: value.wordsOnly ?? false,
	});
}

export function librarySearchContextSummary(
	context: LibrarySearchContext,
): string {
	return JSON.stringify({
		query: context.search,
		scope: context.scope,
		sort: context.sort,
		yearRange: context.range || undefined,
		institutions: context.institution,
		publicationCountries: context.country,
		authorCountries: context.author_country,
		author: context.author || undefined,
		collections: context.collections,
	});
}
