import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";

import { getCanonicalWebsiteItemUrl } from "@/lib/canonical-item-url";

const SEPARATELY_DISPLAYED_FIELDS = new Set([
	"abstractNote",
	"callNumber",
	"date",
	"DOI",
	"extra",
	"publisher",
	"title",
]);

function zoteroItemType(itemType: unknown) {
	if (typeof itemType !== "string" || itemType.length === 0) return "";
	return itemType[0]!.toLowerCase() + itemType.slice(1);
}

function canonicalStorageField(semanticField: string) {
	return semanticField === "language" ? "languageName" : semanticField;
}

export type PublicItemDetail = { label: string; value: unknown };

export function selectPublicItemDetails(
	item: Readonly<Record<string, unknown>>,
	baseUrl: string,
): PublicItemDetail[] {
	const key = typeof item.key === "string" ? item.key : "";
	const ownUrl =
		typeof item.url === "string"
			? getCanonicalWebsiteItemUrl({ key, url: item.url }, baseUrl)
			: null;

	return describeZoteroItemTypeFields(zoteroItemType(item.itemType)).flatMap(
		({ field, semanticField }) => {
			if (SEPARATELY_DISPLAYED_FIELDS.has(semanticField)) return [];
			if (field === "url" && ownUrl) return [];
			const value = item[canonicalStorageField(semanticField)];
			if (value === null || value === undefined || value === "") return [];
			return [{ label: field, value }];
		},
	);
}
