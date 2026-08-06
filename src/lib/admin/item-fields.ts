import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";

export const ADMIN_SHARED_PAYLOAD_FIELDS = new Set([
	"collections",
	"creators",
	"itemType",
	"parentItem",
	"relations",
	"tags",
]);

const CHILD_ONLY_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);

export function adminSharedPayloadFieldsForZoteroItemType(definition: {
	creatorTypes: readonly unknown[];
	itemType: string;
}) {
	const fields = new Set(ADMIN_SHARED_PAYLOAD_FIELDS);
	if (definition.creatorTypes.length === 0) fields.delete("creators");
	if (!CHILD_ONLY_ITEM_TYPES.has(definition.itemType.toLowerCase())) {
		fields.delete("parentItem");
	}
	return fields;
}

const ZOTERO_ANNOTATION_TYPES = new Set(["highlight", "image", "ink", "note"]);

export type ZoteroStructuralFieldError = {
	field: string;
	message: string;
};

export function zoteroStructuralFieldErrors(
	payload: Readonly<Record<string, unknown>>,
	itemType: string,
	options: { requireAttachmentParent?: boolean } = {},
): ZoteroStructuralFieldError[] {
	const normalizedItemType = itemType.toLowerCase();
	const errors: ZoteroStructuralFieldError[] = [];
	if (
		(normalizedItemType === "annotation" ||
			(normalizedItemType === "attachment" &&
				(options.requireAttachmentParent ?? true))) &&
		(typeof payload.parentItem !== "string" ||
			!isCanonicalRecordKey(payload.parentItem))
	) {
		errors.push({
			field: "parentItem",
			message: `Choose the record this ${normalizedItemType} belongs to.`,
		});
	}
	if (normalizedItemType !== "annotation") return errors;

	if (
		typeof payload.annotationType !== "string" ||
		!ZOTERO_ANNOTATION_TYPES.has(payload.annotationType)
	) {
		errors.push({
			field: "annotationType",
			message: "Choose a valid annotation type.",
		});
	}

	if (typeof payload.annotationPosition !== "string") {
		errors.push({
			field: "annotationPosition",
			message: "Enter a valid annotation position.",
		});
		return errors;
	}
	try {
		const position = JSON.parse(payload.annotationPosition) as unknown;
		if (
			!position ||
			typeof position !== "object" ||
			Array.isArray(position)
		) {
			throw new TypeError("Annotation position must be an object");
		}
	} catch {
		errors.push({
			field: "annotationPosition",
			message: "Enter a valid annotation position.",
		});
	}
	return errors;
}

const specialFieldsByZoteroItemType = new Map<string, ReadonlySet<string>>([
	["note", new Set(["note"])],
	["attachment", new Set(["note"])],
	[
		"annotation",
		new Set([
			"annotationType",
			"annotationAuthorName",
			"annotationText",
			"annotationComment",
			"annotationColor",
			"annotationPageLabel",
			"annotationSortIndex",
			"annotationPosition",
		]),
	],
]);

export function canonicalItemTypeToZotero(itemType: string) {
	return itemType.length === 0
		? ""
		: itemType[0]!.toLowerCase() + itemType.slice(1);
}

export function adminSpecialFieldsForZoteroItemType(itemType: string) {
	return specialFieldsByZoteroItemType.get(itemType) ?? new Set<string>();
}

export function adminPayloadFieldToDatabaseField(field: string) {
	return field === "language" ? "languageName" : field;
}

export function adminDatabaseFieldToPayloadField(field: string) {
	return field === "languageName" ? "language" : field;
}

export function isTopLevelAdminItemType(itemType: string) {
	return !CHILD_ONLY_ITEM_TYPES.has(itemType.toLowerCase());
}
