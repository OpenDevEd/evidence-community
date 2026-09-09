import {
	describeZoteroItemTypeFields,
	getZoteroItemType,
	type ZoteroItemTypeDefinition,
} from "@opendeved/evidence-library-core/zotero-schema";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

import { creatorType } from "@/db/schema/enums/creatorType";
import { itemType } from "@/db/schema/enums/itemType";
import type { item } from "@/db/schema/tables/item";
import {
	adminSharedPayloadFieldsForZoteroItemType,
	adminSpecialFieldsForZoteroItemType,
	isTopLevelAdminItemType,
	ITEM_LINK_PAYLOAD_KINDS,
	MAX_ITEM_LINKS_PER_KIND,
	zoteroStructuralFieldErrors,
} from "@/lib/admin/item-fields";
import {
	canonicalItemFieldToDatabaseField,
	canonicalItemTypeToZotero,
} from "@/lib/item-field-codec";
import {
	adminFieldLabel,
	AdminValidationError,
	type AdminFieldErrors,
	fieldErrorsFromZod,
} from "@/lib/admin/errors";
import type { InferInsertModel } from "drizzle-orm";
import {
	normalizeAdminFieldValue,
	utf8ByteLength,
} from "@/lib/admin/field-contract";

const itemTypeByZoteroName = new Map(
	itemType.enumValues.map((value) => [value.toLowerCase(), value]),
);
const creatorTypes = new Set<string>(creatorType.enumValues);

function creatorSchema(allowIncomplete: boolean) {
	return z
		.object({
			creatorType: z.string().min(1),
			authorProfileId: z.string().trim().min(1).max(128).optional(),
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			name: z.string().optional(),
		})
		.strict()
		.superRefine((creator, context) => {
			if (!creatorTypes.has(creator.creatorType)) {
				context.addIssue({
					code: "custom",
					message: "Choose a valid creator role.",
					path: ["creatorType"],
				});
			}

			const hasSingleName = Boolean(creator.name?.trim());
			const hasSplitName =
				Boolean(creator.firstName?.trim()) ||
				Boolean(creator.lastName?.trim());
			if (allowIncomplete && !hasSingleName && !hasSplitName) return;
			if (!hasSingleName && !hasSplitName) {
				context.addIssue({
					code: "custom",
					message:
						"Enter a name for this creator, or remove the empty creator.",
				});
				return;
			}
			if (hasSingleName === hasSplitName) {
				context.addIssue({
					code: "custom",
					message:
						"Use either a person name or an organisation name, not both.",
				});
			}
		});
}

const payloadObjectSchema = z.record(z.string(), z.unknown());
const stringOrStringsSchema = z.union([z.string(), z.array(z.string())]);
const zoteroItemUriSchema = z
	.string()
	.regex(
		/^http:\/\/zotero\.org\/(?:users|groups)\/\d+\/(?:publications\/)?items\/[A-Z0-9]{8}$/u,
		"Use a Zotero item address.",
	);
const zoteroItemUriOrUrisSchema = z.union([
	zoteroItemUriSchema,
	z.array(zoteroItemUriSchema),
]);
const relationsObjectSchema = z
	.object({
		"dc:relation": zoteroItemUriOrUrisSchema.optional(),
		"dc:replaces": zoteroItemUriOrUrisSchema.optional(),
		"owl:sameAs": zoteroItemUriOrUrisSchema.optional(),
		"mendeleyDB:annotationUUID": stringOrStringsSchema.optional(),
		"mendeleyDB:documentUUID": stringOrStringsSchema.optional(),
		"mendeleyDB:fileHash": stringOrStringsSchema.optional(),
		"mendeleyDB:notebookUUID": stringOrStringsSchema.optional(),
		"mendeleyDB:relatedDocumentUUID": stringOrStringsSchema.optional(),
		"mendeleyDB:relatedFileHash": stringOrStringsSchema.optional(),
		"mendeleyDB:relatedRemoteDocumentUUID":
			stringOrStringsSchema.optional(),
		"mendeleyDB:remoteDocumentUUID": stringOrStringsSchema.optional(),
		related_works: stringOrStringsSchema.optional(),
	});
