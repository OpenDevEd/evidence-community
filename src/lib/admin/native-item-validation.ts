import {
	getZoteroItemType,
	isCanonicalRecordKey,
	type ZoteroItemTypeDefinition,
} from "@opendeved/evidence-library-core";
import { z } from "zod";

import { creatorType } from "@/db/schema/enums/creatorType";
import { itemType } from "@/db/schema/enums/itemType";
import type { item } from "@/db/schema/tables/item";
import type { InferInsertModel } from "drizzle-orm";

const itemTypeByZoteroName = new Map(
	itemType.enumValues.map((value) => [value.toLowerCase(), value]),
);
const creatorTypes = new Set<string>(creatorType.enumValues);

const creatorSchema = z
	.object({
		creatorType: z.string().min(1),
		firstName: z.string().optional(),
		lastName: z.string().optional(),
		name: z.string().optional(),
	})
	.strict()
	.superRefine((creator, context) => {
		if (!creatorTypes.has(creator.creatorType)) {
			context.addIssue({
				code: "custom",
				message: `Unsupported creator type: ${creator.creatorType}`,
				path: ["creatorType"],
			});
		}

		const hasSingleName = Boolean(creator.name?.trim());
		const hasSplitName =
			Boolean(creator.firstName?.trim()) ||
			Boolean(creator.lastName?.trim());
		if (hasSingleName === hasSplitName) {
			context.addIssue({
				code: "custom",
				message:
					"Creator must use either name or firstName/lastName",
			});
		}
	});

const payloadObjectSchema = z.record(z.string(), z.unknown());
const relationsSchema = z.record(z.string(), z.unknown());

const specialFieldsByType = new Map<string, ReadonlySet<string>>([
	["note", new Set(["note"])],
]);

const sharedPayloadFields = new Set([
	"collections",
	"creators",
	"itemType",
	"parentItem",
	"relations",
	"tags",
]);

type ItemWrite = InferInsertModel<typeof item>;

export class NativeItemValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NativeItemValidationError";
	}
}

export type ValidatedNativeItemDraft = {
	collectionKeys: string[];
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
		throw new NativeItemValidationError("itemType must be a string");
	}

	const normalized = itemTypeByZoteroName.get(value.toLowerCase());
	if (!normalized) {
		throw new NativeItemValidationError(
			`Unsupported item type: ${value}`,
		);
	}
	return normalized;
}

function zoteroDefinitionFor(itemTypeValue: string): ZoteroItemTypeDefinition {
	const zoteroName = itemTypeValue[0]!.toLowerCase() + itemTypeValue.slice(1);
	const definition = getZoteroItemType(zoteroName);
	if (!definition) {
		throw new NativeItemValidationError(
			`Vendored Zotero schema is missing item type: ${zoteroName}`,
		);
	}
	return definition;
}

function parseUniqueStrings(value: unknown, field: string, maxLength: number) {
	if (value === undefined) return [];
	const values = z.array(z.string()).parse(value);
	const normalized = values.map((entry) => entry.trim());
	if (normalized.some((entry) => !entry || entry.length > maxLength)) {
		throw new NativeItemValidationError(
			`${field} entries must contain 1-${maxLength} characters`,
		);
	}
	if (new Set(normalized).size !== normalized.length) {
		throw new NativeItemValidationError(
			`${field} entries must be unique`,
		);
	}
	return normalized;
}

export function validateNativeItemDraft(
	input: unknown,
): ValidatedNativeItemDraft {
	const payload = payloadObjectSchema.parse(input);
	const normalizedItemType = normalizeItemType(payload.itemType);
	const definition = zoteroDefinitionFor(normalizedItemType);
	const allowedFields = new Set([
		...sharedPayloadFields,
		...definition.fields.map(({ field }) => field),
		...(specialFieldsByType.get(definition.itemType) ?? []),
	]);

	for (const field of Object.keys(payload)) {
		if (!allowedFields.has(field)) {
			throw new NativeItemValidationError(
				`${field} is not valid for Zotero item type ${definition.itemType}`,
			);
		}
	}

	const itemValues: Record<string, unknown> = {
		itemType: normalizedItemType,
	};
	const normalizedPayload: Record<string, unknown> = {
		itemType: normalizedItemType,
	};
	for (const { field } of definition.fields) {
		const value = payload[field];
		if (value === undefined) continue;
		if (value !== null && typeof value !== "string") {
			throw new NativeItemValidationError(
				`${field} must be a string or null`,
			);
		}
		itemValues[field === "language" ? "languageName" : field] = value;
		normalizedPayload[field] = value;
	}

	if (definition.itemType === "note" && payload.note !== undefined) {
		if (payload.note !== null && typeof payload.note !== "string") {
			throw new NativeItemValidationError(
				"note must be a string or null",
			);
		}
		itemValues.note = payload.note;
		normalizedPayload.note = payload.note;
	}

	if (payload.creators !== undefined) {
		const creators = z.array(creatorSchema).parse(payload.creators);
		const allowedCreatorTypes = new Set(
			definition.creatorTypes.map(({ creatorType }) => creatorType),
		);
		for (const creator of creators) {
			if (!allowedCreatorTypes.has(creator.creatorType)) {
				throw new NativeItemValidationError(
					`${creator.creatorType} is not valid for Zotero item type ${definition.itemType}`,
				);
			}
		}
		itemValues.creators = creators;
		normalizedPayload.creators = creators;
	}

	if (payload.relations !== undefined) {
		const relations = relationsSchema.parse(payload.relations);
		itemValues.relations = relations;
		normalizedPayload.relations = relations;
	}

	if (payload.parentItem !== undefined) {
		const parentItem = z
			.string()
			.regex(/^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/)
			.nullable()
			.parse(payload.parentItem);
		itemValues.parentItem = parentItem;
		normalizedPayload.parentItem = parentItem;
	}

	const collectionKeys = parseUniqueStrings(
		payload.collections,
		"collections",
		8,
	);
	if (collectionKeys.some((key) => !isCanonicalRecordKey(key))) {
		throw new NativeItemValidationError(
			"collections entries must be canonical record keys",
		);
	}
	const tags = parseUniqueStrings(payload.tags, "tags", 255);
	normalizedPayload.collections = collectionKeys;
	normalizedPayload.tags = tags;

	return {
		collectionKeys,
		item: itemValues as ValidatedNativeItemDraft["item"],
		payload: normalizedPayload,
		tags,
	};
}
