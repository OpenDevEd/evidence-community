import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";

export type ZoteroItemReference = {
	libraryType: "group" | "user";
	libraryId: string;
	itemKey: string;
};

const ZOTERO_ITEM_URI_PATTERN =
	/^https?:\/\/(?:www\.)?zotero\.org\/(groups|users)\/(\d+)\/items\/([^/?#]+)\/?$/;

/**
 * Reads a Zotero item URI such as `http://zotero.org/groups/123/items/ABCD2345`.
 * Returns null for anything that is not a Zotero item link with a valid key.
 */
export function parseZoteroItemUri(value: string): ZoteroItemReference | null {
	const match = ZOTERO_ITEM_URI_PATTERN.exec(value.trim());
	if (!match) return null;
	const [, libraryType, libraryId, itemKey] = match;
	if (!isCanonicalRecordKey(itemKey)) return null;
	return {
		libraryType: libraryType === "groups" ? "group" : "user",
		libraryId,
		itemKey,
	};
}

/** Builds the canonical `http://zotero.org/...` item URI Zotero uses in relations. */
export function formatZoteroItemUri(reference: ZoteroItemReference): string {
	const scope = reference.libraryType === "group" ? "groups" : "users";
	return `http://zotero.org/${scope}/${reference.libraryId}/items/${reference.itemKey}`;
}
