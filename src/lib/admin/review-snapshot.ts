import { inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import { itemFileRemoval } from "@/db/schema/review";
import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import { applyItemDraftPatch } from "./item-draft-patch";
import { loadPublishedItemPayload, ItemDraftConflictError } from "./native-item-service";
import { AdminValidationError } from "./errors";
import { validateNativeItemDraft } from "./native-item-validation";
import { reviewFileSchema, type ReviewFile, type ReviewRecord } from "./review-contract";

type CapturedFile = {itemKey: string; file: ReviewFile | null; removalId?: string};

function captureFile(
    key: string,
    current: typeof item.$inferSelect | undefined,
    upload: typeof itemFileDraft.$inferSelect | undefined,
    file: typeof itemFilePublication.$inferSelect | undefined,
    removal: typeof itemFileRemoval.$inferSelect | undefined,
): CapturedFile | null {
    if (removal) return {itemKey: key, file: null, removalId: removal.id};
    if (upload) {
        if (!upload.readyAt) throw new AdminValidationError("Wait for the PDF upload to finish or remove it before submitting.");
        return {itemKey: key, file: reviewFileSchema.parse({...upload, sha256: upload.actualSha256, sizeBytes: upload.actualSizeBytes})};
    }
    if (!file) return null;
    return {itemKey: key, file: reviewFileSchema.parse({...file, objectPath: file.sourceObjectPath, coverObjectPath: file.sourceCoverObjectPath, extractedText: current?.fullTextPDF ?? ""})};
}

function reviewBaseRevision(key: string, current: typeof item.$inferSelect | undefined, draft: typeof itemDraft.$inferSelect | undefined) {
 const revision = current?.revision ?? 0;
 if (draft && draft.baseRevision !== revision) throw new ItemDraftConflictError(key);
 return revision;
}

async function reviewRecordPayload(transaction: DatabaseTransaction, key: string, current: typeof item.$inferSelect | undefined, draft: typeof itemDraft.$inferSelect | undefined) {
 return applyItemDraftPatch(await loadPublishedItemPayload(transaction, key, current ?? null), draft?.patch ?? {});
}

async function captureRecord(
    transaction: DatabaseTransaction,
    rootKey: string,
    key: string,
    current: typeof item.$inferSelect | undefined,
    draft: typeof itemDraft.$inferSelect | undefined,
): Promise<ReviewRecord | null> {
    if (!draft && (!current || current.deleted)) return null;
    const baseRevision = reviewBaseRevision(key, current, draft);
    const payload = await reviewRecordPayload(transaction, key, current, draft);
    const validated = validateNativeItemDraft(payload, {requireTitle: true});
    if (key === rootKey && validated.item.parentItem) throw new AdminValidationError("Submit the parent item for review.");
    if (key !== rootKey && validated.item.parentItem !== rootKey) return null;
    return {itemKey: key, baseRevision, payload: validated.payload};
}

/** Capture metadata and private file references while the caller holds item mutation locks. */
export async function captureItemReviewSnapshot(transaction: DatabaseTransaction, rootKey: string, keys: string[]) {
		const [published, drafts, fileDrafts, files, removals] =
			await Promise.all([
				transaction.select().from(item).where(inArray(item.key, keys)),
				transaction
					.select()
					.from(itemDraft)
					.where(inArray(itemDraft.itemKey, keys)),
				transaction
					.select()
					.from(itemFileDraft)
					.where(inArray(itemFileDraft.itemKey, keys)),
				transaction
					.select()
					.from(itemFilePublication)
					.where(inArray(itemFilePublication.itemKey, keys)),
				transaction
					.select()
					.from(itemFileRemoval)
					.where(inArray(itemFileRemoval.itemKey, keys)),
			]);
    const records: ReviewRecord[] = [];
    const capturedFiles: CapturedFile[] = [];
    for (const key of keys) {
        const current = published.find(record => record.key === key);
        const record = await captureRecord(transaction, rootKey, key, current, drafts.find(record => record.itemKey === key));
        if (!record) continue;
        records.push(record);
        const file = captureFile(key, current, fileDrafts.find(record => record.itemKey === key), files.find(record => record.itemKey === key), removals.find(record => record.itemKey === key));
        if (file) capturedFiles.push(file);
    }
    return {records, capturedFiles};
}
