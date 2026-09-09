import "server-only";
import { itemIdentity, type itemDraft } from "@opendeved/evidence-library-core";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemReview, itemReviewFile } from "@/db/schema/review";
import { adminItemLinks, draftJson, itemSummary, payloadLinkKeys } from "./library-query-service";
import { ItemNotFoundError } from "./native-item-service";
import { payloadStringList } from "./item-payload";
import type { AdminItemDetail } from "./types";

export async function getAdminReviewSnapshot(db: Database, reviewId: string) {
	const [review] = await db.select().from(itemReview).where(eq(itemReview.id, reviewId));
	if (!review) throw new ItemNotFoundError(reviewId);
	const records = review.snapshot.records;
	const [identities, files, publishedRevisions] = await Promise.all([
		db.select().from(itemIdentity).where(inArray(itemIdentity.key, records.map((record) => record.itemKey))),
		db.select().from(itemReviewFile).where(eq(itemReviewFile.reviewId, review.id)),
		db.select({key: item.key, revision: item.revision}).from(item).where(inArray(item.key, records.map(record => record.itemKey))),
	]);
	const details = await Promise.all(records.map(async (submitted): Promise<AdminItemDetail> => {
		const record = review.corrections.find((entry) => entry.itemKey === submitted.itemKey) ?? submitted;
		const identity = identities.find(({ key }) => key === record.itemKey);
		if (!identity) throw new ItemNotFoundError(record.itemKey);
		const payload = record.payload;
		const draft: typeof itemDraft.$inferSelect = {
			itemKey: record.itemKey, sourceConnectionKey: identity.sourceConnectionKey,
			baseRevision: record.baseRevision, generation: review.id, draftRevision: review.revision,
			patch: payload, createdAt: review.submittedAt, updatedAt: review.submittedAt,
		};
		const file = files.find((entry) => entry.itemKey === record.itemKey)?.file;
		const keys = payloadLinkKeys(payload) ?? { cites: [], related: [] };
		return {
			...itemSummary(null, draft, null, null, payload),
			kind: identity.kind, importMethod: identity.importMethod,
			revision: publishedRevisions.find(published => published.key === record.itemKey)?.revision ?? 0,
			attachments: [], collectionKeys: payloadStringList(payload, "collections"), draft: draftJson(draft, payload),
			editable: false, fileState: file ? "staged" : "none",
			fileDraft: file ? { actualSha256: file.sha256, actualSizeBytes: file.sizeBytes, expectedSha256: file.sha256, expectedSizeBytes: file.sizeBytes, coverHeight: file.coverHeight, coverWidth: file.coverWidth, filename: file.filename, itemKey: file.itemKey, pageCount: file.pageCount, readyAt: review.submittedAt.toISOString(), updatedAt: review.submittedAt.toISOString(), uploadRevision: file.uploadRevision } : null,
			filePublication: null, fileRemovalPending: files.some((entry) => entry.itemKey === record.itemKey && entry.file === null),
			links: await adminItemLinks(db, record.itemKey, { keys, publishedKeys: keys }),
			parentItem: typeof payload.parentItem === "string" ? payload.parentItem : null,
			parentState: record.itemKey === review.itemKey ? null : "draft",
			published: null, publishedCollectionKeys: [], publishedTags: [],
			sourceFileUrl: file ? `/api/admin/reviews/${review.id}/files/${record.itemKey}` : typeof payload.url === "string" ? payload.url : null,
			tags: payloadStringList(payload, "tags"), writeback: { available: [], originSourceKey: null, selected: [] },
		};
	}));
	const root = details.find((detail) => detail.key === review.itemKey);
	if (!root) throw new ItemNotFoundError(review.itemKey);
	const frozenAttachments = details.filter((detail) => detail.parentItem === root.key);
	return {
		...root,
		attachments: frozenAttachments.map((detail) => ({ ...detail, parentItem: root.key })),
		fileState: frozenAttachments.some((detail) => detail.fileDraft) ? "staged" as const : root.fileState,
		frozenAttachments,
		reviewId: review.id, reviewRevision: review.revision, reviewState: review.state,
		submittedAt: review.submittedAt.toISOString(), submittedBy: review.submittedBy,
		remainingConflicts: review.remainingConflicts, note: review.note,
		publishing: review.snapshot.publishingChoice,
	};
}
