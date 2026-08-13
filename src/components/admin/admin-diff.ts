import type { AdminCreator, AdminItemDetail } from "@/lib/admin/types";

import type { AdminSchemaDefinition } from "./admin-schema";

export type AdminDraftDiff = {
	collections: string[] | null;
	creators: AdminCreator[] | null;
	fields: Record<string, string>;
	itemType: string | null;
	tags: string[] | null;
};

export const EMPTY_ADMIN_DRAFT_DIFF: AdminDraftDiff = {
	collections: null,
	creators: null,
	fields: {},
	itemType: null,
	tags: null,
};

function textValue(value: unknown) {
	return value === null || value === undefined || value === ""
		? ""
		: String(value);
}

function stringList(value: unknown) {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function normalizedSet(values: readonly string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
		(left, right) => left.localeCompare(right),
	);
}

function normalizeCreators(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(entry): entry is AdminCreator =>
				Boolean(entry) && typeof entry === "object",
		)
		.map((creator) => ({
			creatorType: textValue(creator.creatorType).trim(),
			firstName: textValue(creator.firstName).trim(),
			lastName: textValue(creator.lastName).trim(),
			name: textValue(creator.name).trim(),
		}))
		.filter(
			(creator) =>
				creator.creatorType ||
				creator.firstName ||
				creator.lastName ||
				creator.name,
		);
}

function sameValue(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function computeAdminDraftDiff(
	detail: AdminItemDetail,
	payload: Record<string, unknown>,
	definition: AdminSchemaDefinition | undefined,
): AdminDraftDiff {
	if (!detail.draft || !detail.published) return EMPTY_ADMIN_DRAFT_DIFF;

	const published = detail.published;
	const originalItemType = textValue(published.itemType || detail.itemType);
	const currentItemType = textValue(payload.itemType || detail.itemType);
	const fields: Record<string, string> = {};

	for (const { field } of definition?.fields ?? []) {
		const original = textValue(published[field]);
		const current = textValue(payload[field]);
		if (current !== original) fields[field] = original;
	}

	const originalCreators = Array.isArray(published.creators)
		? (published.creators as AdminCreator[])
		: [];
	const creatorsChanged = !sameValue(
		normalizeCreators(payload.creators),
		normalizeCreators(originalCreators),
	);
	const originalTags = detail.publishedTags;
	const tagsChanged = !sameValue(
		normalizedSet(stringList(payload.tags)),
		normalizedSet(originalTags),
	);
	const originalCollections = detail.publishedCollectionKeys;
	const collectionsChanged = !sameValue(
		normalizedSet(stringList(payload.collections)),
		normalizedSet(originalCollections),
	);

	return {
		collections: collectionsChanged ? originalCollections : null,
		creators: creatorsChanged ? originalCreators : null,
		fields,
		itemType:
			currentItemType.toLowerCase() !== originalItemType.toLowerCase()
				? originalItemType
				: null,
		tags: tagsChanged ? originalTags : null,
	};
}
