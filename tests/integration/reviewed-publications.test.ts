import assert from "node:assert/strict";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { MemoryFileStorage } from "../helpers/file-storage";
import { itemReview } from "../../src/db/schema/review";
import { itemToTag } from "../../src/db/schema/tables/itemToTag";
import { tag } from "../../src/db/schema/tables/tag";
import { createNativeItemDraft } from "../../src/lib/admin/native-item-service";
import { approveItemReview, submitItemReview } from "../../src/lib/admin/review-service";
import { listReviewedPublications } from "../../src/lib/admin/reviewed-publication-catalog";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
const creator = { userId: "user_creator", role: "creator" } as const;
const HIDDEN = ["hide"];

it("lists each reviewed publication once, newest approval first, with its approving editor, by page, by title and by key", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const publish = async (title: string, editor: string) => {
			const draft = await createNativeItemDraft(db, { itemType: "Report", title });
			const review = await submitItemReview(db, draft.itemKey, creator);
			await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision, publicationTags: ["publish-record"] }, { userId: editor, role: "editor" }, config);
			return draft.itemKey;
		};
		const first = await publish("Teacher coaching in Kenya", "user_amina");
		const second = await publish("Literacy at 50% scale", "user_omar");
		const third = await publish("Early numeracy", "user_amina");
		// Spread the approvals out, and give the first publication a later second approval by someone else.
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '3 days'` }).where(eq(itemReview.itemKey, first));
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '2 days'` }).where(eq(itemReview.itemKey, second));
		await db.update(itemReview).set({ resolvedAt: sql`now() - interval '1 day'` }).where(eq(itemReview.itemKey, third));
		await db.execute(sql`INSERT INTO "itemReview" SELECT (json_populate_record(NULL::"itemReview", (row_to_json(r)::jsonb || jsonb_build_object('id', gen_random_uuid(), 'resolvedAt', now(), 'resolvedBy', 'user_lucia'))::json)).* FROM "itemReview" r WHERE r."itemKey" = ${first}`);

		const page = await listReviewedPublications(db, { pageSize: "2" }, HIDDEN);
		assert.deepEqual(page.items.map((row) => [row.key, row.reviewer]), [[first, "user_lucia"], [third, "user_amina"]]);
		assert.ok(page.nextCursor);
		const rest = await listReviewedPublications(db, { pageSize: "2", cursor: page.nextCursor }, HIDDEN);
		assert.deepEqual(rest.items.map((row) => [row.key, row.title, row.reviewer]), [[second, "Literacy at 50% scale", "user_omar"]]);
		assert.equal(rest.nextCursor, null);

		assert.deepEqual((await listReviewedPublications(db, { query: "50%" }, HIDDEN)).items.map((row) => row.key), [second]);
		// A % in the search is the character, not a wildcard: "at%scale" would otherwise match "at 50% scale".
		assert.deepEqual((await listReviewedPublications(db, { query: "at%scale" }, HIDDEN)).items.map((row) => row.key), []);
		assert.deepEqual((await listReviewedPublications(db, { ids: `${third},${second}` }, HIDDEN)).items.map((row) => row.key).sort(), [second, third].sort());

		// A publication hidden by one of the library's hidden tags is not offered: the home page would not show it.
		await db.insert(tag).values({ name: "Hide" }).onConflictDoNothing();
		await db.insert(itemToTag).values({ itemKey: third, tagName: "Hide" });
		assert.deepEqual((await listReviewedPublications(db, {}, HIDDEN)).items.map((row) => row.key), [first, second]);
	});
}, 120_000);