const relationsSchema = relationsObjectSchema.strict();
// External sources may carry relation types the editor does not know. Keep
// them so writeback returns them unchanged.
const sourceRelationsSchema = relationsObjectSchema.passthrough();

/**
 * Validation policy for records copied from an external source such as
 * Zotero. The source owns the data: unknown fields are dropped instead of
 * rejected, dates and addresses the editor cannot parse are kept as text, and a
 * title is not required.
 */
export const sourceRecordValidationOptions = {
	requireChildParent: false,
	requireTitle: false,
	source: true,
} as const;

type ItemWrite = InferInsertModel<typeof item>;

export class NativeItemValidationError extends AdminValidationError {
	constructor(message: string, fields: AdminFieldErrors = {}) {
		super(message, fields);
		this.name = "NativeItemValidationError";
	}
}

export type ValidatedItemLinks = { cites: string[]; related: string[] };

export type ValidatedNativeItemDraft = {
	collectionKeys: string[];
	links: ValidatedItemLinks;
	item: Omit<
		ItemWrite,
		| "createdAt"
		| "deleted"
		| "deletedAt"
		| "key"
		| "revision"
		| "sourceConnectionKey"
		| "sourceRecordKey"
		| "updatedAt"
		| "itemType"
	> & {
		itemType: NonNullable<ItemWrite["itemType"]>;
	};
	payload: Record<string, unknown>;
	tags: string[];
};

function normalizeItemType(value: unknown) {
	if (typeof value !== "string") {
		throw new NativeItemValidationError("Choose an item type.", {
			itemType: "Choose an item type.",
		});
	}

	const normalized = itemTypeByZoteroName.get(value.toLowerCase());
	if (!normalized) {
		throw new NativeItemValidationError("Choose a supported item type.", {
			itemType: "Choose a supported item type.",
		});
	}
	return normalized;
}

function zoteroDefinitionFor(itemTypeValue: string): ZoteroItemTypeDefinition {
	const zoteroName = canonicalItemTypeToZotero(itemTypeValue);
	const definition = getZoteroItemType(zoteroName);
	if (!definition) {
		throw new Error(
			`Vendored Zotero schema is missing item type: ${zoteroName}`,
		);
	}
	return definition;
}

function parseItemLinks(value: unknown): ValidatedItemLinks {
	if (value === undefined) return { cites: [], related: [] };
	const invalid = () =>
		new NativeItemValidationError("Choose valid linked records.", {
			links: "One or more linked records are invalid.",
		});
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw invalid();
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!(ITEM_LINK_PAYLOAD_KINDS as readonly string[]).includes(key)) {
			throw invalid();
		}
	}
	const parsed = { cites: [] as string[], related: [] as string[] };
	for (const kind of ITEM_LINK_PAYLOAD_KINDS) {
		const keys = parseUniqueStrings(record[kind], `links.${kind}`, 64);
		if (
			keys.length > MAX_ITEM_LINKS_PER_KIND ||
			keys.some((key) => !isCanonicalRecordKey(key))
		) {
			throw invalid();
		}
		parsed[kind] = keys;
	}
	return parsed;
}

function parseUniqueStrings(value: unknown, field: string, maxLength: number) {
	if (value === undefined) return [];
	const result = z.array(z.string()).safeParse(value);
	if (!result.success) {
		throw new NativeItemValidationError(
			`Check the ${adminFieldLabel(field).toLowerCase()} and try again.`,
			fieldErrorsFromZod(result.error, [field]),
		);
	}
	const values = result.data;
	const normalized = values.map((entry) => entry.trim());
	const invalidIndex = normalized.findIndex(
		(entry) => !entry || entry.length > maxLength,
	);
	if (invalidIndex >= 0) {
		throw new NativeItemValidationError(
			`Check the ${adminFieldLabel(field).toLowerCase()} and try again.`,
			{
				[`${field}.${invalidIndex}`]: `${adminFieldLabel(field)} must contain 1-${maxLength} characters.`,
			},
		);
	}
	if (new Set(normalized).size !== normalized.length) {
		throw new NativeItemValidationError(
			`Remove the duplicate ${adminFieldLabel(field).toLowerCase()}.`,
			{
				[field]: `${adminFieldLabel(field)} cannot contain duplicates.`,
			},
		);
	}
	return normalized.sort();
}

