import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { canonicalItemTypeToZotero, withZoteroFieldNames } from "@/lib/item-field-codec";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import type { CitationData, CitationDate, CitationName } from "@/lib/citation-formats";

const schema = getZoteroSchema().csl;
const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : "";

function citationTextFields(fields: Record<string, unknown>) {
	const text: Record<string, string | number> = {};
	for (const [field, candidates] of Object.entries(schema.fields.text)) {
		if (field === "citation-key") continue;
		for (const candidate of candidates) {
			const value = fields[candidate];
			if (typeof value === "number" || stringValue(value)) {
				text[field] = typeof value === "number" ? value : stringValue(value);
				break;
			}
		}
	}
	if (typeof text.DOI === "string") text.DOI = text.DOI.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
	return text;
}

function citationDates(fields: Record<string, unknown>) {
	const dates: Record<string, CitationDate> = {};
	for (const [field, source] of Object.entries(schema.fields.date)) {
		const value = stringValue(fields[source]);
		if (!value) continue;
		const parsed = parseBibliographicDate(value);
		dates[field] = parsed.kind === "parsed"
			? { "date-parts": [parsed.raw.split("-").map(Number)] }
			: { literal: value };
	}
	return dates;
}

function citationName(creator: Record<string, unknown>): CitationName | null {
	const literal = stringValue(creator.name);
	if (literal) return { literal };
	const family = stringValue(creator.lastName);
	const given = stringValue(creator.firstName);
	if (family) return { family, ...(given ? { given } : {}) };
	return given ? { literal: given } : null;
}

function citationNames(value: unknown) {
	const creators: unknown[] = Array.isArray(value) ? value : [];
	const names: Record<string, CitationName[]> = {};
	for (const value of creators) {
		if (!value || typeof value !== "object") continue;
		const creator = value as Record<string, unknown>;
		const role = schema.names[stringValue(creator.creatorType)];
		const name = citationName(creator);
		if (role && name) (names[role] ??= []).push(name);
	}
	return names;
}

/** Use the vendored Zotero schema, also used by the editor and ingestion. */
export function itemToCitationData(item: Record<string, unknown>): CitationData | null {
	const title = stringValue(item.title);
	const key = stringValue(item.key);
	const itemType = canonicalItemTypeToZotero(item.itemType);
	if (!title || !key || ["attachment", "note"].includes(itemType)) return null;
	const type = Object.entries(schema.types).find(([, types]) => types.includes(itemType))?.[0];
	if (!type) return null;
	const fields = withZoteroFieldNames(item);
	const keyword = Array.isArray(item.tags) ? item.tags.map(stringValue).filter(Boolean).sort().join(", ") : "";
	return { ...citationTextFields(fields), ...citationDates(fields), ...citationNames(item.creators),
		...(keyword ? { keyword } : {}), id: key, type, title, "citation-key": `el_${key}` };
}
