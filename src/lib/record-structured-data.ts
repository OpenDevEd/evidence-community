import type { Item } from "@/app/api/item/types";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { completeRecordLicence, licenceTermsUrl } from "@/lib/licences";

/** The schema.org type for a Zotero item type; anything else is a plain creative work. */
const TYPES: Partial<Record<NonNullable<Item["itemType"]>, string>> = {
	JournalArticle: "ScholarlyArticle",
	ConferencePaper: "ScholarlyArticle",
	Preprint: "ScholarlyArticle",
	Report: "Report",
	Thesis: "Thesis",
	Book: "Book",
	BookSection: "Chapter",
	Dataset: "Dataset",
	Webpage: "WebPage",
};

/** The record's date as precisely as it's known (a year, a month or a day), never a day it doesn't have. */
function dateOf(date: string | null | undefined) {
	const parsed = parseBibliographicDate(date ?? "");
	return parsed.kind === "parsed" ? parsed.raw : undefined;
}

/** What the record was published in: a journal for an article, a book for a chapter; otherwise left out rather than guessed. */
const CONTAINERS: Partial<Record<NonNullable<Item["itemType"]>, string>> = { JournalArticle: "Periodical", Preprint: "Periodical", BookSection: "Book" };

/** The record's DOI as an address, from its DOI field or the Extra field Zotero keeps it in. */
function doiAddressOf(item: Item) {
	const doi = (item.DOI || getExtraValues(item.extra ?? "").get("DOI"))?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
	return doi ? `https://doi.org/${doi}` : undefined;
}

/** A named thing of a schema.org type, or nothing when there's no name. */
const named = (type: string, name: string | null | undefined) => (name ? { "@type": type, name } : undefined);

/**
 * A record as schema.org structured data: what search and answer engines read to know what the page is, who wrote it,
 * where it was published and when. Built from the same record the page shows.
 */
export function recordStructuredData(item: Item, baseUrl: string) {
	const url = buildSiteUrl(`/lib/${item.key}`, baseUrl);
	const cover = item.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage;
	// Authors are people: records from OpenAlex keep a person's whole name in one field, so the field's shape can't tell an organisation apart.
	const authors = (item.creators ?? []).filter((creator) => creator.creatorType === "author" && creatorDisplayName(creator)).map((creator) => named("Person", creatorDisplayName(creator)));
	const licence = completeRecordLicence(item.licence);
	const type = (item.itemType && TYPES[item.itemType]) ?? "CreativeWork";
	const data: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": type,
		"@id": url,
		url,
		name: item.title,
		headline: item.title?.slice(0, 110),
		author: authors,
		datePublished: dateOf(item.date),
		dateModified: item.dateModified ? new Date(item.dateModified).toISOString() : undefined,
		abstract: item.abstractNote,
		isPartOf: item.itemType && CONTAINERS[item.itemType] ? named(CONTAINERS[item.itemType]!, item.publicationTitle) : undefined,
		publisher: named("Organization", item.publisher),
		inLanguage: item.languageName,
		keywords: item.tags?.join(", "),
		sameAs: doiAddressOf(item),
		image: cover && convertToImageURL(cover),
		license: licence && licenceTermsUrl(licence),
		// Google reads a dataset by its description and creator, not an article's abstract and author.
		...(type === "Dataset" && { description: item.abstractNote, creator: authors }),
	};
	// Empty values say nothing, so they're left out.
	return Object.fromEntries(Object.entries(data).filter(([, value]) => value != null && value !== "" && !(Array.isArray(value) && !value.length)));
}
