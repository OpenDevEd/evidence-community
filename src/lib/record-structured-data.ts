import type { Item } from "@/app/api/item/types";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL, getExtraValues } from "@/lib/utils";

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

/** The record's date as a calendar day, when it reads as one. */
const dayOf = (date: string | null | undefined) => (date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString().slice(0, 10) : undefined);

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
	const authors = (item.creators ?? []).filter((creator) => creator.creatorType === "author").map(creatorDisplayName).filter(Boolean);
	const data: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": (item.itemType && TYPES[item.itemType]) ?? "CreativeWork",
		"@id": url,
		url,
		name: item.title,
		headline: item.title?.slice(0, 110),
		author: authors.map((name) => named("Person", name)),
		datePublished: dayOf(item.date),
		abstract: item.abstractNote,
		isPartOf: named("Periodical", item.publicationTitle),
		publisher: named("Organization", item.publisher),
		inLanguage: item.languageName,
		keywords: item.tags?.join(", "),
		sameAs: doiAddressOf(item),
		image: cover && convertToImageURL(cover),
	};
	// Empty values say nothing, so they're left out.
	return Object.fromEntries(Object.entries(data).filter(([, value]) => value != null && value !== "" && !(Array.isArray(value) && !value.length)));
}
