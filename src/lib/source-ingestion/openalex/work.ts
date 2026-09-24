import { z } from "zod";

const text = z.string().nullish();
const count = z.number().int().nonnegative().nullish();
const institutionSchema = z
	.object({
		id: text,
		display_name: text,
		country_code: text,
	})
	.passthrough();

const locationSchema = z
	.object({
		is_oa: z.boolean().nullish(),
		pdf_url: text,
		landing_page_url: text,
		version: text,
		source: z
			.object({
				id: text,
				display_name: text,
				type: text,
				issn_l: text,
				issn: z.array(z.string()).nullish(),
				host_organization: text,
				host_organization_name: text,
			})
			.passthrough()
			.nullish(),
	})
	.passthrough();

/** Only fields consumed by the mapper are constrained; the source payload stays intact. */
export const openAlexWorkSchema = z
	.object({
		id: z.string().regex(/^(?:https?:\/\/openalex\.org\/)?W\d+$/u),
		title: text,
		display_name: text,
		type: text,
		type_crossref: text,
		doi: text,
		ids: z
			.object({ doi: text, pmid: text, pmcid: text })
			.passthrough()
			.nullish(),
		publication_date: text,
		publication_year: z.number().int().min(1).max(9999).nullish(),
		language: text,
		abstract_inverted_index: z
			.record(z.string(), z.array(z.number().int().nonnegative()))
			.nullish(),
		biblio: z
			.object({
				volume: text,
				issue: text,
				first_page: text,
				last_page: text,
			})
			.passthrough()
			.nullish(),
		authorships: z
			.array(
				z
					.object({
						raw_author_name: text,
						author: z
							.object({ display_name: text })
							.passthrough()
							.nullish(),
						institutions: z.array(institutionSchema).nullish(),
					})
					.passthrough(),
			)
			.nullish(),
		primary_location: locationSchema.nullish(),
		best_oa_location: locationSchema.nullish(),
		locations: z.array(locationSchema).nullish(),
		cited_by_count: count,
		referenced_works_count: count,
		referenced_works: z
			.array(z.string().regex(/^(?:https?:\/\/openalex\.org\/)?W\d+$/u))
			.nullish(),
		is_retracted: z.boolean().nullish(),
		created_date: text,
		updated_date: text,
	})
	.passthrough();

export type OpenAlexWork = z.infer<typeof openAlexWorkSchema>;
