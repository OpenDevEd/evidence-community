import { getPublicItemCards } from "@/lib/public-item-card";
import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { itemToCitationData } from "@/lib/citation-data";
import { formatCitations } from "@/lib/citation-formatter";
import { isIndexOnly } from "@/lib/search-index/index-only";
import { readIndexedItem } from "@/lib/search-index/index-only-read";
import { buildSiteUrl } from "@/lib/site-url";
import type { CitationResponse } from "@/lib/citation-formats";

export async function getCitationsForItemKey(key: string, locale: string): Promise<CitationResponse> {
	const config = await getLibraryConfig();
	if (!config.citations.enabled) return { citations: null, record: null };
	// Read only public bibliographic fields, without full text, collections or related records.
	const item = isIndexOnly(config)
		? await readIndexedItem(key, config)
		: (await getPublicItemCards(await getDatabaseForConfig(config), [key], config, true))[0];
	const data = item && itemToCitationData(item);
	if (!data) return { citations: null, record: null };
	const citations = await formatCitations(data, locale, config.citations.showUrl
		? buildSiteUrl(`/lib/${key}`, config.identity.baseUrl)
		: undefined);
	return { citations, record: data };
}
