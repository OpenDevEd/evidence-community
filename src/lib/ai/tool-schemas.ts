import { z } from "zod";

import { SORT_OPTIONS } from "@/constants/items";

export type ResearchMode = "quick" | "research";

const SORT_KEYS = SORT_OPTIONS.map(({ key }) => key) as [string, ...string[]];

const searchFiltersSchema = z
	.object({
		yearRange: z
			.array(z.number().int().min(1000).max(3000))
			.length(2)
			.refine(([start, end]) => start <= end, {
				message: "The first year must not be after the second year",
			})
			.optional()
			.describe(
				"Inclusive publication-year range explicitly requested by the user. For one year, repeat it twice. Omit when the user did not request a date constraint.",
			),
		country: z
			.array(z.string().min(1).max(100))
			.max(20)
			.optional()
			.describe("Countries explicitly requested by the user"),
		institution: z
			.array(z.string().min(1).max(200))
			.max(20)
			.optional()
			.describe("Institutions explicitly requested by the user"),
		collection: z
			.array(z.string().min(1).max(200))
			.max(20)
			.optional()
			.describe("Collections explicitly requested by the user"),
		sort: z
			.enum(SORT_KEYS)
			.optional()
			.describe("Sort order explicitly requested by the user"),
		fullTextOnly: z
			.boolean()
			.optional()
			.describe("Only return publications with searchable PDF full text"),
	})
	.strict();

export type SearchFilters = z.infer<typeof searchFiltersSchema>;

const EXPLICIT_YEAR_INTENT = [
	/\b(?:1\d{3}|2\d{3})\b/i,
	/\b(?:19|20)\d0s\b/i,
	/\b(?:past|last|previous|next)\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?)\b/i,
	/\b(?:recent|recently|latest|newest|oldest)\b/i,
	/\b(?:published|dated?)\s+(?:in|before|after|since|between)\b/i,
] as const;

/**
 * Models like to invent a year range from today's date or the topic. A year
 * filter silently hides evidence, so it only survives when the user's own
 * words asked for a date constraint.
 */
export function validateSearchFiltersAgainstUserRequest(
	filters: SearchFilters | undefined,
	userText: string,
) {
	if (!filters?.yearRange) {
		return { effectiveFilters: filters, ignoredFilters: [] as string[] };
	}

	if (EXPLICIT_YEAR_INTENT.some((pattern) => pattern.test(userText))) {
		return { effectiveFilters: filters, ignoredFilters: [] as string[] };
	}

	const { yearRange: _ignoredYearRange, ...effectiveFilters } = filters;
	return {
		effectiveFilters,
		ignoredFilters: [
			"yearRange was ignored because the user did not request a date constraint",
		],
	};
}

export function createResearchToolSchemas(mode: ResearchMode) {
	return {
		searchLibrary: z
			.object({
				queries: z
					.array(z.string().trim().min(2).max(300))
					.max(5)
					.default([])
					.describe(
						`Search queries, run in parallel${mode === "research" ? " (at least two)" : ""}. May be empty only with withinCurrentResults=true: that lists the current result window in the user's displayed order instead of searching.`,
					),
				withinCurrentResults: z
					.boolean()
					.default(false)
					.describe(
						"Restrict to the user's current library result set. With no queries, returns the window's entries in the user's own sort order, with their positions.",
					),
				// Providers in strict mode send every property, so this is a
				// plain default and is ignored outside withinCurrentResults —
				// never a validation failure.
				window: z
					.enum(["first", "last"])
					.default("first")
					.describe(
						"Only used with withinCurrentResults and no cursor: which 200-entry window of the current results to inspect. 'last' jumps to the final entries (use for questions about the end of the list). Ignored otherwise.",
					),
				cursor: z
					.string()
					.max(1000)
					.optional()
					.describe(
						"Continuation cursor from a previous current-results search",
					),
				filters: searchFiltersSchema
					.optional()
					.describe(
						"Optional constraints. Omit this object unless the user explicitly requested a matching filter. Never infer filters from the current date, topic, or expected result set.",
					),
				limitPerQuery: z.number().int().min(1).max(10).default(10),
			})
			.strict()
			.superRefine((value, context) => {
				const minimumQueries = mode === "research" ? 2 : 1;
				if (
					!value.withinCurrentResults &&
					value.queries.length < minimumQueries
				) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["queries"],
						message: `Provide at least ${minimumQueries} ${minimumQueries === 1 ? "query" : "queries"}, or set withinCurrentResults=true to list the current results.`,
					});
				}
			}),
		readPublications: z
			.object({
				itemKeys: z
					.array(
						z
							.string()
							.trim()
							.regex(/^[A-Za-z0-9:_-]+$/),
					)
					.min(1)
					.max(mode === "research" ? 10 : 5),
			})
			.strict(),
	};
}
