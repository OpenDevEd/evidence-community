import { getPublicItemCards } from "@/lib/public-item-card";
import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { itemToCitationData } from "@/lib/citation-data";
import { formatCitations } from "@/lib/citation-formatter";
import { buildSiteUrl } from "@/lib/site-url";

export async function getCitationsForItemKey(key: string, locale: string) {
	const config = await getLibraryConfig();
	if (!config.citations.enabled) return null;
	// Read only public bibliographic fields, without full text, collections or related records.
	const [item] = await getPublicItemCards(await getDatabaseForConfig(config), [key], config, true);
	const data = item && itemToCitationData(item);
	if (!data) return null;
	return formatCitations(data, locale, config.citations.showUrl
		? buildSiteUrl(`/lib/${key}`, config.identity.baseUrl)
		: undefined);
}
