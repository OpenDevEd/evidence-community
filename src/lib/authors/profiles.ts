import { z } from "zod";
import type { AdminCreator } from "@/lib/admin/types";

const authorProfileSchema = z.object({
	id: z.string(),
	revision: z.number(),
	name: z.string(),
	headline: z.string(),
	affiliation: z.string(),
	bio: z.string(),
	website: z.string(),
	linkedin: z.string(),
	orcid: z.string(),
	openalex: z.string(),
	photo: z.string().nullable(),
	canEdit: z.boolean().optional(),
});
export type AuthorProfile = z.infer<typeof authorProfileSchema> & {
	url: string;
};
const authorCatalogSchema = z.object({
	profiles: z.array(authorProfileSchema),
	profileBaseUrl: z.url(),
});

/** OpenScholar stores a full name. Preserve it without guessing given/family names. */
export function creatorFromProfile<T extends AdminCreator>(
	creator: T,
	profile: Pick<AuthorProfile, "id" | "name">,
) {
	// An author profile is a person's.
	const { organization: _organization, ...person } = creator;
	if (typeof person.name === "string")
		return { ...person, name: profile.name, authorProfileId: profile.id };
	return {
		...person,
		firstName: "",
		lastName: profile.name,
		authorProfileId: profile.id,
	};
}

export function parseAuthorCatalog(value: unknown) {
	const result = authorCatalogSchema.parse(value);
	return {
		...result,
		profiles: result.profiles.map((profile) => ({
			...profile,
			url: new URL(`/authors/${profile.id}`, result.profileBaseUrl).href,
		})),
	};
}

const authorPageSchema = authorCatalogSchema.extend({
	continueCursor: z.string().nullable(),
	isDone: z.boolean(),
});
export function parseAuthorPage(value: unknown) {
	const result = authorPageSchema.parse(value);
	return { ...result, ...parseAuthorCatalog(result) };
}
export type AuthorPageRequest = { search: string; cursor: string | null };
