import { escapeHtml } from "@/lib/escape-html";
import { buildSiteUrl } from "@/lib/site-url";
import assets from "./citation-assets/csl.json";
import { CSL } from "citeproc-ts";
import { withoutCitationNumbers } from "./citation-numbering";
import { formatCitationExport } from "@/lib/citation-export";
import {
	CITATION_FORMATS,
	type CitationData,
	type Citations,
	type CitationStyle,
	type FormattedCitation,
} from "@/lib/citation-formats";

import { loadCitationStyleAssets } from "./citation-styles";

const localeAssets: Record<string, unknown> = assets.locales;
const locales: Record<string, string> = {
	en: "en-GB",
	de: "de-DE",
	fr: "fr-FR",
	hi: "hi-IN",
	pt: "pt-PT",
	zh: "zh-CN",
	cn: "zh-CN",
	ja: "ja-JP",
};

/** Every request gets its own processors; only immutable style assets are shared. */
export async function formatCitations(
	data: CitationData,
	language: string,
	libraryUrl?: string,
): Promise<Citations> {
	const locale = locales[language] ?? language;
	const entries = await Promise.all(
		CITATION_FORMATS.map(async (format) => {
			if (format.id === "bibtex") {
				return [
					format.id,
					{
						text: formatCitationExport(data, "bibtex", libraryUrl),
						html: null,
					},
				] as const;
			}
			return [
				format.id,
				renderCitation(
					data,
					locale,
					assets.styles[format.style],
					localeAssets,
					libraryUrl,
				),
			] as const;
		}),
	);
	return Object.fromEntries(entries) as Citations;
}

function withLibraryUrl(
	citation: FormattedCitation,
	libraryUrl?: string,
): FormattedCitation {
	const { text, html } = citation;
	if (!libraryUrl || text.includes(libraryUrl)) return citation;
	const separator = text.endsWith(".") ? "" : ".";
	const link = escapeHtml(libraryUrl);
	const suffix = `${separator} Available at <a href="${link}">${link}</a>.`;
	return {
		text: `${text}${separator} Available at ${libraryUrl}.`,
		html: html?.endsWith("</div>")
			? html.replace(/<\/div>$/, () => `${suffix}</div>`)
			: (html ?? "") + suffix,
	};
}

function renderEntries(
	data: readonly CitationData[],
	locale: string,
	style: unknown,
	availableLocales: Record<string, unknown>,
	numbered: boolean,
	urlForItem: (id: string) => string | undefined,
): FormattedCitation {
	if (!data.length) return { text: "", html: "" };
	const records = new Map(data.map((record) => [record.id, record]));
	const engine = new CSL.Engine(
		{
			retrieveItem: (id) => structuredClone(records.get(id)!),
			retrieveLocale: (requested) =>
				availableLocales[locales[requested] ?? requested] ??
				assets.locales["en-US"],
		},
		numbered ? style : withoutCitationNumbers(style),
		locale,
	);
	engine.opt.development_extensions.wrap_url_and_doi = true;
	engine.updateItems(data.map((record) => record.id));
	engine.setOutputFormat("text");
	const bibliography = engine.makeBibliography();
	// Note-only styles define a full citation without a bibliography.
	const plain = bibliography
		? bibliography[1]
		: data.map((record) => engine.makeCitationCluster([{ id: record.id }]));
	const ids = bibliography
		? bibliography[0].entry_ids.map((entry) => String(entry[0]))
		: data.map((record) => record.id);
	engine.setOutputFormat("html");
	const richBibliography = engine.makeBibliography();
	const rich = richBibliography
		? richBibliography[1]
		: data.map((record) => engine.makeCitationCluster([{ id: record.id }]));
	const entries = plain.map((entry, index) => {
		if (!entry.trim()) throw new Error("Citation formatting failed");
		return withLibraryUrl(
			{ text: entry.trim(), html: rich[index].trim() },
			urlForItem(ids[index]),
		);
	});
	return {
		text: entries.map((entry) => entry.text).join("\n\n"),
		html: entries.map((entry) => entry.html).join("\n"),
	};
}

function renderCitation(
	data: CitationData,
	locale: string,
	style: unknown,
	availableLocales: Record<string, unknown>,
	libraryUrl?: string,
): FormattedCitation {
	return renderEntries(
		[data],
		locale,
		style,
		availableLocales,
		false,
		() => libraryUrl,
	);
}

/** One processor assigns numbers, sorting and disambiguation across the entire bibliography. */
export function formatBibliography(
	data: readonly CitationData[],
	language: string,
	style: unknown,
	extraLocales: Record<string, unknown>,
	numbered: boolean,
	libraryBaseUrl?: string,
): FormattedCitation {
	return renderEntries(
		data,
		locales[language] ?? language,
		style,
		{ ...localeAssets, ...extraLocales },
		numbered,
		(id) =>
			libraryBaseUrl
				? buildSiteUrl(`/lib/${id}`, libraryBaseUrl)
				: undefined,
	);
}

export async function formatAdditionalCitation(
	data: CitationData,
	language: string,
	selected: CitationStyle,
	libraryUrl?: string,
): Promise<FormattedCitation> {
	if (!selected.asset)
		throw new Error("An additional citation style is required");
	const extra = await loadCitationStyleAssets(selected.asset);
	const style = extra.styles[selected.id];
	if (!style) throw new Error("Citation style not found");
	return renderCitation(
		data,
		locales[language] ?? language,
		style,
		{ ...localeAssets, ...extra.locales },
		libraryUrl,
	);
}