export function validateNativeItemDraft(
	input: unknown,
	options: {
		allowIncompleteCreators?: boolean;
		requireChildParent?: boolean;
		requireTitle?: boolean;
		/** Apply the external-source policy; see `sourceRecordValidationOptions`. */
		source?: boolean;
	} = {},
): ValidatedNativeItemDraft {
	const payloadResult = payloadObjectSchema.safeParse(input);
	if (!payloadResult.success) {
		throw new NativeItemValidationError(
			"Check the record details and try again.",
			fieldErrorsFromZod(payloadResult.error),
		);
	}
	const payload = payloadResult.data;
	const normalizedItemType = normalizeItemType(payload.itemType);
	const definition = zoteroDefinitionFor(normalizedItemType);
	const fieldDescriptors = describeZoteroItemTypeFields(definition.itemType);
	const allowedFields = new Set([
		...adminSharedPayloadFieldsForZoteroItemType(definition),
		...fieldDescriptors.flatMap(({ field, semanticField }) => {
			const databaseField =
				canonicalItemFieldToDatabaseField(semanticField);
			return [field, semanticField, databaseField];
		}),
		...adminSpecialFieldsForZoteroItemType(definition.itemType),
	]);

	for (const field of Object.keys(payload)) {
		if (!allowedFields.has(field)) {
			if (options.source) {
				delete payload[field];
				continue;
			}
			throw new NativeItemValidationError(
				"Remove fields that are not available for this item type.",
				{
					[field]: `${adminFieldLabel(field)} is not available for ${adminFieldLabel(definition.itemType)}.`,
				},
			);
		}
	}

	const itemValues: Record<string, unknown> = {
		itemType: normalizedItemType,
	};
	const normalizedPayload: Record<string, unknown> = {
		itemType: normalizedItemType,
	};
	for (const descriptor of fieldDescriptors) {
		const { field, semanticField } = descriptor;
		const databaseField = canonicalItemFieldToDatabaseField(semanticField);
		const hasItemField = Object.hasOwn(payload, field);
		const alternativeNames = [
			...new Set([semanticField, databaseField]),
		].filter((name) => name !== field);
		if (
			hasItemField &&
			alternativeNames.some((name) => Object.hasOwn(payload, name))
		) {
			throw new NativeItemValidationError(
				`Use only one name for ${adminFieldLabel(field)}.`,
				{
					[field]: `Use only one name for ${adminFieldLabel(field)}.`,
				},
			);
		}
		const value = hasItemField
			? payload[field]
			: (payload[databaseField] ?? payload[semanticField]);
		if (value === undefined) continue;
		if (value !== null && typeof value !== "string") {
			throw new NativeItemValidationError(
				`Check ${adminFieldLabel(field).toLowerCase()} and try again.`,
				{ [field]: `${adminFieldLabel(field)} must be text.` },
			);
		}
		if (typeof value === "string") {
			const normalized = normalizeAdminFieldValue(descriptor, value, {
				keepUnparsed: options.source,
			});
			if (normalized.error) {
				throw new NativeItemValidationError(
					`Check ${adminFieldLabel(field).toLowerCase()} and try again.`,
					{ [field]: normalized.error },
				);
			}
			itemValues[databaseField] = normalized.value;
			normalizedPayload[databaseField] = normalized.value;
		} else {
			itemValues[databaseField] = value;
			normalizedPayload[databaseField] = value;
		}
	}

	for (const field of adminSpecialFieldsForZoteroItemType(
		definition.itemType,
	)) {
		const value = payload[field];
		if (value === undefined) continue;
		if (value !== null && typeof value !== "string") {
			throw new NativeItemValidationError(
				`Check ${adminFieldLabel(field).toLowerCase()} and try again.`,
				{ [field]: `${adminFieldLabel(field)} must be text.` },
			);
		}
		if (typeof value === "string") {
			const normalized = normalizeAdminFieldValue(
				{ field, semanticField: field, type: "text" },
				value,
			);
			if (normalized.error) {
				throw new NativeItemValidationError(
					`Check ${adminFieldLabel(field).toLowerCase()} and try again.`,
					{ [field]: normalized.error },
				);
			}
			itemValues[field] = normalized.value;
			normalizedPayload[field] = normalized.value;
		} else {
			itemValues[field] = value;
			normalizedPayload[field] = value;
		}
	}

	if (payload.creators !== undefined) {
		const creatorResult = z
			.array(creatorSchema(options.allowIncompleteCreators ?? false))
			.safeParse(payload.creators);
		if (!creatorResult.success) {
			throw new NativeItemValidationError(
				"Check the creator details and try again.",
				fieldErrorsFromZod(creatorResult.error, ["creators"]),
			);
		}
		const creators = creatorResult.data;
		const allowedCreatorTypes = new Set(
			definition.creatorTypes.map(({ creatorType }) => creatorType),
		);
		for (const [index, creator] of creators.entries()) {
			if (!allowedCreatorTypes.has(creator.creatorType)) {
				throw new NativeItemValidationError(
					"Choose a valid creator role.",
					{
						[`creators.${index}.creatorType`]:
							"This creator role is not available for the selected item type.",
					},
				);
			}
		}
		itemValues.creators = creators;
		normalizedPayload.creators = creators;
	}

	if (payload.relations !== undefined) {
		const relationResult = (
			options.source ? sourceRelationsSchema : relationsSchema
		).safeParse(payload.relations);
		if (!relationResult.success) {
			throw new NativeItemValidationError(
				"Check the record relationships and try again.",
				fieldErrorsFromZod(relationResult.error, ["relations"]),
			);
		}
		const relations = relationResult.data;
		itemValues.relations = relations;
		normalizedPayload.relations = relations;
	}

	if (payload.parentItem !== undefined) {
		const parentResult = z
			.string()
			.refine(isCanonicalRecordKey, {
				message: "Choose a valid parent record.",
			})
			.nullable()
			.safeParse(payload.parentItem);
		if (!parentResult.success) {
			throw new NativeItemValidationError(
				"Choose a valid parent record.",
				fieldErrorsFromZod(parentResult.error, ["parentItem"]),
			);
		}
		const parentItem = parentResult.data;
		itemValues.parentItem = parentItem;
		normalizedPayload.parentItem = parentItem;
	}
	const structuralErrors = zoteroStructuralFieldErrors(
		normalizedPayload,
		definition.itemType,
		{
			requireChildParent: options.requireChildParent,
		},
	);
	if (structuralErrors.length > 0) {
		throw new NativeItemValidationError(
			"Complete the required record details and try again.",
			Object.fromEntries(
				structuralErrors.map(({ field, message }) => [field, message]),
			),
		);
	}
	const titleDescriptor = fieldDescriptors.find(
		({ semanticField }) => semanticField === "title",
	);
	if (
		options.requireTitle &&
		titleDescriptor &&
		(typeof normalizedPayload.title !== "string" ||
			normalizedPayload.title.trim().length === 0)
	) {
		throw new NativeItemValidationError(
			"Enter a title before publishing.",
			{ [titleDescriptor.field]: "Enter a title before publishing." },
		);
	}

	const collectionKeys = parseUniqueStrings(
		payload.collections,
		"collections",
		8,
	);
	if (collectionKeys.some((key) => !isCanonicalRecordKey(key))) {
		throw new NativeItemValidationError("Choose valid collections.", {
			collections: "One or more selected collections are invalid.",
		});
	}
	if (normalizedPayload.parentItem && collectionKeys.length > 0) {
		throw new NativeItemValidationError(
			"Child records inherit collections from their parent.",
			{
				collections:
					"Child records inherit collections from their parent. Remove the direct collection.",
			},
		);
	}
	const tags = parseUniqueStrings(payload.tags, "tags", 255);
	const links = parseItemLinks(payload.links);
	normalizedPayload.collections = collectionKeys;
	normalizedPayload.tags = tags;
	if (payload.links !== undefined) normalizedPayload.links = links;

	return {
		collectionKeys,
		item: itemValues as ValidatedNativeItemDraft["item"],
		links,
		payload: normalizedPayload,
		tags,
	};
}
