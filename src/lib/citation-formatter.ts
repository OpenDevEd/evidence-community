import { escapeHtml } from "@/lib/escape-html";
import assets from "./citation-assets/csl.json";
import { CSL } from "citeproc-ts";
import { formatCitationExport } from "@/lib/citation-export";
import { CITATION_FORMATS, type CitationData, type Citations, type CitationStyle, type FormattedCitation } from "@/lib/citation-formats";

import { loadCitationStyleAssets } from "./citation-styles";

const localeAssets: Record<string, unknown> = assets.locales;
const locales: Record<string, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR", hi: "hi-IN", pt: "pt-PT", zh: "zh-CN", cn: "zh-CN", ja: "ja-JP" };

/** Every request gets its own processors; only immutable style assets are shared. */
export async function formatCitations(data: CitationData, language: string, libraryUrl?: string): Promise<Citations> {
	const locale = locales[language] ?? language;
	const entries = await Promise.all(CITATION_FORMATS.map(async (format) => {
		if (format.id === "bibtex") {
			return [format.id, { text: formatCitationExport(data, "bibtex", libraryUrl), html: null }] as const;
		}
        return [format.id, renderCitation(data, locale, assets.styles[format.style], localeAssets, libraryUrl)] as const;
	}));
	return Object.fromEntries(entries) as Citations;
}

function renderCitation(data: CitationData, locale: string, style: unknown, availableLocales: Record<string, unknown>, libraryUrl?: string): FormattedCitation {
  const engine = new CSL.Engine({ retrieveItem: () => structuredClone(data), retrieveLocale: requested => availableLocales[locales[requested] ?? requested] ?? assets.locales["en-US"] }, style, locale);
  engine.opt.development_extensions.wrap_url_and_doi = true;
  engine.setOutputFormat("text");
  engine.updateItems([data.id]);
  const bibliography = engine.makeBibliography();
  // Note-only CSL styles intentionally define a citation without a bibliography.
  const text = (bibliography ? bibliography[1][0] : engine.makeCitationCluster([{ id: data.id }])).trim();
  if (!text) throw new Error("Citation formatting failed");
  engine.setOutputFormat("html");
  const html = bibliography ? engine.makeBibliography() : false;
  const rich = (html ? html[1][0] : engine.makeCitationCluster([{ id: data.id }])).trim();
  if (!libraryUrl || text.includes(libraryUrl)) return { text, html: rich };
  const separator = text.endsWith(".") ? "" : ".";
  const link = escapeHtml(libraryUrl);
  const suffix = `${separator} Available at <a href="${link}">${link}</a>.`;
  return {
    text: `${text}${separator} Available at ${libraryUrl}.`,
    html: rich.endsWith("</div>") ? rich.replace(/<\/div>$/, () => `${suffix}</div>`) : rich + suffix,
  };
}

export async function formatAdditionalCitation(data: CitationData, language: string, selected: CitationStyle, libraryUrl?: string): Promise<FormattedCitation> {
  if (!selected.asset) throw new Error("An additional citation style is required");
  const extra = await loadCitationStyleAssets(selected.asset);
  const style = extra.styles[selected.id];
  if (!style) throw new Error("Citation style not found");
  return renderCitation(data, locales[language] ?? language, style, { ...localeAssets, ...extra.locales }, libraryUrl);
}
