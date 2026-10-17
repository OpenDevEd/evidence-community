import { itemIdentity, itemSourceLink } from "@opendeved/evidence-library-core";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { itemSourceFileChoice } from "../../src/db/schema/review";
import { sourceConnection } from "../../src/db/schema/source";
import { item } from "../../src/db/schema/tables/item";
import { getAdminReviewSnapshot } from "../../src/lib/admin/review-query";
import { approveItemReview, resolveItemReview, submitItemReview } from "../../src/lib/admin/review-service";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

// The group doesn't write back, so the Zotero record itself can't be changed or published from the admin.
const config = libraryConfigSchema.parse({
	...maximalLibraryConfig,
	sources: [{ ...maximalLibraryConfig.sources[0], key: "zotero-review", groupId: "991", writebackEnabled: false }],
});
const creator = { userId: "creator", role: "creator" } as const;
const editor = { userId: "editor", role: "editor" } as const;
const RECORD = "ZREC2345";
const ATTACHMENT = "ZATT2345";

async function seedZoteroRecordWithPdf(db: Parameters<Parameters<typeof withIsolatedPublicationDatabase>[0]>[0]) {
	await db.insert(sourceConnection).values({ key: "zotero-review", provider: "zotero", scopeKind: "group", externalScopeKey: "991", config: {} });
	for (const key of [RECORD, ATTACHMENT])
		await db.insert(itemIdentity).values({ key, sourceConnectionKey: "zotero-review", sourceRecordKey: key, kind: "imported" });
	await db.insert(item).values([
		{ key: RECORD, sourceConnectionKey: "zotero-review", sourceRecordKey: RECORD, itemType: "Report", title: "A report from the group" },
		{ key: ATTACHMENT, sourceConnectionKey: "zotero-review", sourceRecordKey: ATTACHMENT, itemType: "Attachment", title: "report.pdf", parentItem: RECORD, contentType: "application/pdf", linkMode: "imported_url", filename: "report.pdf", md5: "a".repeat(32) },
	]);
	for (const key of [RECORD, ATTACHMENT])
		await db.insert(itemSourceLink).values({ itemKey: key, sourceConnectionKey: "zotero-review", sourceRecordKey: key, writebackEnabled: false });
	// What staging the PDF saves, without reading it from Zotero.
	await db.insert(itemSourceFileChoice).values({ itemKey: ATTACHMENT, sourceConnectionKey: "zotero-review", sourceRecordKey: ATTACHMENT, pending: "publish", sizeBytes: 1_024 });
}

const choiceOf = async (db: Parameters<Parameters<typeof withIsolatedPublicationDatabase>[0]>[0]) =>
	(await db.select().from(itemSourceFileChoice).where(eq(itemSourceFileChoice.itemKey, ATTACHMENT)))[0];

it("publishes a staged Zotero PDF through a review, though writeback can't change its record and the group moved on", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedZoteroRecordWithPdf(db);
		const review = await submitItemReview(db, RECORD, creator, config);
		expect((await choiceOf(db))?.reviewId).toBe(review.id);
		// The review shows the staged PDF as it shows an uploaded one.
		const snapshot = await getAdminReviewSnapshot(db, review.id, { topicsEnabled: false, config });
		expect(snapshot.frozenAttachments.find((attachment) => attachment.key === ATTACHMENT)?.fileState).toBe("staged");

		// The group's import updates the record after submission.
		await db.update(item).set({ revision: 7, title: "Retitled in Zotero" }).where(eq(item.key, RECORD));
		await approveItemReview(db, new MemoryFileStorage(), { reviewId: review.id, expectedRevision: review.revision }, editor, config);

		expect(await choiceOf(db)).toMatchObject({ choice: "publish", pending: null, reviewId: null, applied: false });
		// Approving changed nothing the import owns.
		const [record] = await db.select().from(item).where(eq(item.key, RECORD));
		expect(record).toMatchObject({ revision: 7, title: "Retitled in Zotero" });
	});
});

it("holds only the PDF changes the review shows", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedZoteroRecordWithPdf(db);
		// A child deleted in Zotero isn't in the review, so its staged PDF can't go with it.
		const GONE = "ZDEL2345";
		await db.insert(itemIdentity).values({ key: GONE, sourceConnectionKey: "zotero-review", sourceRecordKey: GONE, kind: "imported" });
		await db.insert(item).values({ key: GONE, sourceConnectionKey: "zotero-review", sourceRecordKey: GONE, itemType: "Attachment", title: "old.pdf", parentItem: RECORD, deleted: 1, contentType: "application/pdf", linkMode: "imported_url", filename: "old.pdf" });
		await db.insert(itemSourceFileChoice).values({ itemKey: GONE, sourceConnectionKey: "zotero-review", sourceRecordKey: GONE, pending: "publish", sizeBytes: 10 });
		const review = await submitItemReview(db, RECORD, creator, config);
		const [gone] = await db.select().from(itemSourceFileChoice).where(eq(itemSourceFileChoice.itemKey, GONE));
		expect(review.snapshot.records.map((record) => record.itemKey)).not.toContain(GONE);
		expect(gone?.reviewId).toBeNull();
		expect((await choiceOf(db))?.reviewId).toBe(review.id);
	});
});

it("gives a withdrawn review's PDF change back to the working draft", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedZoteroRecordWithPdf(db);
		const review = await submitItemReview(db, RECORD, creator, config);
		await resolveItemReview(db, { reviewId: review.id, expectedRevision: review.revision, action: "withdrawn" }, creator);
		expect(await choiceOf(db)).toMatchObject({ choice: null, pending: "publish", reviewId: null });
	});
});
