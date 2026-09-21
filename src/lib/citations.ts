import { getCachedItem } from "@/app/api/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import { itemToCitationData } from "@/lib/citation-data";
import { formatCitations } from "@/lib/citation-formatter";
import { buildSiteUrl } from "@/lib/site-url";

export async function getCitationsForItemKey(key: string, locale: string) {
	const config = await getLibraryConfig();
	if (!config.citations.enabled) return null;
	// This reader enforces publication visibility in PostgreSQL.
	const { item } = await getCachedItem(key);
	const data = item && itemToCitationData(item);
	if (!data) return null;
	return formatCitations(data, locale, config.citations.showUrl
		? buildSiteUrl(`/lib/${key}`, config.identity.baseUrl)
		: undefined);
}
