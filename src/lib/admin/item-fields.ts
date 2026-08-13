import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import {
	ADMIN_ANNOTATION_TYPES,
	utf8ByteLength,
} from "@/lib/admin/field-contract";

export const ADMIN_SHARED_PAYLOAD_FIELDS = new Set([
	"collections",
	"creators",
	"itemType",
	"parentItem",
	"relations",
	"tags",
]);

const CHILD_ONLY_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);
const PARENT_REQUIRED_ITEM_TYPES = new Set(["annotation", "attachment"]);

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

const ZOTERO_ANNOTATION_TYPES = new Set<string>(ADMIN_ANNOTATION_TYPES);

export type ZoteroStructuralFieldError = {
	field: string;
	message: string;
};

export function zoteroStructuralFieldErrors(
	payload: Readonly<Record<string, unknown>>,
	itemType: string,
	options: { requireChildParent?: boolean } = {},
): ZoteroStructuralFieldError[] {
	const normalizedItemType = itemType.toLowerCase();
	const errors: ZoteroStructuralFieldError[] = [];
	if (
		(PARENT_REQUIRED_ITEM_TYPES.has(normalizedItemType) &&
			(options.requireChildParent ?? true)) &&
		(typeof payload.parentItem !== "string" ||
			!isCanonicalRecordKey(payload.parentItem))
	) {
		errors.push({
			field: "parentItem",
			message: `Choose the record this ${normalizedItemType} belongs to.`,
		});
	}
	if (normalizedItemType !== "annotation") return errors;
	const annotationText = payload.annotationText;
	const annotationPageLabel = payload.annotationPageLabel;
	const annotationSortIndex = payload.annotationSortIndex;
	const annotationPosition = payload.annotationPosition;

	if (
		typeof payload.annotationType !== "string" ||
		!ZOTERO_ANNOTATION_TYPES.has(payload.annotationType)
	) {
		errors.push({
			field: "annotationType",
			message: "Choose a valid annotation type.",
		});
	}
	if (
		typeof annotationText === "string" &&
		annotationText.length > 0 &&
		payload.annotationType !== "highlight" &&
		payload.annotationType !== "underline"
	) {
		errors.push({
			field: "annotationText",
			message:
				"Annotation Text is available only for highlights and underlines.",
		});
	}
	if (typeof annotationText === "string" && [...annotationText].length > 7_500) {
		errors.push({
			field: "annotationText",
			message: "Annotation Text must be 7,500 characters or less.",
		});
	}
	if (
		typeof annotationPageLabel === "string" &&
		utf8ByteLength(annotationPageLabel) > 50
	) {
		errors.push({
			field: "annotationPageLabel",
			message: "Annotation Page Label must be 50 bytes or less.",
		});
	}
	if (
		typeof annotationSortIndex === "string" &&
		annotationSortIndex.length > 0 &&
		!/^\d{5}\|\d{6}\|\d{5}$|^\d{5}\|\d{8}$|^\d{7,8}$/u.test(
			annotationSortIndex,
		)
	) {
		errors.push({
			field: "annotationSortIndex",
			message: "Enter a valid annotation sort position.",
		});
	}

	if (typeof annotationPosition !== "string") {
		errors.push({
			field: "annotationPosition",
			message: "Enter a valid annotation position.",
		});
		return errors;
	}
	if (utf8ByteLength(annotationPosition) > 65_535) {
		errors.push({
			field: "annotationPosition",
			message: "Annotation Position must be 65,535 bytes or less.",
		});
		return errors;
	}
	try {
		const position = JSON.parse(annotationPosition) as unknown;
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

export function adminCanonicalFieldToDatabaseField(field: string) {
	return field === "language" ? "languageName" : field;
}

export function adminDatabaseFieldToPayloadField(field: string) {
	return field === "languageName" ? "language" : field;
}

export function adminCanonicalPayloadToItemFields(
	payload: Readonly<Record<string, unknown>>,
	itemType: string,
) {
	const zoteroItemType = itemType[0]!.toLowerCase() + itemType.slice(1);
	const output = { ...payload };
	for (const { field, semanticField } of describeZoteroItemTypeFields(
		zoteroItemType,
	)) {
		const internalField = adminCanonicalFieldToDatabaseField(semanticField);
		if (!Object.hasOwn(payload, internalField)) continue;
		if (field !== internalField) delete output[internalField];
		output[field] = payload[internalField];
	}
	return output;
}

export function adminCanonicalDraftToItemFields<
	T extends { payload: Record<string, unknown> },
>(draft: T): T {
	return {
		...draft,
		payload: adminCanonicalPayloadToItemFields(
			draft.payload,
			String(draft.payload.itemType ?? ""),
		),
	};
}

export function isTopLevelAdminItemType(itemType: string) {
	return !CHILD_ONLY_ITEM_TYPES.has(itemType.toLowerCase());
}
