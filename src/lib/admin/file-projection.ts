import "server-only";

import { itemFileDraft } from "@opendeved/evidence-library-core";

import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";

import type { AdminFileDraft, AdminFilePublication } from "./types";
import { adminCanonicalPayloadToItemFields } from "./item-fields";

function dateString(value: Date | string) {
	return value instanceof Date ? value.toISOString() : value;
}

export function fileDraftJson(
	row: typeof itemFileDraft.$inferSelect | null | undefined,
): AdminFileDraft | null {
	if (!row) return null;
	return {
		actualSha256: row.actualSha256,
		actualSizeBytes: row.actualSizeBytes,
		coverHeight: row.coverHeight,
		coverWidth: row.coverWidth,
		expectedSha256: row.expectedSha256,
		expectedSizeBytes: row.expectedSizeBytes,
		filename: row.filename,
		itemKey: row.itemKey,
		pageCount: row.pageCount,
		readyAt: row.readyAt ? dateString(row.readyAt) : null,
		updatedAt: dateString(row.updatedAt),
		uploadRevision: row.uploadRevision,
	};
}

export function filePublicationJson(
	row: typeof itemFilePublication.$inferSelect | null | undefined,
): AdminFilePublication | null {
	if (!row) return null;
	return {
		coverPublicUrl: row.coverPublicUrl,
		filename: row.filename,
		itemKey: row.itemKey,
		pageCount: row.pageCount,
		publicUrl: row.publicUrl,
		publishedAt: dateString(row.publishedAt),
		sha256: row.sha256,
		sizeBytes: row.sizeBytes,
		uploadRevision: row.uploadRevision,
	};
}

export function publishedItemJson(
	row: typeof item.$inferSelect | null | undefined,
): Record<string, unknown> | null {
	if (!row) return null;
	const payload = Object.fromEntries(
		Object.entries(row)
			.filter(([key]) => key !== "fullTextPDF")
			.map(([key, value]) => [
				key,
				value instanceof Date ? value.toISOString() : value,
			]),
	);
	return adminCanonicalPayloadToItemFields(payload, row.itemType);
}
