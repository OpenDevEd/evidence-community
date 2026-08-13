import { buildSiteUrl } from "@/lib/site-url";

type AdminPublicLinkItem = {
	filePublication: unknown;
	itemType: string;
	key: string;
	parentItem: string | null;
	parentState: string | null;
	published: unknown;
	sourceFileUrl: string | null;
	state: string;
};

function isPublicRecordState(state: string | null) {
	return state === "edited" || state === "published";
}

export function buildAdminPublicItemUrl(
	item: AdminPublicLinkItem,
	baseUrl: string,
) {
	if (item.itemType !== "Attachment") {
		return item.published && isPublicRecordState(item.state)
			? buildSiteUrl(`/lib/${item.key}`, baseUrl)
			: null;
	}

	if (
		!item.parentItem ||
		!isPublicRecordState(item.state) ||
		!isPublicRecordState(item.parentState) ||
		(!item.filePublication && !item.sourceFileUrl)
	) {
		return null;
	}

	return buildSiteUrl(
		`/lib/${item.parentItem}/download/${item.key}`,
		baseUrl,
	);
}
