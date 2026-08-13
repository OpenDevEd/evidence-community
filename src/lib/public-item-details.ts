import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";

import { getCanonicalWebsiteItemUrl } from "@/lib/canonical-item-url";
import {
	canonicalItemFieldToDatabaseField,
	canonicalItemTypeToZotero,
} from "@/lib/item-field-codec";

const SEPARATELY_DISPLAYED_FIELDS = new Set([
	"abstractNote",
	"callNumber",
	"date",
	"DOI",
	"extra",
	"title",
]);

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

	return describeZoteroItemTypeFields(
		canonicalItemTypeToZotero(item.itemType),
	).flatMap(
		({ field, semanticField }) => {
			if (SEPARATELY_DISPLAYED_FIELDS.has(semanticField)) return [];
			if (field === "url" && ownUrl) return [];
			const value = item[canonicalItemFieldToDatabaseField(semanticField)];
			if (value === null || value === undefined || value === "") return [];
			return [{ label: field, value }];
		},
	);
}
