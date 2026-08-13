import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import {
	describeZoteroItemTypeFields,
	getZoteroItemType,
	getZoteroItemTypes,
	itemTypeZoteroFieldName,
	type ZoteroItemTypeDefinition,
} from "@opendeved/evidence-library-core/zotero-schema";

import {
	ADMIN_SHARED_PAYLOAD_FIELDS,
	adminSpecialFieldsForZoteroItemType,
	adminSharedPayloadFieldsForZoteroItemType,
	canonicalItemTypeToZotero,
	zoteroStructuralFieldErrors,
} from "@/lib/admin/item-fields";

const knownEditableFields = new Set([
	...ADMIN_SHARED_PAYLOAD_FIELDS,
	...[...getZoteroItemTypes().values()].flatMap((definition) => [
		...describeZoteroItemTypeFields(definition.itemType).map(
			({ semanticField }) => semanticField,
		),
		...adminSpecialFieldsForZoteroItemType(definition.itemType),
	]),
]);

export class ZoteroWritebackMappingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZoteroWritebackMappingError";
	}
}

function itemTypeDefinition(payload: Readonly<Record<string, unknown>>) {
	if (typeof payload.itemType !== "string") {
		throw new ZoteroWritebackMappingError(
			"Canonical writeback payload has no item type",
		);
	}
	const zoteroItemType = canonicalItemTypeToZotero(payload.itemType);
	const definition = getZoteroItemType(zoteroItemType);
	if (!definition) {
		throw new ZoteroWritebackMappingError(
			`Canonical writeback payload has unsupported item type: ${payload.itemType}`,
		);
	}
	return definition;
}

function allowedFields(definition: ZoteroItemTypeDefinition) {
	return new Set([
		...adminSharedPayloadFieldsForZoteroItemType(definition),
		...describeZoteroItemTypeFields(definition.itemType).map(
			({ semanticField }) => semanticField,
		),
		...adminSpecialFieldsForZoteroItemType(definition.itemType),
	]);
}

function providerField(
	definition: ZoteroItemTypeDefinition,
	canonicalField: string,
) {
	return (
		itemTypeZoteroFieldName(definition.itemType, canonicalField) ??
		canonicalField
	);
}

function creatorPayload(value: unknown, definition: ZoteroItemTypeDefinition) {
	if (!Array.isArray(value)) return [];
	const allowedCreatorTypes = new Set(
		definition.creatorTypes.map(({ creatorType }) => creatorType),
	);
	return value.map((creator) => {
		if (!creator || typeof creator !== "object" || Array.isArray(creator)) {
			throw new ZoteroWritebackMappingError(
				"Canonical writeback payload has an invalid creator",
			);
		}
		const creatorType = (creator as Record<string, unknown>).creatorType;
		if (
			typeof creatorType !== "string" ||
			!allowedCreatorTypes.has(creatorType)
		) {
			throw new ZoteroWritebackMappingError(
				`Canonical writeback payload has a creator role that is invalid for ${definition.itemType}`,
			);
		}
		return creator;
	});
}

function stringList(value: unknown, field: string) {
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new ZoteroWritebackMappingError(
			`Canonical writeback payload has invalid ${field}`,
		);
	}
	return value as string[];
}

function fieldValue(
	field: string,
	value: unknown,
	clearing: boolean,
	definition: ZoteroItemTypeDefinition,
) {
	if (field === "creators")
		return clearing ? [] : creatorPayload(value, definition);
	if (field === "tags") {
		return clearing ? [] : stringList(value, field).map((tag) => ({ tag }));
	}
	if (field === "collections") {
		return clearing ? [] : stringList(value, field);
	}
	if (field === "relations") {
		if (clearing) return {};
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new ZoteroWritebackMappingError(
				"Canonical writeback payload has invalid relations",
			);
		}
		return value;
	}
	if (field === "parentItem") {
		if (clearing) return false;
		if (typeof value !== "string" || !isCanonicalRecordKey(value)) {
			throw new ZoteroWritebackMappingError(
				"Canonical writeback payload has an invalid parent item key",
			);
		}
		return value;
	}
	if (clearing) return "";
	if (typeof value !== "string") {
		throw new ZoteroWritebackMappingError(
			`Canonical writeback payload has invalid ${field}`,
		);
	}
	return value;
}

