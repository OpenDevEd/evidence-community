import { fileAccessSchema, recordLicenceSchema } from "@/lib/licences";
import { STUDY_TYPE_KEYS } from "@/lib/readings/study-types";
import {
	describeZoteroItemTypeFields,
	getZoteroItemType,
	type ZoteroItemTypeDefinition,
} from "@opendeved/evidence-library-core/zotero-schema";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";
import { topicIdSchema } from "@/lib/topics/contract";
import { sourceResolutionsSchema } from "./source-field-contract";
import { countryFocusSchema } from "@/lib/country-focus";

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
export const MAX_CREATOR_INSTITUTIONS = 50;
export const MAX_CREATOR_INSTITUTION_NAME_LENGTH = 500;

function creatorSchema(allowIncomplete: boolean) {
	return z
		.object({
			creatorType: z.string().min(1),
			authorProfileId: z.string().trim().min(1).max(128).optional(),
			// The country lives in institutionCountry. Anything else an
			// imported affiliation carries is dropped.
			institutions: z
				.array(
					z.object({ display_name: z.string().trim().min(1).max(MAX_CREATOR_INSTITUTION_NAME_LENGTH) }),
				)
				.max(MAX_CREATOR_INSTITUTIONS)
				.optional(),
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			name: z.string().optional(),
			organization: z.literal(true).optional(),
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
const relationsObjectSchema = z.object({
	"dc:relation": zoteroItemUriOrUrisSchema.optional(),
	"dc:replaces": zoteroItemUriOrUrisSchema.optional(),
	"owl:sameAs": zoteroItemUriOrUrisSchema.optional(),
	"mendeleyDB:annotationUUID": stringOrStringsSchema.optional(),
	"mendeleyDB:documentUUID": stringOrStringsSchema.optional(),
	"mendeleyDB:fileHash": stringOrStringsSchema.optional(),
	"mendeleyDB:notebookUUID": stringOrStringsSchema.optional(),
	"mendeleyDB:relatedDocumentUUID": stringOrStringsSchema.optional(),
	"mendeleyDB:relatedFileHash": stringOrStringsSchema.optional(),
	"mendeleyDB:relatedRemoteDocumentUUID": stringOrStringsSchema.optional(),
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

type NativeItemValidationOptions = {
	allowIncompleteCreators?: boolean;
	requireChildParent?: boolean;
	requireTitle?: boolean;
	/** Apply the external-source policy; see sourceRecordValidationOptions. */
	source?: boolean;
};

export function inspectNativeItemDraft(
	input: unknown,
	options: NativeItemValidationOptions = {},
) {
	const fields: AdminFieldErrors = {};
	try {
		return {
			value: parseNativeItemDraft(input, options, fields),
			fields,
			message: "Check the record details and try again.",
		};
	} catch (error) {
		if (!(error instanceof AdminValidationError)) throw error;
		Object.assign(fields, error.fields);
		if (!Object.keys(fields).length) fields._form = error.message;
		return { value: null, fields, message: error.message };
	}
}

export function validateNativeItemDraft(
	input: unknown,
	options: NativeItemValidationOptions = {},
): ValidatedNativeItemDraft {
	const result = inspectNativeItemDraft(input, options);
	if (!result.value || Object.keys(result.fields).length)
		throw new NativeItemValidationError(result.message, result.fields);
	return result.value;
}

function countryFocusFields(value: unknown, source: boolean | undefined) {
	if (source || value == null) return {};
	const result = countryFocusSchema.safeParse(value);
	if (!result.success) throw new NativeItemValidationError("Choose valid countries for this item.", { countryFocus: "Choose countries from the list." });
	return { countryFocus: result.data };
}

/** An editor corrects a record's study type, or leaves it to the reading with null. Source imports never send it. */
function studyTypeFields(value: unknown, source: boolean | undefined) {
	if (source || value === undefined) return {};
	const result = z.enum(STUDY_TYPE_KEYS).nullable().safeParse(value);
	if (!result.success) throw new NativeItemValidationError("Choose a study type.", { studyType: "Choose one of the study types, or leave it to the reading." });
	return { studyType: result.data };
}

/** An editor marks a record open or closed, or leaves it to OpenAlex with null. Source imports never send it. */
function openAccessFields(value: unknown, source: boolean | undefined) {
	if (source || value === undefined) return {};
	const result = z.boolean().nullable().safeParse(value);
	if (!result.success) throw new NativeItemValidationError("Choose whether this item is open access.", { openAccess: "Choose open, closed or OpenAlex." });
	return { openAccess: result.data };
}

/** A record's licence, or none with null. A licence outside Zenodo's list may be saved half written; its DOI waits for it. */
function licenceFields(value: unknown, source: boolean | undefined) {
	if (source || value === undefined) return {};
	const result = recordLicenceSchema.nullable().safeParse(value);
	if (!result.success) throw new NativeItemValidationError("Choose a licence.", { licence: "Choose one of Zenodo's licences, or give another licence's name and link." });
	return { licence: result.data };
}

/** Who may get the record's files, or the licence's own with null. Whether the licence allows it is said at publishing. */
function fileAccessFields(value: unknown, source: boolean | undefined) {
	if (source || value === undefined) return {};
	const result = fileAccessSchema.nullable().safeParse(value);
	if (!result.success) throw new NativeItemValidationError("Choose who gets the file.", { fileAccess: "Choose who gets the file, and a day that exists for an embargo." });
	return { fileAccess: result.data };
}

function topicFields(value: unknown) {
	if (value === undefined) return {};
	return { topics: [...new Set(z.array(topicIdSchema).max(100).parse(value))].sort() };
}

/** Editors resolve source conflicts; source imports never send resolutions. */
function sourceResolutionFields(value: unknown, source: boolean | undefined) {
	if (source || value === undefined) return {};
	return { sourceResolutions: sourceResolutionsSchema.parse(value) };
}

function parseNativeItemDraft(
	input: unknown,
	options: NativeItemValidationOptions,
	fields: AdminFieldErrors,
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
	validateAllowedDraftFields(payload, definition, options);

	const itemValues: Record<string, unknown> = {
		itemType: normalizedItemType,
		...countryFocusFields(payload.countryFocus, options.source),
		...openAccessFields(payload.openAccess, options.source),
		...studyTypeFields(payload.studyType, options.source),
		...licenceFields(payload.licence, options.source),
		...fileAccessFields(payload.fileAccess, options.source),
		...topicFields(payload.topics),
		...normalizeDraftFields(
			payload,
			[
				...fieldDescriptors,
				...[
					...adminSpecialFieldsForZoteroItemType(definition.itemType),
				].map((field) => ({
					field,
					semanticField: field,
					type: "text" as const,
				})),
			],
			options,
			fields,
		),
	};
	const normalizedPayload = { ...itemValues };
	Object.assign(normalizedPayload, sourceResolutionFields(payload.sourceResolutions, options.source));

	if (payload.creators !== undefined) {
		const creators = parseDraftCreators(
			payload.creators,
			definition,
			options,
		);
		itemValues.creators = creators;
		normalizedPayload.creators = creators;
	}

	const relationships = parseDraftRelationships(payload, options);
	Object.assign(itemValues, relationships);
	Object.assign(normalizedPayload, relationships);
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
		fields[titleDescriptor.field] = "Enter a title before publishing.";
	}

	const collectionKeys = parseDraftCollections(
		payload.collections,
		Boolean(normalizedPayload.parentItem),
	);
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

function draftFieldValue(
	payload: Record<string, unknown>,
	field: string,
	semanticField: string,
) {
	const databaseField = canonicalItemFieldToDatabaseField(semanticField);
	const alternatives = [...new Set([semanticField, databaseField])].filter(
		(name) => name !== field,
	);
	if (
		Object.hasOwn(payload, field) &&
		alternatives.some((name) => Object.hasOwn(payload, name))
	) {
		throw new NativeItemValidationError(
			`Use only one name for ${adminFieldLabel(field)}.`,
			{ [field]: `Use only one name for ${adminFieldLabel(field)}.` },
		);
	}
	return Object.hasOwn(payload, field)
		? payload[field]
		: (payload[databaseField] ?? payload[semanticField]);
}

function normalizeDraftFields(
	payload: Record<string, unknown>,
	descriptors: Parameters<typeof normalizeAdminFieldValue>[0][],
	options: NativeItemValidationOptions,
	fields: AdminFieldErrors,
) {
	const result: Record<string, unknown> = {};
	for (const descriptor of descriptors) {
		const value = draftFieldValue(
			payload,
			descriptor.field,
			descriptor.semanticField,
		);
		if (value === undefined) continue;
		const databaseField = canonicalItemFieldToDatabaseField(
			descriptor.semanticField,
		);
		if (value === null) {
			result[databaseField] = null;
			continue;
		}
		if (typeof value !== "string")
			throw new NativeItemValidationError(
				`Check ${adminFieldLabel(descriptor.field).toLowerCase()} and try again.`,
				{
					[descriptor.field]: `${adminFieldLabel(descriptor.field)} must be text.`,
				},
			);
		const normalized = normalizeAdminFieldValue(descriptor, value, {
			keepUnparsed: options.source,
		});
		if (normalized.error) fields[descriptor.field] = normalized.error;
		result[databaseField] = normalized.value;
	}
	return result;
}

// Built once: an import validates every record's creators.
const creatorsSchema = z.array(creatorSchema(false));
const incompleteCreatorsSchema = z.array(creatorSchema(true));

function parseDraftCreators(
	value: unknown,
	definition: ReturnType<typeof zoteroDefinitionFor>,
	options: NativeItemValidationOptions,
) {
	const creatorResult = (
		options.allowIncompleteCreators ? incompleteCreatorsSchema : creatorsSchema
	).safeParse(value);
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
	return creators;
}

function validateAllowedDraftFields(
	payload: Record<string, unknown>,
	definition: ReturnType<typeof zoteroDefinitionFor>,
	options: NativeItemValidationOptions,
) {
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

	// A client patch can carry an undefined value; JSON never sends one, so treat it as absent.
	for (const field of Object.keys(payload).filter(
		(key) => payload[key] !== undefined,
	)) {
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
}

function parseDraftCollections(value: unknown, child: boolean) {
	const collectionKeys = parseUniqueStrings(value, "collections", 8);
	if (collectionKeys.some((key) => !isCanonicalRecordKey(key))) {
		throw new NativeItemValidationError("Choose valid collections.", {
			collections: "One or more selected collections are invalid.",
		});
	}
	if (child && collectionKeys.length > 0) {
		throw new NativeItemValidationError(
			"Child records inherit collections from their parent.",
			{
				collections:
					"Child records inherit collections from their parent. Remove the direct collection.",
			},
		);
	}
	return collectionKeys;
}

function parseDraftRelationships(
	payload: Record<string, unknown>,
	options: NativeItemValidationOptions,
) {
	const result: Record<string, unknown> = {};
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
		result.relations = relations;
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
		result.parentItem = parentItem;
	}
	return result;
}
