import { z } from "zod";

/** The default retraction clause alone would import the whole OpenAlex corpus. */
function narrowsResults(filter: string | undefined) {
	return Boolean(
		filter
			?.split(",")
			.some((clause) => clause.trim() && clause.trim() !== "is_retracted:false"),
	);
}

export const openAlexQuerySchema = z
	.object({
		filter: z.string().trim().min(1).max(16_384).optional(),
		search: z.string().trim().min(1).max(2_048).optional(),
	})
	.strict()
	.refine(
		(query) => Boolean(query.search) || narrowsResults(query.filter),
		"An OpenAlex source requires a search or filter",
	);

export const openAlexConnectionConfigSchema = z
	.object({
		apiKeyMode: z.enum(["platform", "custom"]).default("platform"),
		name: z.string().trim().min(1).max(80),
		// The editor retains its unexpanded query, filters and local history ID.
		// Imports always use approvedQuery, never this UI state.
		searchUrl: z.string().max(16_384).regex(/^\/results\/[A-Za-z0-9-]+(?:\?|$)/),
		approvedQuery: z
			.object({
				version: z.string().trim().min(1).max(128),
				approvedAt: z.iso.datetime(),
				query: openAlexQuerySchema,
			})
			.strict(),
		downloadPdfs: z.boolean().default(false),
	})
	.strict();

export type OpenAlexQuery = z.infer<typeof openAlexQuerySchema>;
export type OpenAlexApprovedQuery = z.infer<
	typeof openAlexConnectionConfigSchema
>["approvedQuery"];

export const openAlexPageSchema = z
	.object({
		meta: z
			.object({
				count: z.number().int().nonnegative(),
				next_cursor: z.string().min(1).max(16_384).nullable(),
			})
			.loose(),
		results: z.array(z.unknown()).max(100),
	})
	.loose();
