import { and, eq, inArray, TransactionRollbackError } from "drizzle-orm";
import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import type { Item } from "@/app/api/item/types";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemFileRemoval, itemReview, itemReviewFile } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";
import { projectPublicItems } from "@/lib/search-index/projection";
import { ItemNotFoundError, loadWorkingItemPayload, publishItemDraftWithContext } from "./native-item-service";
import { activateChosenIdentifiers, assertReviewCurrent, assertReviewPublishable, getItemPublishingChoice, publishReviewRecords, reviewChildKeys } from "./review-service";
import { assertUploadReady } from "./review-snapshot";
import { validateReviewPayload } from "./review-validation";

/** Names the preview as the requester of any identifier it activates; the rollback discards the activation anyway. */
const PREVIEW_ACTOR = "draft-preview";

type PreviewFiles = {
	files: { itemKey: string; uploadRevision: number; cover: boolean; coverWidth: number | null; coverHeight: number | null; filename: string }[];
	removed: string[];
};

/**
 * A record's public page as publishing would leave it: its working draft, or the version submitted in a review. The
 * publish runs in a transaction that is always rolled back, so the page comes from the same publish and projection code
 * as the real one, and nothing is saved. PDFs that aren't public yet are served by the admin file routes.
 */
export async function previewItem(db: Database, rootKey: string, config: LibraryServerConfig, reviewId?: string) {
	let preview: Item | undefined;
	try {
		await db.transaction(async (transaction) => {
			const files = reviewId
				? await publishReview(transaction, rootKey, reviewId, config)
				: await publishWorkingDrafts(transaction, rootKey, config);
			await showUnpublishedFiles(transaction, files, reviewId);
			[preview] = await projectPublicItems(transaction, [rootKey], config);
			transaction.rollback();
		});
	} catch (error) {
		if (!(error instanceof TransactionRollbackError)) throw error;
	}
	return preview ?? null;
}

async function publishWorkingDrafts(transaction: DatabaseTransaction, rootKey: string, config: LibraryServerConfig): Promise<PreviewFiles> {
	const keys = [rootKey, ...(await reviewChildKeys(transaction, rootKey))];
	const [drafts, { choice }] = await Promise.all([
		transaction.select({ key: itemDraft.itemKey }).from(itemDraft).where(inArray(itemDraft.itemKey, keys)),
		getItemPublishingChoice(transaction, rootKey),
	]);
	const drafted = keys.filter((key) => drafts.some((draft) => draft.key === key));
	// What submitting for review checks, identifier requirements included, so the preview names every blocker.
	for (const key of drafted) validateReviewPayload(await loadWorkingItemPayload(transaction, key), key === rootKey ? choice : null);
	// The parent first, as a review publishes it, so a new attachment has a record to belong to.
	for (const key of drafted) await publishItemDraftWithContext(transaction, key, { writebackConfig: config });
	// As approval would, so a DOI the record is about to receive shows on the page.
	await activateChosenIdentifiers(transaction, rootKey, choice, config, PREVIEW_ACTOR);
	const [files, removals] = await Promise.all([
		transaction.select().from(itemFileDraft).where(inArray(itemFileDraft.itemKey, keys)),
		transaction.select({ itemKey: itemFileRemoval.itemKey }).from(itemFileRemoval).where(inArray(itemFileRemoval.itemKey, keys)),
	]);
	files.forEach(assertUploadReady);
	return {
		files: files.map((file) => ({ ...file, cover: Boolean(file.coverObjectPath) })),
		removed: removals.map(({ itemKey }) => itemKey),
	};
}

async function publishReview(transaction: DatabaseTransaction, rootKey: string, reviewId: string, config: LibraryServerConfig): Promise<PreviewFiles> {
	const [review] = await transaction
		.select()
		.from(itemReview)
		.where(and(eq(itemReview.id, reviewId), eq(itemReview.itemKey, rootKey)));
	if (!review) throw new ItemNotFoundError(rootKey);
	assertReviewPublishable(review);
	// Approval refuses a pending review whose records changed since it was sent; an older review shows what it held.
	if (review.state === "pending") await assertReviewCurrent(transaction, review);
	await publishReviewRecords(transaction, review, config);
	await activateChosenIdentifiers(transaction, rootKey, review.snapshot.publishingChoice, config, PREVIEW_ACTOR);
	const files = await transaction.select().from(itemReviewFile).where(eq(itemReviewFile.reviewId, reviewId));
	return {
		files: files.flatMap(({ itemKey, file }) => (file ? [{ ...file, itemKey, cover: true }] : [])),
		removed: files.filter(({ file }) => !file).map(({ itemKey }) => itemKey),
	};
}

/** Points each PDF the preview adds at the admin file routes, and takes away the ones it removes, as publishing would. */
async function showUnpublishedFiles(transaction: DatabaseTransaction, { files, removed }: PreviewFiles, reviewId?: string) {
	for (const file of files) {
		const query = new URLSearchParams({ revision: String(file.uploadRevision), ...(reviewId ? { review: reviewId } : {}) });
		const route = `/api/admin/items/${file.itemKey}/file`;
		await transaction
			.update(item)
			.set({
				PDFCoverPageHeight: file.coverHeight,
				PDFCoverPageImage: file.cover ? `${route}/cover?${query}` : null,
				PDFCoverPageWidth: file.coverWidth,
				contentType: "application/pdf",
				filename: file.filename,
				linkMode: "imported_file",
				url: `${route}/pdf?${query}`,
			})
			.where(eq(item.key, file.itemKey));
	}
	if (removed.length === 0) return;
	await transaction
		.update(item)
		.set({
			PDFCoverPageHeight: null,
			PDFCoverPageImage: null,
			PDFCoverPageWidth: null,
			contentType: null,
			filename: null,
			linkMode: null,
			url: null,
		})
		.where(inArray(item.key, removed));
}
