import type { LiveOpenscholarReport } from "@/lib/openscholar-service";

/**
 * A live Openscholar Report as the item a DOI lookup gives for a report, from Openscholar's own details. Its address
 * is its page on Openscholar, which a sandbox DOI that resolves nowhere still reaches.
 */
export function reportZoteroItem(report: LiveOpenscholarReport): Record<string, unknown> {
	return {
		itemType: "report",
		title: report.subtitle.trim() ? `${report.title.trim()}: ${report.subtitle.trim()}` : report.title.trim(),
		creators: report.authors.map((author) => ({ creatorType: "author", name: author.name.trim() })),
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
	};
}
