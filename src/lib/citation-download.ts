import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import assets from "./citation-assets/csl.json";
import { CITATION_FORMATS, type CitationData } from "./citation-formats";
import {
	loadCitationStyles,
	type CitationStyleAssets,
} from "./citation-styles";
import { formatBibliography } from "./citation-formatter";
import {
	buildCitationDocument,
	type CitationDocumentFormat,
} from "./citation-document";
import { buildLibraryExportFilename } from "./library-exports";

type CitationDownloadSelection = {
	format: CitationDocumentFormat;
	style: unknown;
	locales: Record<string, unknown>;
	label: string;
};

export async function resolveCitationDownload(
	request: Request,
): Promise<CitationDownloadSelection | null> {
	const params = new URL(request.url).searchParams;
	const format = params.get("format");
	if (format !== "txt" && format !== "html") return null;
	const selected = (await loadCitationStyles()).find(
		(style) => style.id === params.get("style"),
	);
	if (!selected || selected.id === "bibtex") return null;
	const common = CITATION_FORMATS.find((style) => style.id === selected.id);
	let style: unknown;
	let locales: Record<string, unknown> = {};
	if (common?.style) {
		style = assets.styles[common.style];
	} else if (selected.asset) {
		// Only catalog-owned paths can reach the filesystem.
		const extra: CitationStyleAssets = JSON.parse(
			gunzipSync(
				await readFile(
					join(process.cwd(), "public", selected.asset.slice(1)),
				),
			).toString("utf8"),
		);
		style = extra.styles[selected.id];
		locales = extra.locales;
	}
	if (!style) return null;
	return { format, style, locales, label: selected.label };
}

export function citationDownloadResponse(
	records: readonly CitationData[],
	selection: CitationDownloadSelection,
	options: {
		locale: string;
		numbered: boolean;
		fileName: string;
		libraryBaseUrl?: string;
	},
) {
	const citation = formatBibliography(
		records,
		options.locale,
		selection.style,
		selection.locales,
		options.numbered,
		options.libraryBaseUrl,
	);
	const filename = buildLibraryExportFilename(
		options.fileName,
		selection.format,
	);
	return new Response(
		buildCitationDocument(citation, selection.format, selection.label),
		{
			headers: {
				"Cache-Control": "no-store",
				"Content-Type": `${selection.format === "html" ? "text/html" : "text/plain"}; charset=utf-8`,
				"Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
			},
		},
	);
}
