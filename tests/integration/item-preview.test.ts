import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// A built app holds several copies of drizzle-orm, so its errors aren't always the classes a module imports.
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	TransactionRollbackError: class AnotherCopyOfTransactionRollbackError extends Error {},
}));
import { count, eq } from "drizzle-orm";
import { itemDraft, outbox } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { item } from "@/db/schema/tables/item";
import type { Database } from "@/db/database-schema";
import { previewItem } from "@/lib/admin/item-preview";
import { createNativeItemDraft, getItemDraft, openItemDraft, publishItemDraft, saveItemDraft } from "@/lib/admin/native-item-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "@/lib/admin/native-file-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { approveItemReview, setItemPublishingChoice, submitItemReview } from "@/lib/admin/review-service";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { MemoryFileStorage, createPdf, fileHash } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });

async function savedState(db: Database) {
	const [[items], [events], [drafts]] = await Promise.all([
		db.select({ count: count() }).from(item),
		db.select({ count: count() }).from(outbox),
		db.select({ count: count() }).from(itemDraft),
	]);
	return { items, events, drafts };
}

it("previews a never-published record and its private PDF without saving anything", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Unpublished report" });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "Full report" });
		const pdf = await createPdf("Private until publishing");
		const staged = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "report.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(staged.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: staged.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const before = await savedState(db);

		const preview = await previewItem(db, parent.itemKey, config);

		expect(preview?.title).toBe("Unpublished report");
		const files = `/api/admin/items/${attachment.itemKey}/file`;
		const revision = `revision=${staged.fileDraft.uploadRevision}`;
		expect(preview?.attachmentsData).toEqual([
			expect.objectContaining({ key: attachment.itemKey, PDFCoverPageImage: `${files}/cover?${revision}`, url: `${files}/pdf?${revision}` }),
		]);
		expect(await savedState(db)).toEqual(before);
		expect(await db.select().from(item).where(eq(item.key, parent.itemKey))).toEqual([]);
	});
}, 120_000);

it("previews a submitted review as submitted, and the working draft as edited since", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const created = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Published title" });
		await publishItemDraft(db, created.itemKey);
		const opened = await openItemDraft(db, created.itemKey);
		await saveItemDraft(db, { itemKey: created.itemKey, expectedDraftRevision: opened.draftRevision, expectedPayload: opened.payload, payload: { ...opened.payload, title: "Submitted title" } });
		const review = await submitItemReview(db, created.itemKey, { userId: "creator", role: "creator" }, config);
		const submitted = await getItemDraft(db, created.itemKey);
		await saveItemDraft(db, { itemKey: created.itemKey, expectedDraftRevision: submitted.draftRevision, expectedPayload: submitted.payload, payload: { ...submitted.payload, title: "Later working title" } });
		const before = await savedState(db);

		expect((await previewItem(db, created.itemKey, config, review.id))?.title).toBe("Submitted title");
		expect((await previewItem(db, created.itemKey, config))?.title).toBe("Later working title");
		expect(await savedState(db)).toEqual(before);
		const [published] = await db.select({ title: item.title }).from(item).where(eq(item.key, created.itemKey));
		expect(published?.title).toBe("Published title");
	});
}, 120_000);

it("names what stops publishing instead of previewing", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const blocked = (message: RegExp | null, field?: string) => (error: unknown) =>
			error instanceof AdminValidationError && (field ? Boolean(error.fields[field]) : message!.test(error.message));
		const zenodo = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Report for Zenodo" });
		await setItemPublishingChoice(db, zenodo.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" }, config);
		await expect(previewItem(db, zenodo.itemKey, config)).rejects.toSatisfy(blocked(null, "creators"));

		const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Report with a PDF on its way" });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "Uploading" });
		const pdf = await createPdf("Still uploading");
		await stageNativePdfUpload(db, new MemoryFileStorage(), { itemKey: attachment.itemKey, filename: "uploading.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		await expect(previewItem(db, parent.itemKey, config)).rejects.toSatisfy(blocked(/Wait for the PDF upload/));

		const reviewed = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Reviewed report" });
		const review = await submitItemReview(db, reviewed.itemKey, { userId: "creator", role: "creator" }, config);
		await publishItemDraft(db, reviewed.itemKey);
		await expect(previewItem(db, reviewed.itemKey, config, review.id)).rejects.toSatisfy(blocked(/changed after submission/));
	});
}, 120_000);

it("shows the Crossref DOI a review reserves, before approval and after", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const draft = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Report with a DOI", language: "en", date: "2026-09-10", institution: "Learning Lab", creators: [{ creatorType: "author", name: "Learning Lab" }] });
		await setItemPublishingChoice(db, draft.itemKey, { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }, config);
		const review = await submitItemReview(db, draft.itemKey, { userId: "creator", role: "creator" }, config);

		const preview = await previewItem(db, draft.itemKey, config, review.id);

		expect(preview?.DOI).toMatch(new RegExp(`^${config.services.publication.crossref?.prefix}/`));
		expect(await db.select().from(item).where(eq(item.key, draft.itemKey))).toEqual([]);

		await approveItemReview(db, new MemoryFileStorage(), { reviewId: review.id, expectedRevision: review.revision }, { userId: "editor", role: "editor" }, config);
		const [published] = await db.select({ DOI: item.DOI }).from(item).where(eq(item.key, draft.itemKey));
		expect((await previewItem(db, draft.itemKey, config, review.id))?.DOI).toBe(published?.DOI);
	});
}, 120_000);
