import { getTableColumns } from "drizzle-orm";

import { isTopLevelAdminItemType } from "./item-fields";
import { item } from "@/db/schema/tables/item";
import {
	applyItemDraftPatch,
	createItemDraftPatch,
} from "@/lib/admin/item-draft-merge";

export { applyItemDraftPatch, createItemDraftPatch };

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
	// A withdrawal is the community's act on the record, never a field of it: restoring clears it.
	"withdrawalReason",
	"withdrawnAt",
]);

export const editableItemDatabaseFields = Object.keys(
	getTableColumns(item),
).filter((field) => !systemManagedItemFields.has(field));

export function publishedAdminItemPayload(
	published: typeof item.$inferSelect | null | undefined,
	{
		collectionKeys = [],
		hasPublishedFile = false,
		links,
		tags = [],
	}: {
		collectionKeys?: string[];
		hasPublishedFile?: boolean;
		/** Editor-owned outgoing links. Leave out for payloads that must not carry links (writeback). */
		links?: { cites: string[]; related: string[] };
		tags?: string[];
	} = {},
) {
	if (!published) return {};
	const payload: Record<string, unknown> = {};
	for (const field of editableItemDatabaseFields) {
		if (field === "url" && hasPublishedFile) continue;
		if ((field === "topics" || field === "countryFocus" || field === "openAccess" || field === "studyType" || field === "licence") && !isTopLevelAdminItemType(published.itemType)) continue;
		const value = published[field as keyof typeof published];
		if (value !== null && value !== undefined) {
			payload[field] = value;
		}
	}
	payload.collections = [...collectionKeys].sort();
	payload.tags = [...tags].sort();
	if (links) {
		payload.links = { cites: [...links.cites], related: [...links.related] };
	}
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
