import { MAX_CREATOR_INSTITUTION_NAME_LENGTH, MAX_CREATOR_INSTITUTIONS } from "@/lib/admin/native-item-validation";
import { countryFocusNames } from "@/lib/country-focus";
import type { LiveOpenscholarReport } from "@/lib/openscholar-service";
import { docidLine, normalizeDocid } from "@/lib/docid";

/**
 * A live Openscholar Report as the item a DOI lookup gives for a report, from Openscholar's own details. Its address
 * is its page on Openscholar, which a sandbox DOI that resolves nowhere still reaches.
 */
export function reportZoteroItem(report: LiveOpenscholarReport): Record<string, unknown> {
	return {
		itemType: "report",
		title: report.subtitle.trim() ? `${report.title.trim()}: ${report.subtitle.trim()}` : report.title.trim(),
		creators: report.authors.map((author) => {
			const institutions = [...new Set(author.affiliations.map((affiliation) => affiliation.name.trim()).filter((name) => name && name.length <= MAX_CREATOR_INSTITUTION_NAME_LENGTH))].slice(0, MAX_CREATOR_INSTITUTIONS);
			return { creatorType: "author", name: author.name.trim(), ...(institutions.length && { institutions: institutions.map((display_name) => ({ display_name })) }) };
		}),
		abstractNote: report.abstract,
		date: report.date,
		language: report.language,
		DOI: report.doi,
		url: report.pageUrl,
		rights: report.licence,
		institution: "Openscholar",
		seriesTitle: report.series,
		reportType: "Report",
		tags: report.keywords.map((tag) => ({ tag })),
		// Its DOCiD, kept as Zotero keeps identifiers it has no field for (src/lib/docid.ts).
		...(normalizeDocid(report.docid) && { extra: docidLine(normalizeDocid(report.docid)!) }),
	};
}

/**
 * What a report's affiliations say of their institutions, as an OpenAlex page's works say it: the country each is in and
 * its OpenAlex ID, so the community places them and finds their ROR IDs as for any work's.
 */
export function reportInstitutionFacts(reports: readonly LiveOpenscholarReport[]) {
	const facts = new Map<string, { name: string; countryCode: string; openalexId: string | null; city: null }>();
	for (const affiliation of reports.flatMap((report) => report.authors.flatMap((author) => author.affiliations))) {
		const name = affiliation.name.trim();
		const countryCode = affiliation.country.trim().toUpperCase();
		if (!name || name.length > MAX_CREATOR_INSTITUTION_NAME_LENGTH || !Object.hasOwn(countryFocusNames, countryCode)) continue;
		const openalexId = affiliation.id?.match(/^(?:https?:\/\/openalex\.org\/)?(I\d+)$/u)?.[1] ?? null;
		const key = name.toLowerCase();
		if (!facts.has(key)) facts.set(key, { name, countryCode, openalexId, city: null });
	}
	return [...facts.values()];
}
