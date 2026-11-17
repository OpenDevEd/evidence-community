import type { AdminItemDetail } from "@/lib/admin/types";
import {
	describeZoteroField,
	type ZoteroFieldDescriptor,
} from "@opendeved/evidence-library-core/zotero-schema";
import {
	ADMIN_SHARED_PAYLOAD_FIELDS,
	adminSharedPayloadFieldsForZoteroItemType,
	adminSpecialFieldsForZoteroItemType,
} from "@/lib/admin/item-fields";

export type AdminSchemaDefinition = {
	creatorTypes: Array<{
		creatorType: string;
		primary?: boolean;
	}>;
	fields: Array<{
		baseField?: string;
		field: string;
	}>;
	itemType: string;
};

export function adminFieldDescriptors(
	definition: AdminSchemaDefinition | undefined,
): ZoteroFieldDescriptor[] {
	if (!definition) return [];
	const fields = definition.fields.map(describeZoteroField);
	const known = new Set(fields.map(({ field }) => field));
	for (const field of adminSpecialFieldsForZoteroItemType(
		definition.itemType,
	)) {
		if (known.has(field)) continue;
		fields.push({ field, semanticField: field, type: "text" });
	}
	return fields;
}

export function humanizeAdminField(value: string) {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.split(" ");
	const acronyms = new Set(["doi", "isbn", "issn", "pmid", "tv", "url"]);
	return words
		.map((word) =>
			acronyms.has(word.toLowerCase())
				? word.toUpperCase()
				: word.replace(/^\w/, (character) => character.toUpperCase()),
		)
		.join(" ");
}

export function definitionFor(
	definitions: readonly AdminSchemaDefinition[],
	itemType: string,
) {
	return (
		definitions.find(
			(definition) =>
				definition.itemType.toLowerCase() === itemType.toLowerCase(),
		) ?? definitions[0]
	);
}

export function editablePayloadFromDetail(
	detail: AdminItemDetail,
	definitions: readonly AdminSchemaDefinition[],
) {
	if (detail.draft) return { ...detail.draft.payload };
	const definition = definitionFor(definitions, detail.itemType);
	const published = detail.published ?? {};
	const payload = sharedPayloadFromDetail(detail, definition);
	for (const { field } of adminFieldDescriptors(definition)) {
		const value = published[field];
		if (value !== null && value !== undefined) payload[field] = value;
	}
	return payload;
}

function sharedPayloadFromDetail(
	detail: AdminItemDetail,
	definition: AdminSchemaDefinition | undefined,
) {
	const published = detail.published ?? {};
	const sharedFields = definition
		? adminSharedPayloadFieldsForZoteroItemType(definition)
		: ADMIN_SHARED_PAYLOAD_FIELDS;
	const values: Record<string, unknown> = {
		itemType: definition?.itemType ?? detail.itemType,
		tags: detail.tags,
		collections: detail.collectionKeys,
		links: detail.links.publishedKeys,
		...Object.fromEntries(
			(["countryFocus", "openAccess", "studyType", "licence", "topics"] as const).map((field) => [field, published[field] ?? null]),
		),
		creators: published.creators ?? detail.creators,
		...(detail.parentItem ? { parentItem: detail.parentItem } : {}),
	};
	return Object.fromEntries(
		Object.entries(values).filter(([field]) => sharedFields.has(field)),
	);
}

export function payloadForItemType(
	payload: Record<string, unknown>,
	nextDefinition: AdminSchemaDefinition,
) {
	const nextFields = new Set(
		adminFieldDescriptors(nextDefinition).map(({ field }) => field),
	);
	const sharedFields =
		adminSharedPayloadFieldsForZoteroItemType(nextDefinition);
	return Object.fromEntries(
		Object.entries({
			...payload,
			itemType: nextDefinition.itemType,
		}).filter(([field]) => {
			if (sharedFields.has(field)) return true;
			return nextFields.has(field);
		}),
	);
}
