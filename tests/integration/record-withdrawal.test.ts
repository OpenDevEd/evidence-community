import assert from "node:assert/strict";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, inArray } from "drizzle-orm";
import { adminItemListProjection } from "../../src/db/schema/tables/adminItemListProjection";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { item } from "../../src/db/schema/tables/item";
import { publicationSyncJob, publicationTarget } from "../../src/db/schema/publication";
import {
	createNativeItemDraft,
	ItemHasActivePublicationError,
	openItemDraft,
	publishItemDraft,
	removeNativeItem,
	unpublishNativeItemWithOutcome,
} from "../../src/lib/admin/native-item-service";
import { publicationRecordMetadata } from "../../src/lib/publication/record-metadata";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { MemoryFileStorage, createPdf, fileHash } from "../helpers/file-storage";
import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import { itemFilePublication } from "../../src/db/schema/source";
import { completeNativePdfUpload, stageNativePdfUpload } from "../../src/lib/admin/native-file-service";
import { approveItemReview, getItemPublishingChoice, submitItemReview } from "../../src/lib/admin/review-service";
import { itemPublishingChoice } from "../../src/db/schema/review";
import { hideRemovedFiles } from "../../src/lib/admin/withdrawn-files";
import { readPublicationRepositorySnapshot } from "../../src/lib/publication/repository";

type Database = Parameters<Parameters<typeof withIsolatedPublicationDatabase>[0]>[0];

/** A published record with an attachment of its own (a note stands in for its PDF). */
async function recordWithAttachment(db: Database) {
	const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Peer tutoring pilot", date: "2026-11-18", creators: [{ creatorType: "author", firstName: "Grace", lastName: "Wanjiru" }] });
	await publishItemDraft(db, parent.itemKey);
	const child = await createNativeItemDraft(db, { itemType: "Note", note: "Its own attachment", parentItem: parent.itemKey });
	await publishItemDraft(db, child.itemKey);
	return { parent: parent.itemKey, child: child.itemKey };
}

/** The same, with a DOI on Zenodo. */
async function recordWithDoi(db: Database, environment: "sandbox" | "production") {
	const record = await recordWithAttachment(db);
	await db.insert(publicationTarget).values({ itemKey: record.parent, provider: "zenodo", environment, identifierPolicy: "mint-zenodo", requestedBy: "editor" });
	return record;
}

const row = async (db: Database, key: string) => (await db.select().from(item).where(eq(item.key, key)))[0]!;

// A demo community registers test DOIs, and an editor couldn't clear its records to show the PDF import again.
it("removes a record whose DOIs are test ones for good, its attachments with it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { parent, child } = await recordWithDoi(db, "sandbox");
		await db.update(publicationTarget).set({ activatedAt: new Date() }).where(eq(publicationTarget.itemKey, parent));
		await db.insert(itemPublishingChoice).values({ itemKey: parent, choice: { route: "zenodo", identifierPolicy: "mint-zenodo" } });
		await removeNativeItem(db, parent);
		assert.equal((await row(db, parent)).deleted, 1);
		assert.equal((await row(db, parent)).withdrawnAt, null);
		assert.equal((await row(db, child)).deleted, 1);
		const [target] = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, parent));
		assert.notEqual(target!.deactivatedAt, null, "A removed test DOI's target stays switched on");
		// The admin said its DOI was still chosen, and "Active", after its target was switched off.
		const { choice, canClear } = await getItemPublishingChoice(db, parent, config);
		assert.equal(choice, null, "A removed record's DOI still reads as chosen");
		assert.equal(canClear, true, "A switched-off target still holds the record's DOI switch");
	});
});

// A record imported from a PDF without a DOI needed its PDF handled first, one step at a time, before it could go.
it("removes a record without a DOI with its attachments, and restoring it brings them back", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { parent, child } = await recordWithAttachment(db);
		await removeNativeItem(db, parent);
		assert.equal((await row(db, parent)).deleted, 1);
		assert.equal((await row(db, child)).deleted, 1);

		await openItemDraft(db, parent);
		await publishItemDraft(db, parent);
		assert.equal((await row(db, parent)).deleted, 0);
		assert.equal((await row(db, child)).deleted, 0, "Restoring left its attachment removed");
	});
}, 60_000);

