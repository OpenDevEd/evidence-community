import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";

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

/**
 * Adds the field names Zotero uses for this record's type.
 *
 * Records are stored under shared field names: a report number and a patent
 * number both live in `number`, and the language lives in `languageName`.
 * Citation formats ask for the name that belongs to the item type, such as
 * `reportNumber`, `patentNumber` or `language`. Without this step a report
 * would lose its number and its language in RIS and BibTeX.
 *
 * The stored names are kept as well, so callers that read them still work.
 * `itemType` is left exactly as it is stored.
 */
export function withZoteroFieldNames<Record_ extends Record<string, unknown>>(
	record: Record_,
): Record_ {
	const zoteroItemType = canonicalItemTypeToZotero(record.itemType);
	if (!zoteroItemType) return { ...record };

	const named = { ...record } as Record<string, unknown>;

	for (const { field, semanticField } of describeZoteroItemTypeFields(
		zoteroItemType,
	)) {
		const storedField = canonicalItemFieldToDatabaseField(semanticField);
		if (field === storedField) continue;

		const value = record[storedField];
		if (value === null || value === undefined || value === "") continue;

		named[field] = value;
	}

	return named as Record_;
}
