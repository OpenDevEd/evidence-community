import { describeZoteroItemTypeFields, getZoteroItemTypes } from "@opendeved/evidence-library-core/zotero-schema";

import { creatorFromProfile, type AuthorProfile } from "@/lib/authors/profiles";

import { isTopLevelAdminItemType } from "./item-fields";

/** The record as the AI read it from a PDF. */
export type ReadRecord = {
	creators: { affiliations: string[]; creatorType: string; firstName: string; lastName: string; profileId: string }[];
	fields: { field: string; value: string }[];
	itemType: string;
	tags: string[];
	title: string;
};

const nonEmpty = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

/** A profile a search returned during the read, with the names searched for that returned it. */
export type FoundProfile = Pick<AuthorProfile, "id" | "name"> & { searches: readonly string[] };

const nameParts = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// A part of the author's name is in the search as it is, or as an initial of one of its parts.
const partSearched = (part: string, searched: readonly string[]) => searched.some((word) => word === part || (part.length === 1 && word.startsWith(part)));

/**
 * Whether a search for this author returned the profile: one whose words
 * hold every part of the author's name. A profile found for Alice Smith
 * never goes to Bob Smith.
 */
const searchedFor = ({ searches }: FoundProfile, { firstName, lastName }: { firstName: string; lastName: string }) => {
	const parts = nameParts(`${firstName} ${lastName}`);
	return parts.length > 0 && searches.some((search) => parts.every((part) => partSearched(part, nameParts(search))));
};

/**
 * The record as a Zotero item: only fields its type has, under the names
 * the type uses, with each author's affiliations and profile, the PDF's
 * keywords as tags, and links to the library's records it cites. A
 * profile counts only when a search for that author during this read
 * returned it, and links as an editor links one, the author taking the
 * profile's name. Country
 * focus stays automatic, worked out from the title and abstract.
 */
export function zoteroItemFrom(record: ReadRecord, { cites, profiles }: { cites: readonly string[]; profiles: ReadonlyMap<string, FoundProfile> }) {
	const itemType = getZoteroItemTypes().has(record.itemType) && isTopLevelAdminItemType(record.itemType) ? record.itemType : "document";
	const names = new Set(describeZoteroItemTypeFields(itemType).map(({ field }) => field));
	const creators = record.creators.map(({ affiliations, creatorType, firstName, lastName, profileId }) => {
		const creator = { creatorType, firstName, lastName, ...(nonEmpty(affiliations).length ? { institutions: nonEmpty(affiliations).map((name) => ({ display_name: name.slice(0, 500) })) } : {}) };
		const profile = profiles.get(profileId);
		return profile && searchedFor(profile, creator) ? creatorFromProfile(creator, profile) : creator;
	});
	const tags = nonEmpty(record.tags).filter((tag) => tag.length <= 255);
	const item: Record<string, unknown> = { creators, itemType, title: record.title, ...(tags.length ? { tags: tags.map((tag) => ({ tag })) } : {}), ...(cites.length ? { links: { cites } } : {}) };
	for (const { field, value } of record.fields) if (names.has(field) && value.trim() && field !== "title") item[field] = value.trim();
	return item;
}
