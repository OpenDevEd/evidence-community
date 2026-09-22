import type { CitationData, CitationResponse, CitationItem } from "@/lib/citation-formats";

import { itemToCitationData } from "@/lib/citation-data";

export type CitationSource = { record: CitationData | null } | Pick<CitationItem, "key" | "revision" | "DOI" | "updatedAt">;
export type CitationRequest = readonly ["citations", CitationSource, string, string | undefined];

/** Full item pages already have the published metadata; only compact cards need a read. */
export async function loadCitations([, source, locale, libraryUrl]: CitationRequest): Promise<CitationResponse> {
	if ("record" in source) {
		if (!source.record) return { citations: null, record: null };
		const { formatCitations } = await import("@/lib/citation-formatter");
		return { citations: await formatCitations(source.record, locale, libraryUrl), record: source.record };
	}
	const response = await fetch(`/api/item/${encodeURIComponent(source.key)}/citation`, { headers: { "Accept-Language": locale } });
	if (!response.ok) throw new Error("Citation request failed");
	return response.json();
}

export function citationSource(item: CitationItem, completeRecord: boolean): CitationSource {
	return completeRecord ? { record: itemToCitationData(item) } : { key: item.key, revision: item.revision, DOI: item.DOI, updatedAt: item.updatedAt };
}

export async function loadAdditionalCitation([, record, locale, style, libraryUrl]: readonly [
  "citation-style", import("./citation-formats").CitationData, string, import("./citation-formats").CitationStyle, string | undefined,
]): Promise<string> {
  const { formatAdditionalCitation } = await import("./citation-formatter");
  return formatAdditionalCitation(record, locale, style, libraryUrl);
}
