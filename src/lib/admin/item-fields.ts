import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import {
	ADMIN_ANNOTATION_TYPES,
	utf8ByteLength,
} from "@/lib/admin/field-contract";
import {
	canonicalItemFieldToDatabaseField,
} from "@/lib/item-field-codec";

export const LIBRARY_OWNED_PAYLOAD_FIELDS = new Set(["links", "countryFocus", "openAccess", "studyType", "licence", "topics", "sourceResolutions", "withdrawnAt", "withdrawalReason"]);

export const ADMIN_SHARED_PAYLOAD_FIELDS = new Set([
	"collections",
	"topics",
	"sourceResolutions",
	"countryFocus",
	"openAccess",
	"studyType",
	"licence",
	"creators",
	"itemType",
	"links",
	"parentItem",
	"relations",
	"tags",
]);

export const ITEM_LINK_PAYLOAD_KINDS = ["cites", "related"] as const;
export const MAX_ITEM_LINKS_PER_KIND = 500;

const PARENT_CAPABLE_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);
// Attachments, notes and annotations always belong to a record. None of
// them is a record of its own: not creatable from the New item list, and
// not listed in the public library on its own.
export const PARENT_REQUIRED_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);

export function adminSharedPayloadFieldsForZoteroItemType(definition: {
	creatorTypes: readonly unknown[];
	itemType: string;
}) {
	const fields = new Set(ADMIN_SHARED_PAYLOAD_FIELDS);
	if (!isTopLevelAdminItemType(definition.itemType)) { fields.delete("countryFocus"); fields.delete("openAccess"); fields.delete("studyType"); fields.delete("licence"); fields.delete("topics"); }
	if (definition.creatorTypes.length === 0) fields.delete("creators");
	if (!PARENT_CAPABLE_ITEM_TYPES.has(definition.itemType.toLowerCase())) {
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
			message: "Shorten Annotation Text to 7,500 characters or fewer.",
		});
	}
	if (
		typeof annotationPageLabel === "string" &&
		utf8ByteLength(annotationPageLabel) > 50
	) {
		errors.push({
			field: "annotationPageLabel",
			message: "Annotation Page Label is too long. Shorten it and try again.",
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
			message:
				"Use the annotation position supplied by the PDF, EPUB, or web-page reader.",
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
			message: "Annotation Position is too long. Shorten it and try again.",
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

export function adminSpecialFieldsForZoteroItemType(itemType: string) {
	return specialFieldsByZoteroItemType.get(itemType) ?? new Set<string>();
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
		const internalField = canonicalItemFieldToDatabaseField(semanticField);
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

/** Item types an admin may create as a record of their own. */
export function isTopLevelAdminItemType(itemType: string) {
	return !PARENT_REQUIRED_ITEM_TYPES.has(itemType.toLowerCase());
}

/**
 * Whether a record belongs in the public library as a result of its own.
 * Children never do, and a parentless attachment, note or annotation (for
 * example one imported from a source) never does either.
 */
export function isPublicTopLevelItem(record: {
	itemType: string;
	parentItem: string | null;
}) {
	return (
		record.parentItem === null &&
		!PARENT_REQUIRED_ITEM_TYPES.has(record.itemType.toLowerCase())
	);
}
