import assert from "node:assert/strict";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { MemoryFileStorage } from "../helpers/file-storage";
import { itemReview } from "../../src/db/schema/review";
import { item } from "../../src/db/schema/tables/item";
import { reserveItemIdentity } from "../../src/db/record-identity";
import { itemToTag } from "../../src/db/schema/tables/itemToTag";
import { tag } from "../../src/db/schema/tables/tag";
import { createNativeItemDraft } from "../../src/lib/admin/native-item-service";
import { approveItemReview, submitItemReview } from "../../src/lib/admin/review-service";
import { listReviewedPublications } from "../../src/lib/admin/reviewed-publication-catalog";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
const creator = { userId: "user_creator", role: "creator" } as const;
const HIDDEN = ["hide"];

it("lists each publication with a PDF once, reviewed or not, newest first, with its approving editor, by page, by title and by key", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const publish = async (title: string, editor: string) => {
			const draft = await createNativeItemDraft(db, { itemType: "Report", title });
			const review = await submitItemReview(db, draft.itemKey, creator);
			await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision, publicationTags: ["publish-record"] }, { userId: editor, role: "editor" }, config);
			await withPdf(draft.itemKey);
			return draft.itemKey;
		};
		// Rows written straight into the library, as a sync would leave them.
		const insertItem = async (values: Omit<typeof item.$inferInsert, "key" | "sourceConnectionKey" | "sourceRecordKey">) => {
			const key = await reserveItemIdentity(db, { sourceConnectionKey: "native" });
			await db.insert(item).values({ ...values, key, sourceConnectionKey: "native", sourceRecordKey: key });
			return key;
		};
		const withPdf = (parentItem: string) => insertItem({ itemType: "Attachment", parentItem, contentType: "application/pdf" });
		const first = await publish("Teacher coaching in Kenya", "user_amina");
		const second = await publish("Literacy at 50% scale", "user_omar");
		const third = await publish("Early numeracy", "user_amina");
		// Spread the approvals out, and give the first publication a later second approval by someone else.
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '3 days'` }).where(eq(itemReview.itemKey, first));
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '2 days'` }).where(eq(itemReview.itemKey, second));
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '1 day'` }).where(eq(itemReview.itemKey, third));
		await db.execute(sql`INSERT INTO "itemReview" SELECT (json_populate_record(NULL::"itemReview", (row_to_json(r)::jsonb || jsonb_build_object('id', gen_random_uuid(), 'resolvedAt', now(), 'resolvedBy', 'user_lucia'))::json)).* FROM "itemReview" r WHERE r."itemKey" = ${first}`);

		// A publication that never went through review is offered by when it was added; one without a PDF is not offered.
		const synced = await insertItem({ itemType: "Report", title: "Synced from Zotero", dateAdded: new Date(Date.now() - 36 * 3_600_000) });
		await withPdf(synced);
		await insertItem({ itemType: "Report", title: "Metadata only", dateAdded: new Date() });

		const page = await listReviewedPublications(db, { pageSize: "2" }, HIDDEN);
		assert.deepEqual(page.items.map((row) => [row.key, row.reviewer, row.reviewed]), [[first, "user_lucia", true], [third, "user_amina", true]]);
		assert.ok(page.nextCursor);
		const rest = await listReviewedPublications(db, { pageSize: "2", cursor: page.nextCursor }, HIDDEN);
		assert.deepEqual(rest.items.map((row) => [row.key, row.title, row.reviewer]), [[synced, "Synced from Zotero", ""], [second, "Literacy at 50% scale", "user_omar"]]);
		assert.equal(rest.nextCursor, null);

		assert.deepEqual((await listReviewedPublications(db, { query: "50%" }, HIDDEN)).items.map((row) => row.key), [second]);
		// A % in the search is the character, not a wildcard: "at%scale" would otherwise match "at 50% scale".
		assert.deepEqual((await listReviewedPublications(db, { query: "at%scale" }, HIDDEN)).items.map((row) => row.key), []);
		assert.deepEqual((await listReviewedPublications(db, { ids: `${third},${second}` }, HIDDEN)).items.map((row) => row.key).sort(), [second, third].sort());

		// A publication hidden by one of the library's hidden tags is not offered: the home page would not show it.
		await db.insert(tag).values({ name: "Hide" }).onConflictDoNothing();
		await db.insert(itemToTag).values({ itemKey: third, tagName: "Hide" });
		assert.deepEqual((await listReviewedPublications(db, {}, HIDDEN)).items.map((row) => row.key), [first, synced, second]);
		// Nor is one whose only PDF is hidden: it would have no public file or cover.
		const [pdfOfSecond] = await db.select({ key: item.key }).from(item).where(eq(item.parentItem, second));
		await db.insert(itemToTag).values({ itemKey: pdfOfSecond!.key, tagName: "Hide" });
		assert.deepEqual((await listReviewedPublications(db, {}, HIDDEN)).items.map((row) => row.key), [first, synced]);
	});
}, 120_000);
