import { sourceConnection } from "@/db/schema/source";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";
import { topicCatalogCache } from "@/db/schema/topics";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { AdminValidationError } from "@/lib/admin/errors";
import {
	createNativeItemDraft,
	getItemDraft,
	openItemDraft,
	publishItemDraft,
	saveItemDraft,
} from "@/lib/admin/native-item-service";
import {
	approveItemReview,
	submitItemReview,
} from "@/lib/admin/review-service";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const enabledConfig = libraryConfigSchema.parse({
	...maximalLibraryConfig,
	sources: [],
	topics: { enabled: true },
});
const disabledConfig = libraryConfigSchema.parse({
	...maximalLibraryConfig,
	sources: [],
	topics: { enabled: false },
});
const enabledPolicy = { writebackConfig: enabledConfig };
const creator = { userId: "topic-review-creator", role: "creator" } as const;
const editor = { userId: "topic-review-editor", role: "editor" } as const;
const publicationTags = ["publish-record"] as const;

async function seedTopics(db: Database) {
	await db.insert(topicCatalogCache).values(
		[
			["T12260", "Teacher Education"],
			["T12345", "Education Policy"],
		].map(([id, name]) => ({
			id,
			kind: "node",
			payload: {
				id,
				name,
				level: "topic",
				parent: "subfields/3304",
				path: ["Social Sciences", "Education", name],
				childCount: 0,
			},
			fetchedAt: new Date(),
		})),
	);
}

async function approveReview(
	db: Database,
	review: Awaited<ReturnType<typeof submitItemReview>>,
	config = enabledConfig,
) {
	return approveItemReview(
		db,
		new MemoryFileStorage(),
		{
			reviewId: review.id,
			expectedRevision: review.revision,
			publicationTags,
		},
		editor,
		config,
	);
}

it("publishes submitted topics while preserving a newer working topic draft", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedTopics(db);
		const draft = await createNativeItemDraft(
			db,
			{
				itemType: "Report",
				title: "Frozen topic review",
				topics: ["T12260"],
			},
			enabledPolicy,
		);
		const submitted = await submitItemReview(db, draft.itemKey, creator);
		await saveItemDraft(
			db,
			{
				itemKey: draft.itemKey,
				expectedDraftGeneration: draft.generation,
				expectedDraftRevision: draft.draftRevision,
				expectedPayload: draft.payload,
				payload: { ...draft.payload, topics: ["T12345"] },
			},
			enabledPolicy,
		);

		const approved = await approveReview(db, submitted);
		const [published] = await db
			.select()
			.from(item)
			.where(eq(item.key, draft.itemKey));
		const working = await getItemDraft(db, draft.itemKey);

		expect(published?.topics).toEqual(["T12260"]);
		expect(working?.payload.topics).toEqual(["T12345"]);
		expect(approved.review.state).toBe("published");
	});
});

it("keeps a changed submitted topic assignment private when Topics are disabled", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedTopics(db);
		const created = await createNativeItemDraft(
			db,
			{
				itemType: "Report",
				title: "Disabled topic review",
				topics: ["T12260"],
			},
			enabledPolicy,
		);
		await publishItemDraft(db, created.itemKey, enabledPolicy);
		const opened = await openItemDraft(db, created.itemKey, enabledPolicy);
		await saveItemDraft(
			db,
			{
				itemKey: created.itemKey,
				expectedDraftGeneration: opened.generation,
				expectedDraftRevision: opened.draftRevision,
				expectedPayload: opened.payload,
				payload: { ...opened.payload, topics: ["T12345"] },
			},
			enabledPolicy,
		);
		const submitted = await submitItemReview(db, created.itemKey, creator);

		await expect(
			approveReview(db, submitted, disabledConfig),
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof AdminValidationError &&
				Boolean(error.fields.topics),
		);
		const [published] = await db
			.select()
			.from(item)
			.where(eq(item.key, created.itemKey));
		const [review] = await db
			.select()
			.from(itemReview)
			.where(eq(itemReview.id, submitted.id));

		expect(published?.topics).toEqual(["T12260"]);
		expect(review?.state).toBe("pending");
	});
});

it("publishes a manual record without a DOI using catalog topic IDs", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seedTopics(db);
		const draft = await createNativeItemDraft(
			db,
			{
				itemType: "Report",
				title: "Manual catalog topic",
				topics: ["T12260", "T12345"],
			},
			enabledPolicy,
		);
		const submitted = await submitItemReview(db, draft.itemKey, creator);

		await approveReview(db, submitted);
		const [published] = await db
			.select()
			.from(item)
			.where(eq(item.key, draft.itemKey));

		expect(published).toMatchObject({
			DOI: null,
			topics: ["T12260", "T12345"],
		});
	});
});


it("publishes a topic review for an imported work with a URL-only PDF child", async () => {
 await withIsolatedPublicationDatabase(async db => {
  await seedTopics(db);
  await db.insert(sourceConnection).values({key: "oa", provider: "openalex", scopeKind: "query", config: {}});
  const mapped = mapOpenAlexWork({id: "W888", title: "Education with a source PDF", type: "article", updated_date: "2026-09-24T10:00:00Z", best_oa_location: {is_oa: true, pdf_url: "https://example.org/education.pdf"}});
  const imported = await writeSourceIngestionBatch(db, {sourceConnectionKey: "oa", expectedCursor: {}, nextCursor: {v: 1}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapped.items});
  const key = imported.itemKeys.W888!;
  const draft = await openItemDraft(db, key, enabledPolicy);
  await saveItemDraft(db, {itemKey: key, expectedDraftRevision: draft.draftRevision, expectedPayload: draft.payload, payload: {...draft.payload, topics: ["T12260"]}}, enabledPolicy);
  const submitted = await submitItemReview(db, key, creator);
  await approveReview(db, submitted);
  expect((await db.select().from(item).where(eq(item.key, key)))[0]?.topics).toEqual(["T12260"]);
  const child = (await db.select().from(item).where(eq(item.parentItem, key)))[0];
  expect(child).toMatchObject({itemType: "Attachment", topics: [], url: "https://example.org/education.pdf", deleted: 0});
 });
});
