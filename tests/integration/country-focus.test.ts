import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { sourceConnection } from "@opendeved/evidence-library-core";
import { item } from "../../src/db/schema/tables/item";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { MemoryFileStorage } from "../helpers/file-storage";
import {
	createNativeItemDraft,
	publishItemDraft,
	openItemDraft,
	saveItemDraft,
	getItemDraft,
} from "../../src/lib/admin/native-item-service";
import {
	submitItemReview,
	approveItemReview,
} from "../../src/lib/admin/review-service";
import { writeSourceIngestionBatch } from "../../src/lib/source-ingestion/transactional-writer";
import { generateSearchProjectionPlans } from "../../src/lib/search-index/projection";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const policy = { writebackConfig: config };

it("publishes the reviewed country set, keeps later edits private, and preserves it through source sync", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const focus = async (key: string) => {
			const plans = [];
			for await (const plan of generateSearchProjectionPlans(
				db,
				config,
				[{ entityType: "item", entityKey: key }],
			))
				plans.push(...plan.documents);
			expect(plans[0]).not.toHaveProperty("countryFocus");
			expect(plans[0]?.metadataSearch).not.toContain("MA");
			return plans[0]?.country;
		};
		const edit = async (key: string, countryFocus: string[] | null) => {
			const draft = await openItemDraft(db, key, policy);
			return saveItemDraft(
				db,
				{
					itemKey: key,
					expectedDraftGeneration: draft.generation,
					expectedDraftRevision: draft.draftRevision,
					expectedPayload: draft.payload,
					payload: { ...draft.payload, countryFocus },
				},
				policy,
			);
		};
		const created = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Kenyan classrooms",
			abstractNote: "In Uganda",
		});
		await publishItemDraft(db, created.itemKey);
		expect(await focus(created.itemKey)).toEqual(["KE", "UG"]);
		await edit(created.itemKey, ["ma", "MA"]);
		const submitted = await submitItemReview(db, created.itemKey, {
			userId: "country-creator",
			role: "creator",
		}, config);
		await edit(created.itemKey, ["TZ"]);
		expect(await focus(created.itemKey)).toEqual(["KE", "UG"]);
		await approveItemReview(
			db,
			new MemoryFileStorage(),
			{
				reviewId: submitted.id,
				expectedRevision: submitted.revision,
				publicationTags: [],
			},
			{ userId: "country-editor", role: "editor" },
			config,
		);
		expect(await focus(created.itemKey)).toEqual(["MA"]);
		expect(
			(await getItemDraft(db, created.itemKey))?.payload.countryFocus,
		).toEqual(["TZ"]);

		await db.insert(sourceConnection).values({
			key: "zotero-maximal",
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "6632364",
		});
		const sync = (version: number, title: string) =>
			writeSourceIngestionBatch(db, {
				sourceConnectionKey: "zotero-maximal",
				expectedCursor: version === 1 ? {} : { version: version - 1 },
				nextCursor: { version },
				mappingProfileVersion: "canonical-v1",
				fetchedAt: new Date(),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "CNTR2345",
						remoteVersion: String(version),
						raw: { version },
						metadata: { itemType: "report", title },
					},
				],
			});
		const imported = await sync(1, "Learning in Kenya");
		const key = imported.itemKeys.CNTR2345!;
		expect(await focus(key)).toEqual(["KE"]);
		await edit(key, ["UG", "ug"]);
		await publishItemDraft(db, key, policy);
		await sync(2, "Learning in Tanzania");
		expect(await focus(key)).toEqual(["UG"]);
		expect(
			(await db.select().from(item).where(eq(item.key, key)))[0]?.title,
		).toBe("Learning in Tanzania");
		await edit(key, []);
		await publishItemDraft(db, key, policy);
		await sync(3, "Learning in Morocco");
		expect(await focus(key)).toEqual([]);
		await edit(key, null);
		await publishItemDraft(db, key, policy);
		expect(await focus(key)).toEqual(["MA"]);
		await sync(4, "Learning in Uganda");
		expect(await focus(key)).toEqual(["UG"]);
	});
}, 120_000);
