import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-ris";
import type { BibliographicExportFormat } from "@/config/library-config/exports";
import type { CitationData } from "@/lib/citation-formats";
import { itemToCitationData } from "@/lib/citation-data";
import { buildSiteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/escape-html";

function risCreatorNote(data: CitationData) {
	const names = Object.fromEntries(Object.entries(data).filter(([, value]) =>
		Array.isArray(value) && value.some(name => Object.values(name).some(part => /[,<>&]/.test(part))),
	));
	if (!Object.keys(names).length) return undefined;
	return `RIS import may change punctuation in names. Original creator names: ${escapeHtml(JSON.stringify(names))}`;
}

export function formatCitationExport(data: CitationData, format: BibliographicExportFormat, libraryUrl?: string): string {
	const record: CitationData = libraryUrl ? { ...data, URL: libraryUrl } : { ...data };
	// The vendored Zotero schema uses CSL article only for preprints.
	const publicationType = data.type === "article" ? "Preprint" : data.type === "thesis" ? "Thesis" : undefined;
	if (publicationType) {
		record.genre ||= publicationType;
		record.note = [record.note, `Publication type: ${publicationType}.`].filter(Boolean).join("\n");
		if (publicationType === "Preprint") record.type = "manuscript";
	}
	// BibTeX has one editor field; CSL and RIS retain separate series editors.
	if (format === "bibtex" && Array.isArray(record["collection-editor"])) {
		record.editor = [...(Array.isArray(record.editor) ? record.editor : []), ...record["collection-editor"]];
	}
	const creatorNote = format === "ris" ? risCreatorNote(record) : undefined;
	if (creatorNote) record.note = [record.note, creatorNote].filter(Boolean).join("\n");
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
