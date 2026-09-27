import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import {
	itemIdentity,
	itemSourceLink,
	sourceConnection,
	sourceRecordIssue,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import {
	ItemParentUnavailableError,
	createNativeItemDraft,
	publishItemDraft,
} from "@/lib/admin/native-item-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "@/lib/admin/native-file-service";
import { approveItemReview, submitItemReview } from "@/lib/admin/review-service";
import { item } from "@/db/schema/tables/item";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { itemFilePublication, sourceSnapshot } from "@/db/schema/source";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { reconcileConfiguredSources } from "@/lib/source-ingestion/configuration";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { MemoryFileStorage, createPdf, fileHash } from "../helpers/file-storage";

const settings = {
	name: "AI in education",
	searchUrl: "/results/saved-search-1",
	approvedQuery: {
		version: "v1",
		approvedAt: "2026-09-24T10:00:00Z",
		query: { search: "AI in education" },
	},
	downloadPdfs: false,
};
const work = (
	id: number,
	title = "AI in schools",
	updated_date = "2026-09-24T10:00:00Z",
) => ({
	id: `https://openalex.org/W${id}`,
	type: "article",
	title,
	updated_date,
	doi: `https://doi.org/10.1234/work.${id}`,
	authorships: [
		{
			raw_author_name: "Stefan A. D. Popenici",
			institutions: [
				{
					id: "https://openalex.org/I10",
					display_name: "University of Nairobi",
					country_code: "KE",
				},
			],
		},
	],
	topics: [{ id: "https://openalex.org/T10", score: 0.7 }],
});

it("resumes after a failed page and shares identities across concurrent searches without flattening affiliations", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const manual = await createNativeItemDraft(db, {
			itemType: "JournalArticle",
			title: "Manual record",
			DOI: "10.1234/work.1",
		});
		await publishItemDraft(db, manual.itemKey);
		await db.insert(sourceConnection).values(
			["oa-a", "oa-b"].map((key) => ({
				key,
				provider: "openalex" as const,
				scopeKind: "query" as const,
				config: settings,
			})),
		);
		const run = async (key: string, request: typeof fetch) => {
			const [connection] = await db
				.select()
				.from(sourceConnection)
				.where(eq(sourceConnection.key, key));
			return syncOpenAlexSource(
				{
					database: db,
					sourceConnection: connection!,
					credentialResolver: async () => "test-key",
					heartbeat: async () => {},
				},
				{ fetch: request },
			);
		};
		await expect(
			run("oa-a", async (url) =>
				new URL(String(url)).searchParams.get("cursor") === "*"
					? Response.json({
							meta: { count: 2, next_cursor: "page-2" },
							results: [work(1)],
						})
					: new Response("Unavailable", { status: 403 }),
			),
		).rejects.toMatchObject({ status: 403 });
		const [first] = await db
			.select()
			.from(item)
			.where(eq(item.sourceRecordKey, "W1"));
		expect(first).toMatchObject({
			title: "AI in schools",
			country: null,
			publisher: null,
			creators: [
				{
					creatorType: "author",
					name: "Stefan A. D. Popenici",
					institutions: [{ display_name: "University of Nairobi" }],
				},
			],
		});
		expect(
			(
				await db
					.select()
					.from(sourceConnection)
					.where(eq(sourceConnection.key, "oa-a"))
			)[0]?.syncCursor,
		).toMatchObject({
			nextCursor: "page-2",
			completedAt: null,
			imported: 1,
		});
		const cursors: string[] = [];
		await Promise.all([
			run("oa-a", async (url) => {
				cursors.push(new URL(String(url)).searchParams.get("cursor")!);
				return Response.json({
					meta: { count: 2, next_cursor: null },
					results: [work(2)],
				});
			}),
			run("oa-b", async () =>
				Response.json({
					meta: { count: 2, next_cursor: null },
					results: [work(1), work(2)],
				}),
			),
		]);
		expect(cursors).toEqual(["page-2"]);
		const records = await db.select().from(item);
		expect(records).toHaveLength(3);
		expect(records.find((row) => row.key === manual.itemKey)?.title).toBe(
			"Manual record",
		);
		expect(records.find((row) => row.key === first!.key)?.DOI).toBe(
			"10.1234/work.1",
		);
		const links = await db.select().from(itemSourceLink);
		expect(links).toHaveLength(4);
		expect(
			links.every(
				(link) => !link.writebackEnabled && !link.remoteDeleted,
			),
		).toBe(true);
		expect(
			new Set(
				links
					.filter((link) => link.sourceRecordKey === "W2")
					.map((link) => link.itemKey),
			).size,
		).toBe(1);
		expect(await db.select().from(institutionCountry)).toMatchObject([
			{
				nameKey: "university of nairobi",
				countryCode: "KE",
				openalexId: "I10",
			},
		]);
		expect(
			(await db.select().from(sourceSnapshot))[0]?.payload,
		).toHaveProperty("topics", [
			{ id: "https://openalex.org/T10", score: 0.7 },
		]);
		await db
			.update(item)
			.set({ dateModified: new Date("2030-01-01") })
			.where(eq(item.key, first!.key));
		await run("oa-b", async () =>
			Response.json({
				meta: { count: 1, next_cursor: null },
				results: [work(1, "New source title", "2026-09-25T10:00:00Z")],
			}),
		);
		await run("oa-a", async () =>
			Response.json({
				meta: { count: 1, next_cursor: null },
				results: [work(1, "Stale source title")],
			}),
		);
		expect(
			(await db.select().from(item).where(eq(item.key, first!.key)))[0]
				?.title,
		).toBe("New source title");
		await run("oa-b", async () =>
			Response.json({
				meta: { count: 1, next_cursor: null },
				results: [work(1, "Older version from the newest source")],
			}),
		);
		await run("oa-a", async () =>
			Response.json({
				meta: { count: 1, next_cursor: null },
				results: [work(1, "Repeated stale version")],
			}),
		);
		expect(
			(await db.select().from(item).where(eq(item.key, first!.key)))[0]
				?.title,
		).toBe("New source title");
	});
}, 120_000);

