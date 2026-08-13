import type { AdminItemDetail } from "@/lib/admin/types";
import {
	ADMIN_SHARED_PAYLOAD_FIELDS,
	adminSharedPayloadFieldsForZoteroItemType,
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
	const sharedFields = definition
		? adminSharedPayloadFieldsForZoteroItemType(definition)
		: ADMIN_SHARED_PAYLOAD_FIELDS;
	const payload: Record<string, unknown> = {
		itemType: definition?.itemType ?? detail.itemType,
		tags: detail.tags,
	};
	if (sharedFields.has("collections")) {
		payload.collections = detail.collectionKeys;
	}
	if (sharedFields.has("creators")) {
		payload.creators = published.creators ?? detail.creators;
	}
	if (sharedFields.has("parentItem") && detail.parentItem) {
		payload.parentItem = detail.parentItem;
	}
	for (const { field } of definition?.fields ?? []) {
		const value = published[field];
		if (value !== null && value !== undefined) payload[field] = value;
	}
	return payload;
}

export function payloadForItemType(
	payload: Record<string, unknown>,
	nextDefinition: AdminSchemaDefinition,
) {
	const nextFields = new Set(nextDefinition.fields.map(({ field }) => field));
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

export function creatorDisplayName(creator: {
	firstName?: string;
	lastName?: string;
	name?: string;
}) {
	return (
		creator.name?.trim() ||
		[creator.firstName, creator.lastName].filter(Boolean).join(" ").trim()
	);
}
