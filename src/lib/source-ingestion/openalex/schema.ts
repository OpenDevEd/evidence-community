import { z } from "zod";

export const openAlexQuerySchema = z
	.object({
		filter: z.string().trim().min(1).max(16_384).optional(),
		search: z.string().trim().min(1).max(2_048).optional(),
	})
	.strict()
	.refine(
		(query) => Boolean(query.filter || query.search),
		"An OpenAlex source requires a search or filter",
	);

export const openAlexConnectionConfigSchema = z
	.object({
		apiKeyMode: z.enum(["platform", "custom"]).default("platform"),
		name: z.string().trim().min(1).max(80),
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