function addAttachmentTransportFields(
	data: Record<string, unknown>,
	payload: Readonly<Record<string, unknown>>,
) {
	data.linkMode = "linked_url";
	data.contentType = "application/pdf";
	if (!("url" in data)) {
		data.url = typeof payload.url === "string" ? payload.url : "";
	}
}

function assertStructuralFields(
	payload: Readonly<Record<string, unknown>>,
	definition: ZoteroItemTypeDefinition,
) {
	const [error] = zoteroStructuralFieldErrors(payload, definition.itemType);
	if (error) {
		throw new ZoteroWritebackMappingError(error.message);
	}
}

export function createZoteroItemPayload(
	payload: Readonly<Record<string, unknown>>,
	sourceRecordKey: string,
) {
	if (!isCanonicalRecordKey(sourceRecordKey)) {
		throw new ZoteroWritebackMappingError(
			"Canonical writeback source record key is not a Zotero item key",
		);
	}
	const definition = itemTypeDefinition(payload);
	assertStructuralFields(payload, definition);
	const validFields = allowedFields(definition);
	const data: Record<string, unknown> = {
		itemType: definition.itemType,
		key: sourceRecordKey,
		tags: [],
		version: 0,
	};
	if (validFields.has("collections")) data.collections = [];
	if (validFields.has("relations")) data.relations = {};
	for (const [field, value] of Object.entries(payload)) {
		if (field === "itemType" || value === null || value === undefined)
			continue;
		if (!validFields.has(field)) {
			throw new ZoteroWritebackMappingError(
				`Canonical writeback payload field is not valid for ${definition.itemType}: ${field}`,
			);
		}
		data[providerField(definition, field)] = fieldValue(
			field,
			value,
			false,
			definition,
		);
	}
	if (definition.itemType === "attachment") {
		addAttachmentTransportFields(data, payload);
	}
	return data;
}

export function createZoteroItemPatch(
	payload: Readonly<Record<string, unknown>>,
	dirtyFields: readonly string[],
	options: { previousItemType?: string } = {},
) {
	const definition = itemTypeDefinition(payload);
	const previousDefinition = options.previousItemType
		? getZoteroItemType(options.previousItemType)
		: null;
	assertStructuralFields(payload, definition);
	const validFields = allowedFields(definition);
	const itemTypeChanging = dirtyFields.includes("itemType");
	const data: Record<string, unknown> = {};
	for (const field of [...new Set(dirtyFields)].sort()) {
		if (!knownEditableFields.has(field)) {
			throw new ZoteroWritebackMappingError(
				`Canonical writeback dirty field is not a Zotero field: ${field}`,
			);
		}
		if (field === "itemType") {
			data.itemType = definition.itemType;
			continue;
		}
		const hasValue = Object.hasOwn(payload, field);
		if (!validFields.has(field) && (!itemTypeChanging || hasValue)) {
			throw new ZoteroWritebackMappingError(
				`Canonical writeback dirty field is not valid for ${definition.itemType}: ${field}`,
			);
		}
		const targetDefinition = validFields.has(field)
			? definition
			: previousDefinition;
		if (!targetDefinition) {
			throw new ZoteroWritebackMappingError(
				`Previous Zotero item type is required to clear ${field}`,
			);
		}
		data[providerField(targetDefinition, field)] = fieldValue(
			field,
			payload[field],
			!hasValue,
			definition,
		);
	}
	if (data.itemType === "attachment") {
		addAttachmentTransportFields(data, payload);
	}
	return data;
}
