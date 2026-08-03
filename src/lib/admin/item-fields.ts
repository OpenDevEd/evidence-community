export const ADMIN_SHARED_PAYLOAD_FIELDS = new Set([
	"collections",
	"creators",
	"itemType",
	"parentItem",
	"relations",
	"tags",
]);

export function adminPayloadFieldToDatabaseField(field: string) {
	return field === "language" ? "languageName" : field;
}

export function adminDatabaseFieldToPayloadField(field: string) {
	return field === "languageName" ? "language" : field;
}

const CHILD_ONLY_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);

export function isTopLevelAdminItemType(itemType: string) {
	return !CHILD_ONLY_ITEM_TYPES.has(itemType.toLowerCase());
}