it("rejects rewriting an approved query and cannot commit a page fetched under a replaced configuration", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const config = (version: string, search: string) =>
			libraryConfigSchema.parse({
				...maximalLibraryConfig,
				sources: [
					{
						key: "oa-a",
						provider: "openalex",
						apiKey: "test-key",
						settings: {
							...settings,
							name: "AI in education",
							approvedQuery: {
								...settings.approvedQuery,
								version,
								query: { search },
							},
						},
					},
				],
			});
		await reconcileConfiguredSources(
			db,
			config("v1", "AI in education").sources,
		);
		await expect(
			reconcileConfiguredSources(
				db,
				config("v1", "Different query").sources,
			),
		).rejects.toThrow(/approval/);
		const [connection] = await db
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, "oa-a"));
		await expect(
			syncOpenAlexSource(
				{
					database: db,
					sourceConnection: connection!,
					credentialResolver: async () => "test-key",
					heartbeat: async () => {},
				},
				{
					fetch: async () => {
						await reconcileConfiguredSources(
							db,
							config("v2", "Different query").sources,
						);
						return Response.json({
							meta: { count: 1, next_cursor: null },
							results: [work(1)],
						});
					},
				},
			),
		).rejects.toThrow(/cursor/i);
		await expect(
			reconcileConfiguredSources(
				db,
				config("v1", "Reused version with a third query").sources,
			),
		).rejects.toThrow(/approval/);
		await reconcileConfiguredSources(
			db,
			config("v1", "AI in education").sources,
		);
		expect(await db.select().from(item)).toEqual([]);
		expect(
			(
				await db
					.select()
					.from(sourceConnection)
					.where(eq(sourceConnection.key, "oa-a"))
			)[0]?.syncCursor,
		).toEqual({});
	});
}, 120_000);

it("publishes a library PDF on an OpenAlex record and keeps both through later syncs", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		await db.insert(sourceConnection).values([
			{ key: "oa", provider: "openalex", scopeKind: "query", config: settings },
			{ key: "zotero-group", provider: "zotero", scopeKind: "group", externalScopeKey: "1" },
		]);
		const run = async (results: ReturnType<typeof work>[]) => {
			const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa"));
			return syncOpenAlexSource(
				{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ fetch: async () => Response.json({ meta: { count: results.length, next_cursor: null }, results }) },
			);
		};
		await run([work(1)]);
		const [record] = await db.select().from(item).where(eq(item.sourceRecordKey, "W1"));

		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: record!.key, title: "Library copy" });
		const pdf = await createPdf("Library copy of an OpenAlex work");
		const staged = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "copy.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(staged.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: staged.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const review = await submitItemReview(db, record!.key, { userId: "creator", role: "creator" });
		await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision, publicationTags: ["publish-record"] }, { userId: "editor", role: "editor" }, libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] }));

		const libraryCopy = async () => (await db.select().from(item).where(eq(item.key, attachment.itemKey)))[0];
		expect(await libraryCopy()).toMatchObject({ parentItem: record!.key, deleted: 0 });
		expect(await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, attachment.itemKey))).toHaveLength(1);
		// OpenAlex takes no writeback, so the library copy stays local.
		expect(await db.select().from(sourceWritebackJob)).toEqual([]);

		await run([work(1, "Updated in OpenAlex", "2026-09-26T10:00:00Z")]);
		expect(await libraryCopy()).toMatchObject({ parentItem: record!.key, deleted: 0 });

		// The work leaves the search. A full scan must keep the record that holds the library copy.
		await db.update(sourceConnection).set({ syncCursor: sql`jsonb_set(${sourceConnection.syncCursor}, '{reconciledAt}', 'null'::jsonb)` }).where(eq(sourceConnection.key, "oa"));
		await run([]);
		expect((await db.select().from(item).where(eq(item.key, record!.key)))[0]?.deleted).toBe(0);
		expect(await db.select({ code: sourceRecordIssue.code }).from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceRecordKey, "W1"))).toEqual([{ code: "source_membership_removed" }]);

		// Zotero records sync their attachments back, so they still take no library files.
		await db.insert(itemIdentity).values({ key: "ABCD2345", sourceConnectionKey: "zotero-group", sourceRecordKey: "ABCD2345" });
		await expect(createNativeItemDraft(db, { itemType: "Attachment", parentItem: "ABCD2345", title: "Zotero copy" })).rejects.toBeInstanceOf(ItemParentUnavailableError);
	});
}, 120_000);
