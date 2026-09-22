import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import type { BibliographicExportFormat } from "@/config/library-config/exports";
import type { CitationData } from "@/lib/citation-formats";
import { itemToCitationData } from "@/lib/citation-data";
import { buildSiteUrl } from "@/lib/site-url";

export function formatCitationExport(data: CitationData, format: BibliographicExportFormat, libraryUrl?: string): string {
	const record: CitationData = libraryUrl ? { ...data, URL: libraryUrl } : { ...data };
	// BibTeX has one editor field; CSL and RIS retain separate series editors.
	if (format === "bibtex" && Array.isArray(record["collection-editor"])) {
		record.editor = [...(Array.isArray(record.editor) ? record.editor : []), ...record["collection-editor"]];
	}
	return new Cite([record]).format(format, { format: "text" }).trim();
}

export function exportCitationItems(
	items: readonly Record<string, unknown>[],
	format: BibliographicExportFormat,
	libraryBaseUrl?: string,
): string {
	return items.map(item => {
		const data = itemToCitationData(item);
		if (!data) throw new Error(`Unable to export publication ${item.key}`);
		return formatCitationExport(data, format, libraryBaseUrl ? buildSiteUrl(`/lib/${data.id}`, libraryBaseUrl) : undefined);
	}).join("\n\n");
}
