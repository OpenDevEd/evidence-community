import { z } from "zod";

/** The default retraction clause alone would import the whole OpenAlex corpus. */
function narrowsResults(filter: string | undefined) {
	return Boolean(
		filter
			?.split(",")
			.some((clause) => clause.trim() && clause.trim() !== "is_retracted:false"),
	);
}

/** Leaving out retracted works narrows nothing, however the clause is grouped, spelled or repeated. */
function narrowsOql(oql: string | undefined) {
	const where = oql?.match(/^works\s+where\s+([\s\S]+)$/i)?.[1];
	return Boolean(
		where
			?.toLowerCase()
			.replace(/[()\s]+/g, " ")
			.split(/\b(?:and|or)\b/)
			.map((clause) => clause.trim())
			.some(
				(clause) =>
					clause && !/^(is_)?retracted is false$/.test(clause),
			),
	);
}

const OQL_MAX = 131_072;
const APPROVED_OQL_MAX = OQL_MAX - 1_024;

export const openAlexQuerySchema = z
	.object({
		filter: z.string().trim().min(1).max(16_384).optional(),
		search: z.string().trim().min(1).max(2_048).optional(),
		// OpenAlex Query Language, filters included, sent as a POST body because it outgrows a URL.
		oql: z.string().trim().min(1).max(OQL_MAX).optional(),
	})
	.strict()
	.refine(
		(query) => !query.oql || (!query.search && !query.filter),
		"An OpenAlex source uses either OQL or a search and filter",
	)
	.refine(
		(query) =>
			Boolean(query.search) ||
			narrowsResults(query.filter) ||
			narrowsOql(query.oql),
		"An OpenAlex source requires a search or filter",
	);

export const openAlexConnectionConfigSchema = z
	.object({
		apiKeyMode: z.enum(["platform", "custom"]).default("platform"),
		name: z.string().trim().min(1).max(80),
		// The editor retains its unexpanded query, filters and local history ID.
		// Imports always use approvedQuery, never this UI state.
		// An OQL search keeps its typed query here, so it is as long as the query.
		searchUrl: z.string().max(262_144).regex(/^\/results\/[A-Za-z0-9-]+(?:\?|$)/),
		approvedQuery: z
			.object({
				version: z.string().trim().min(1).max(128),
				approvedAt: z.iso.datetime(),
				// Incremental syncs wrap the approved OQL in about 50 more characters.
				query: openAlexQuerySchema.refine(
					(query) => (query.oql?.length ?? 0) <= APPROVED_OQL_MAX,
					"An OpenAlex source's OQL query is too long",
				),
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
