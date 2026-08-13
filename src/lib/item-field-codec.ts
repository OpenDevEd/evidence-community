export function canonicalItemTypeToZotero(itemType: unknown) {
	if (typeof itemType !== "string" || itemType.length === 0) return "";
	return itemType[0]!.toLowerCase() + itemType.slice(1);
}

export function canonicalItemFieldToDatabaseField(field: string) {
	return field === "language" ? "languageName" : field;
}

export function databaseItemFieldToPayloadField(field: string) {
	return field === "languageName" ? "language" : field;
}
