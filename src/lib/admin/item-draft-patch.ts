import { getTableColumns } from "drizzle-orm";

import { item } from "@/db/schema/tables/item";
import { adminDatabaseFieldToPayloadField } from "@/lib/admin/item-fields";

const systemManagedItemFields = new Set([
	"PDFCoverPageHeight",
	"PDFCoverPageImage",
	"PDFCoverPageWidth",
	"charset",
	"citation",
	"contentType",
	"createdAt",
	"dateAdded",
	"dateModified",
	"deleted",
	"deletedAt",
	"filename",
	"fullTextPDF",
	"key",
	"linkMode",
	"md5",
	"mtime",
	"revision",
	"sourceConnectionKey",
	"sourceRecordKey",
	"updatedAt",
]);

export const editableItemDatabaseFields = Object.keys(
	getTableColumns(item),
).filter((field) => !systemManagedItemFields.has(field));

function equalJsonValue(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function applyItemDraftPatch(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
) {
	const effective = { ...base };
	for (const [field, value] of Object.entries(patch)) {
		if (value === null) {
			delete effective[field];
		} else {
			effective[field] = value;
		}
	}
	return effective;
}

export function createItemDraftPatch(
	base: Record<string, unknown>,
	next: Record<string, unknown>,
) {
	const patch: Record<string, unknown> = {};
	const fields = new Set([...Object.keys(base), ...Object.keys(next)]);
	for (const field of fields) {
		const baseHasField = Object.hasOwn(base, field);
		const nextHasField = Object.hasOwn(next, field);
		if (!nextHasField) {
			if (baseHasField) patch[field] = null;
			continue;
		}
		const nextValue = next[field];
		if (!baseHasField || !equalJsonValue(base[field], nextValue)) {
			patch[field] = nextValue;
		}
	}
	return patch;
}

export function publishedAdminItemPayload(
	published: typeof item.$inferSelect | null | undefined,
	{
		collectionKeys = [],
		hasPublishedFile = false,
		tags = [],
	}: {
		collectionKeys?: string[];
		hasPublishedFile?: boolean;
		tags?: string[];
	} = {},
) {
	if (!published) return {};
	const payload: Record<string, unknown> = {};
	for (const field of editableItemDatabaseFields) {
		if (field === "url" && hasPublishedFile) continue;
		const value = published[field as keyof typeof published];
		if (value !== null && value !== undefined) {
			payload[adminDatabaseFieldToPayloadField(field)] = value;
		}
	}
	payload.collections = collectionKeys;
	payload.tags = tags;
	return payload;
}

export function materializeItemDraft<
	T extends { patch: Record<string, unknown> },
>(draft: T, base: Record<string, unknown>) {
	return {
		...draft,
		payload: applyItemDraftPatch(base, draft.patch),
	};
}
