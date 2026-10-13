import { describeZoteroItemTypeFields, getZoteroItemTypes } from "@opendeved/evidence-library-core/zotero-schema";

import { isTopLevelAdminItemType } from "./item-fields";

/** The record as the AI read it from a PDF. */
export type ReadRecord = {
	/** The countries the work studies, as two-letter codes. */
	countries: string[];
	creators: { affiliations: string[]; creatorType: string; firstName: string; lastName: string; profileId: string }[];
	fields: { field: string; value: string }[];
	itemType: string;
	tags: string[];
	title: string;
};

const nonEmpty = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

/**
 * The record as a Zotero item: only fields its type has, under the names
 * the type uses, with each author's affiliations and profile, the PDF's
 * keywords as tags, links to the library's records it cites, and the
 * countries it studies. A profile counts only when a search during this
 * read returned it, and a country only when the library knows it.
 */
export function zoteroItemFrom(record: ReadRecord, { cites, countries: known, profiles }: { cites: readonly string[]; countries: ReadonlySet<string> | null; profiles: ReadonlySet<string> }) {
	const itemType = getZoteroItemTypes().has(record.itemType) && isTopLevelAdminItemType(record.itemType) ? record.itemType : "document";
	const names = new Set(describeZoteroItemTypeFields(itemType).map(({ field }) => field));
	const creators = record.creators.map(({ affiliations, creatorType, firstName, lastName, profileId }) => ({
		creatorType,
		firstName,
		lastName,
		...(nonEmpty(affiliations).length ? { institutions: nonEmpty(affiliations).map((name) => ({ display_name: name.slice(0, 500) })) } : {}),
		...(profiles.has(profileId) ? { authorProfileId: profileId } : {}),
	}));
	const tags = nonEmpty(record.tags).filter((tag) => tag.length <= 255);
	// Countries the library knows, when it keeps a country focus; none leaves the focus automatic.
	const countries = known ? nonEmpty(record.countries).map((code) => code.toUpperCase()).filter((code) => known.has(code)) : [];
	const item: Record<string, unknown> = { creators, itemType, title: record.title, ...(tags.length ? { tags: tags.map((tag) => ({ tag })) } : {}), ...(cites.length ? { links: { cites } } : {}), ...(countries.length ? { countryFocus: countries } : {}) };
	for (const { field, value } of record.fields) if (names.has(field) && value.trim() && field !== "title") item[field] = value.trim();
	return item;
}