it("withdraws a record with a real DOI only with a reason, tells the registrars, and restores it with its attachments", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { parent, child } = await recordWithDoi(db, "production");
		await assert.rejects(unpublishNativeItemWithOutcome(db, parent), ItemHasActivePublicationError);
		assert.equal((await row(db, parent)).deleted, 0);

		await unpublishNativeItemWithOutcome(db, parent, { withdrawal: { reason: "It duplicates another report." } });
		const withdrawn = await row(db, parent);
		assert.equal(withdrawn.deleted, 1);
		assert.ok(withdrawn.withdrawnAt);
		assert.equal(withdrawn.withdrawalReason, "It duplicates another report.");
		assert.equal((await row(db, child)).deleted, 1);
		assert.deepEqual((await row(db, child)).withdrawnAt, withdrawn.withdrawnAt);
		const [target] = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, parent));
		assert.equal(target!.deactivatedAt, null, "A withdrawn record's DOI stays registered");
		const jobs = await db.select().from(publicationSyncJob).where(eq(publicationSyncJob.itemKey, parent));
		assert.ok(jobs.some((job) => job.canonicalRevision === withdrawn.revision), "Zenodo isn't told of the withdrawal");
		// An attachment may hold the DOI the withdrawal goes out under, so the deposit still reads it.
		assert.deepEqual((await readPublicationRepositorySnapshot(db, parent, "production")).attachments.map(({ key }) => key), [child]);

		await openItemDraft(db, parent);
		await publishItemDraft(db, parent);
		const restored = await row(db, parent);
		assert.equal(restored.deleted, 0);
		assert.equal(restored.withdrawnAt, null);
		assert.equal(restored.withdrawalReason, null);
		assert.equal((await row(db, child)).deleted, 0, "Restoring left its attachment withdrawn");
	});
}, 60_000);

it("registers a withdrawn record saying so: its title starts WITHDRAWN and it carries the day", () => {
	const metadata = publicationRecordMetadata({ itemType: "Report", title: "Peer tutoring pilot", date: "2026-11-18", abstractNote: null, languageName: null, publisher: null, rights: null, creators: [], withdrawnAt: new Date("2026-11-20T09:00:00Z") }, [], null);
	assert.equal(metadata.title, "WITHDRAWN: Peer tutoring pilot");
	assert.equal(metadata.withdrawnOn, "2026-11-20");
});

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
const editor = { userId: "editor", role: "editor" } as const;

// A removed record's PDF stayed at its public address, which anyone who had kept it could still open.
it("takes a removed record's PDF out of public view, and puts the very same file back when it is restored", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Peer tutoring pilot", date: "2026-11-18", creators: [{ creatorType: "author", firstName: "Grace", lastName: "Wanjiru" }] });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "The pilot's PDF" });
		const pdf = await createPdf("Peer tutoring pilot");
		const stage = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "pilot.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(stage.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: stage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const submitted = await submitItemReview(db, parent.itemKey, editor, config);
		await approveItemReview(db, storage, { reviewId: submitted.id, expectedRevision: submitted.revision }, editor, config);
		const [file] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, attachment.itemKey));
		const published = storage.publicFiles.get(file!.objectPath);
		assert.ok(published, "The fixture's PDF wasn't published");

		await db.insert(publicationTarget).values({ itemKey: parent.itemKey, provider: "zenodo", environment: "sandbox", identifierPolicy: "mint-zenodo", requestedBy: "editor" });
		await unpublishNativeItemWithOutcome(db, parent.itemKey);
		await hideRemovedFiles(db, storage, parent.itemKey);
		assert.equal(storage.publicFiles.has(file!.objectPath), false, "A removed record's PDF is still public");
		assert.notEqual(await listedFileState(db, parent.itemKey), "published", "The records table calls a removed record's PDF live");
		// Pressing Unpublish again runs the move again, which finds nothing left to do.
		await hideRemovedFiles(db, storage, parent.itemKey);

		await openItemDraft(db, parent.itemKey);
		const restoring = await submitItemReview(db, parent.itemKey, editor, config);
		await approveItemReview(db, storage, { reviewId: restoring.id, expectedRevision: restoring.revision }, editor, config);
		assert.equal((await row(db, attachment.itemKey)).deleted, 0, "Restoring left the PDF's attachment removed");
		assert.deepEqual(storage.publicFiles.get(file!.objectPath), published, "Restoring didn't put the same PDF back");
		assert.equal(await listedFileState(db, parent.itemKey), "published");
	});
}, 120_000);

// Clearing a demo community: a PDF imported as a draft couldn't be removed until its PDF's own draft was deleted first.
it("deletes a draft never published with its own PDF", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const parent = await createNativeItemDraft(db, { itemType: "Report", title: "Peer tutoring pilot" });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "The pilot's PDF" });
		const pdf = await createPdf("Peer tutoring pilot");
		const stage = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "pilot.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(stage.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: stage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const [staged] = await db.select().from(itemFileDraft).where(eq(itemFileDraft.itemKey, attachment.itemKey));

		const removed = await removeNativeItem(db, parent.itemKey);
		assert.deepEqual(await db.select().from(itemDraft).where(inArray(itemDraft.itemKey, [parent.itemKey, attachment.itemKey])), []);
		assert.deepEqual(await db.select().from(itemFileDraft).where(eq(itemFileDraft.itemKey, attachment.itemKey)), []);
		assert.ok(removed.stagedPrivatePaths.includes(staged!.objectPath), "The PDF's file isn't handed back to be deleted");
	});
}, 60_000);

const listedFileState = async (db: Database, key: string) =>
	(await db.select({ fileState: adminItemListProjection.fileState }).from(adminItemListProjection).where(eq(adminItemListProjection.key, key)))[0]?.fileState;
