import { citationHtml } from "@/lib/citation-html";
import type { FormattedCitation } from "@/lib/citation-formats";
import { escapeHtml } from "@/lib/escape-html";

export type CitationDocumentFormat = "txt" | "html";

export function buildCitationDocument(
	citation: FormattedCitation,
	format: CitationDocumentFormat,
	title: string,
): string {
	if (format === "txt") return citation.text;
	// Reuse the same restricted renderer as the preview, including safe links.
	const body = citationHtml(citation.html ?? escapeHtml(citation.text));
	return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;line-height:1.7;max-width:52rem;margin:2rem auto;padding:0 1.5rem;overflow-wrap:anywhere}a{color:#006859}.csl-entry{display:flow-root;margin-bottom:1rem}.csl-left-margin{float:left;margin-right:.75rem}.csl-right-inline{overflow:hidden}.csl-indent{margin-left:2rem}</style></head><body>${body}</body></html>`;
}
