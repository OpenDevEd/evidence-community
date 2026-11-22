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
	LIBRARY_OWNED_PAYLOAD_FIELDS,
	adminSpecialFieldsForZoteroItemType,
	adminSharedPayloadFieldsForZoteroItemType,
	zoteroStructuralFieldErrors,
} from "@/lib/admin/item-fields";
import {
	canonicalItemTypeToZotero,
	databaseItemFieldToPayloadField,
} from "@/lib/item-field-codec";

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
		// Zotero creators hold a name and a role. The rest is library-owned.
		const {
			authorProfileId: _authorProfileId,
			institutions: _institutions,
			organization: _organization,
			...bibliographicCreator
		} = creator as Record<string, unknown>;
		return bibliographicCreator;
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

const zoteroRelationPredicates = new Set([
	"dc:relation",
	"dc:replaces",
	"mendeleyDB:annotationUUID",
	"mendeleyDB:documentUUID",
	"mendeleyDB:fileHash",
	"mendeleyDB:notebookUUID",
	"mendeleyDB:relatedDocumentUUID",
	"mendeleyDB:relatedFileHash",
	"mendeleyDB:relatedRemoteDocumentUUID",
	"mendeleyDB:remoteDocumentUUID",
	"owl:sameAs",
]);

function zoteroRelations(value: object) {
	return Object.fromEntries(
		Object.entries(value).filter(([predicate]) =>
			zoteroRelationPredicates.has(predicate),
		),
	);
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
		return zoteroRelations(value);
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
	if (
		payload.parentItem &&
		Array.isArray(payload.collections) &&
		payload.collections.length > 0
	) {
		throw new ZoteroWritebackMappingError(
			"Remove collections from this child record. It inherits them from its parent.",
		);
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
	for (const [databaseField, value] of Object.entries(payload)) {
		const field = databaseItemFieldToPayloadField(databaseField);
		if (field === "itemType" || value === null || value === undefined)
			continue;
		// Library-owned fields are never sent to Zotero.
		if (LIBRARY_OWNED_PAYLOAD_FIELDS.has(field)) continue;
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
	const previousValidFields = previousDefinition
		? allowedFields(previousDefinition)
		: null;
	const itemTypeChanging = dirtyFields.includes("itemType");
	const data: Record<string, unknown> = {};
	for (const databaseField of [...new Set(dirtyFields)].sort()) {
		const field = databaseItemFieldToPayloadField(databaseField);
		if (LIBRARY_OWNED_PAYLOAD_FIELDS.has(field)) continue;
		if (!knownEditableFields.has(field)) {
			throw new ZoteroWritebackMappingError(
				`Canonical writeback dirty field is not a Zotero field: ${databaseField}`,
			);
		}
		if (field === "itemType") {
			data.itemType = definition.itemType;
			continue;
		}
		const hasValue = Object.hasOwn(payload, databaseField);
		const value = payload[databaseField];
		const empty = value === null || value === undefined || value === "";
		if (!validFields.has(field)) {
			// A field the new item type does not have. When the type is
			// changing and the old type had it, Zotero must see it cleared.
			if (
				itemTypeChanging &&
				previousDefinition &&
				previousValidFields?.has(field)
			) {
				if (hasValue && !empty) {
					throw new ZoteroWritebackMappingError(
						`Canonical writeback dirty field is not valid for ${definition.itemType}: ${field}`,
					);
				}
				data[providerField(previousDefinition, field)] = fieldValue(
					field,
					payload[databaseField],
					true,
					definition,
				);
				continue;
			}
			// Holding nothing locally, there is nothing to send: skip it. A
			// whole-record send or a restore names every field, including
			// fields that belong to other item types.
			if (empty) continue;
			throw new ZoteroWritebackMappingError(
				`Canonical writeback dirty field is not valid for ${definition.itemType}: ${field}`,
			);
		}
		data[providerField(definition, field)] = fieldValue(
			field,
			payload[databaseField],
			!hasValue,
			definition,
		);
	}
	if (data.itemType === "attachment") {
		addAttachmentTransportFields(data, payload);
	}
	return data;
}
