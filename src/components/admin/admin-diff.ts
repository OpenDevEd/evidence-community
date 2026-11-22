import type { FileAccess, RecordLicence } from "@/lib/licences";
import type {
	AdminCreator,
	AdminItemDetail,
	AdminItemLinkKeys,
} from "@/lib/admin/types";

import {
	adminFieldDescriptors,
	type AdminSchemaDefinition,
} from "./admin-schema";

export type AdminDraftDiff = {
	countryFocus: { previous: string[] | null } | null;
	/** The published choice when the draft changed it: true, false, or null for OpenAlex. */
	openAccess: { previous: boolean | null } | null;
	/** The published study type when the draft changed it, or null for the reading's. */
	studyType: { previous: string | null } | null;
	/** The published licence when the draft changed it, or null for none. */
	licence: { previous: RecordLicence | null } | null;
	/** Who could get the files as published, when the draft changed it, or null for the licence's own. */
	fileAccess: { previous: FileAccess | null } | null;
	collections: string[] | null;
	creators: AdminCreator[] | null;
	fields: Record<string, string>;
	itemType: string | null;
	/** Published link keys when the draft changed them, otherwise null. */
	links: AdminItemLinkKeys | null;
	tags: string[] | null;
};

export const EMPTY_ADMIN_DRAFT_DIFF: AdminDraftDiff = {
	countryFocus: null,
	openAccess: null,
	studyType: null,
	licence: null,
	fileAccess: null,
	collections: null,
	creators: null,
	fields: {},
	itemType: null,
	links: null,
	tags: null,
};

export function linkKeysFromPayload(
	payload: Record<string, unknown>,
	fallback: AdminItemLinkKeys,
): AdminItemLinkKeys {
	const value = payload.links;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fallback;
	}
	const record = value as Record<string, unknown>;
	return {
		cites: stringList(record.cites),
		related: stringList(record.related),
	};
}

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
			authorProfileId: textValue(creator.authorProfileId).trim(),
			institutions: (Array.isArray(creator.institutions)
				? creator.institutions
				: []
			).map((entry) => textValue(entry?.display_name).trim()),
			firstName: textValue(creator.firstName).trim(),
			lastName: textValue(creator.lastName).trim(),
			name: textValue(creator.name).trim(),
			organization: creator.organization === true,
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

function countryFocusDiff(current: unknown, previous: unknown) {
	if (sameValue(current ?? null, previous ?? null)) return null;
	return { previous: Array.isArray(previous) ? previous as string[] : null };
}

function studyTypeDiff(current: unknown, previous: unknown) {
	if (sameValue(current ?? null, previous ?? null)) return null;
	return { previous: typeof previous === "string" ? previous : null };
}

function licenceDiff(current: unknown, previous: unknown) {
	if (sameValue(current ?? null, previous ?? null)) return null;
	return { previous: (previous as RecordLicence | null | undefined) ?? null };
}

function fileAccessDiff(current: unknown, previous: unknown) {
	if (sameValue(current ?? null, previous ?? null)) return null;
	return { previous: (previous as FileAccess | null | undefined) ?? null };
}

function openAccessDiff(current: unknown, previous: unknown) {
	if (sameValue(current ?? null, previous ?? null)) return null;
	return { previous: typeof previous === "boolean" ? previous : null };
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

	for (const { field } of adminFieldDescriptors(definition)) {
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
	const originalLinks = detail.links.publishedKeys;
	const currentLinks = linkKeysFromPayload(payload, originalLinks);
	const linksChanged =
		!sameValue(normalizedSet(currentLinks.cites), normalizedSet(originalLinks.cites)) ||
		!sameValue(
			normalizedSet(currentLinks.related),
			normalizedSet(originalLinks.related),
		);

	return {
		countryFocus: countryFocusDiff(payload.countryFocus, published.countryFocus),
		openAccess: openAccessDiff(payload.openAccess, published.openAccess),
		studyType: studyTypeDiff(payload.studyType, published.studyType),
		licence: licenceDiff(payload.licence, published.licence),
		fileAccess: fileAccessDiff(payload.fileAccess, published.fileAccess),
		collections: collectionsChanged ? originalCollections : null,
		creators: creatorsChanged ? originalCreators : null,
		fields,
		itemType:
			currentItemType.toLowerCase() !== originalItemType.toLowerCase()
				? originalItemType
				: null,
		links: linksChanged ? originalLinks : null,
		tags: tagsChanged ? originalTags : null,
	};
}
