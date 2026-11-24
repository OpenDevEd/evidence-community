import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/source-ingestion/transactional-writer", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/source-ingestion/transactional-writer")>();
	return { ...actual, writeSourceIngestionBatch: vi.fn(actual.writeSourceIngestionBatch) };
});
import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import {
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceRecordIssue,
	sourceSyncRun,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import {
	ItemParentUnavailableError,
	createNativeItemDraft,
	discardItemDraft,
	publishItemDraft,
} from "@/lib/admin/native-item-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "@/lib/admin/native-file-service";
import { approveItemReview, submitItemReview } from "@/lib/admin/review-service";
import { adminItemListProjection } from "@/db/schema/tables/adminItemListProjection";
import { item } from "@/db/schema/tables/item";
import { itemLink } from "@/db/schema/tables/itemLink";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { itemFilePublication, sourceSnapshot } from "@/db/schema/source";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { reconcileConfiguredSources } from "@/lib/source-ingestion/configuration";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { slicedQuery, type SliceDates } from "@/lib/source-ingestion/openalex/slices";
import type { SourceIngestionBatch, SourceItemUpsert } from "@/lib/source-ingestion/batch-schema";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
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

/** A fake OpenAlex for tests about works: the import's closing institution lookup finds nothing. */
const worksOnly = (request: typeof fetch): typeof fetch => async (input, init) =>
	new URL(String(input)).pathname === "/institutions" ? Response.json({ meta: { count: 0 }, results: [] }) : request(input, init);

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
				{ fetch: worksOnly(request), sleep: async () => {} },
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
		// The resumed run reads only from the saved cursor.
		expect(new Set(cursors)).toEqual(new Set(["page-2"]));
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
		await run([work(1), work(2)]);
		const [record] = await db.select().from(item).where(eq(item.sourceRecordKey, "W1"));
		const [draftOnly] = await db.select().from(item).where(eq(item.sourceRecordKey, "W2"));

		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: record!.key, title: "Library copy" });
		const pdf = await createPdf("Library copy of an OpenAlex work");
		const staged = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "copy.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(staged.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: staged.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const review = await submitItemReview(db, record!.key, { userId: "creator", role: "creator" }, libraryConfigSchema.parse(maximalLibraryConfig));
		await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision }, { userId: "editor", role: "editor" }, libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] }));

		const libraryCopy = async () => (await db.select().from(item).where(eq(item.key, attachment.itemKey)))[0];
		expect(await libraryCopy()).toMatchObject({ parentItem: record!.key, deleted: 0 });
		expect(await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, attachment.itemKey))).toHaveLength(1);
		// OpenAlex takes no writeback, so the library copy stays local.
		expect(await db.select().from(sourceWritebackJob)).toEqual([]);

		await run([work(1, "Updated in OpenAlex", "2026-09-26T10:00:00Z")]);
		expect(await libraryCopy()).toMatchObject({ parentItem: record!.key, deleted: 0 });

		// An unpublished library attachment counts too, even after the record's own draft is discarded.
		await createNativeItemDraft(db, { itemType: "Attachment", parentItem: draftOnly!.key, title: "Unpublished copy" });
		await discardItemDraft(db, draftOnly!.key);

		// The work leaves the search. A full scan must keep the record that holds the library copy.
		await db.update(sourceConnection).set({ syncCursor: sql`jsonb_set(${sourceConnection.syncCursor}, '{reconciledAt}', 'null'::jsonb)` }).where(eq(sourceConnection.key, "oa"));
		await run([]);
		for (const kept of [record!, draftOnly!]) {
			expect((await db.select().from(item).where(eq(item.key, kept.key)))[0]?.deleted).toBe(0);
			expect(await db.select({ code: sourceRecordIssue.code }).from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceRecordKey, kept.sourceRecordKey!))).toEqual([{ code: "source_membership_removed" }]);
		}

		// Zotero records sync their attachments back, so they still take no library files.
		await db.insert(itemIdentity).values({ key: "ABCD2345", sourceConnectionKey: "zotero-group", sourceRecordKey: "ABCD2345" });
		await expect(createNativeItemDraft(db, { itemType: "Attachment", parentItem: "ABCD2345", title: "Zotero copy" })).rejects.toBeInstanceOf(ItemParentUnavailableError);
	});
}, 120_000);

it("imports a work whose title is too long for a btree index entry", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa", provider: "openalex", scopeKind: "query", config: settings });
		const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa"));
		// Random text doesn't compress, so the full title would pass the 2,704-byte index limit.
		const title = randomBytes(3_000).toString("base64");
		await syncOpenAlexSource(
			{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
			{ fetch: async () => Response.json({ meta: { count: 2, next_cursor: null }, results: [work(1, title), work(2)] }) },
		);
		const listed = await db
			.select({ title: adminItemListProjection.title, titleSort: adminItemListProjection.titleSort })
			.from(adminItemListProjection)
			.innerJoin(item, eq(item.key, adminItemListProjection.key))
			.where(eq(item.sourceRecordKey, "W1"));
		expect(listed).toEqual([{ title, titleSort: title.toLowerCase().slice(0, 512) }]);
		expect(await db.select().from(item).where(eq(item.sourceRecordKey, "W2"))).toHaveLength(1);
	});
}, 120_000);

it("processes up to 48 PDFs at once, four per host, and writes a large page in order, in parts under the batch limit", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const [connection] = await db
			.insert(sourceConnection)
			.values({
				key: "oa-pdf",
				provider: "openalex",
				scopeKind: "query",
				config: { ...settings, downloadPdfs: true },
			})
			.returning();
		const ids = Array.from({ length: 60 }, (_, index) => index + 1);
		// Ten PDFs share one host; the rest each have their own.
		const host = (id: number) => (id <= 10 ? "shared.example.org" : `host${id}.example.org`);
		const pdfUrl = (id: number) => `https://${host(id)}/W${id}.pdf`;
		let running = 0;
		let mostRunning = 0;
		let sharedRunning = 0;
		let mostShared = 0;
		let sharedDone = 0;
		let sharedDoneWhenOthersStarted: number | undefined;
		// Later records finish first, so a result written to the wrong slot shows up.
		// Near-limit text makes the page too large for one write.
		const processor = Object.assign(
			async (record: SourceItemUpsert) => {
				const shared = record.file!.url!.includes("shared.");
				if (!shared) sharedDoneWhenOthersStarted ??= sharedDone;
				mostRunning = Math.max(mostRunning, ++running);
				if (shared) mostShared = Math.max(mostShared, ++sharedRunning);
				await new Promise((resolve) =>
					setTimeout(resolve, 61 - Number(record.sourceRecordKey.slice(1, -4))),
				);
				running--;
				if (shared) {
					sharedRunning--;
					sharedDone++;
				}
				return {
					...record,
					file: { ...record.file!, fullText: "x".repeat(1_400_000) },
					processingIssue: { code: "test_pdf", message: record.file!.url! },
				};
			},
			{ reuse: async (record: SourceItemUpsert) => record, flushCleanup: async () => {} },
		);
		const pageSizes: (string | null)[] = [];
		vi.mocked(writeSourceIngestionBatch).mockClear();
		await syncOpenAlexSource(
			{
				database: db,
				sourceConnection: connection!,
				credentialResolver: async () => "test-key",
				heartbeat: async () => {},
			},
			{
				attachmentProcessor: processor,
				fetch: worksOnly(async (url) => {
					pageSizes.push(new URL(String(url)).searchParams.get("per_page"));
					return Response.json({
						meta: { count: ids.length, next_cursor: null },
						results: ids.map((id) => ({
							...work(id),
							best_oa_location: { is_oa: true, pdf_url: pdfUrl(id), license: "cc-by" },
						})),
					});
				}),
			},
		);

		// Records first, then the PDF stage, both in pages of 200.
		expect(pageSizes).toEqual(["200", "200"]);
		expect(mostRunning).toBe(48);
		expect(mostShared).toBe(4);
		// Other hosts start while the shared host's first four still run.
		expect(sharedDoneWhenOthersStarted).toBe(0);
		const pageWrites = vi
			.mocked(writeSourceIngestionBatch)
			.mock.calls.map(([, batch]) => batch as SourceIngestionBatch)
			.filter((batch) => batch.items.length && (batch.nextCursor as { stage?: string }).stage === "pdfs");
		expect(pageWrites.length).toBeGreaterThan(1);
		// Earlier parts keep the old cursor, so a failure part-way fetches the page again.
		expect(pageWrites.map((batch) => (batch.nextCursor as { nextCursor?: unknown }).nextCursor)).toEqual([
			...pageWrites.slice(1).map(() => "*"),
			null,
		]);
		const pdfs = pageWrites
			.flatMap((batch) => batch.items)
			.filter((record): record is SourceItemUpsert => record.operation === "upsert" && Boolean(record.processingIssue));
		expect(pdfs.map((record) => [record.sourceRecordKey, record.processingIssue?.message])).toEqual(
			ids.map((id) => [`W${id}:pdf`, pdfUrl(id)]),
		);
		expect(
			await db.select().from(sourceRecordIssue).where(eq(sourceRecordIssue.code, "test_pdf")),
		).toHaveLength(ids.length);
	});
}, 120_000);

it("imports every record before downloading a PDF, then adds the PDFs and resumes that stage after a failure", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const [connection] = await db
			.insert(sourceConnection)
			.values({ key: "oa-first", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } })
			.returning();
		const [run] = await db
			.insert(sourceSyncRun)
			.values({ sourceConnectionKey: "oa-first", workerId: "test" })
			.returning({ id: sourceSyncRun.id });
		const ids = [1, 2, 3];
		const withPdf = (id: number) => ({
			...work(id),
			best_oa_location: { is_oa: true, pdf_url: `https://example.org/W${id}.pdf`, license: "cc-by" },
		});
		const results = ids.map(withPdf);
		const countRecords = async () =>
			(
				await db
					.select({ count: sql<number>`count(*)::int` })
					.from(item)
					.where(sql`${item.sourceRecordKey} in ('W1', 'W2', 'W3')`)
			)[0]!.count;
		let recordsWhenFirstPdfStarted: Promise<number> | undefined;
		const processor = Object.assign(
			async (record: SourceItemUpsert) => {
				recordsWhenFirstPdfStarted ??= countRecords();
				await recordsWhenFirstPdfStarted;
				return record.sourceRecordKey === "W3:pdf"
					? { ...record, processingIssue: { code: "openalex_pdf_download_failed", message: "Download returned 403" } }
					: record;
			},
			{ reuse: vi.fn(async (record: SourceItemUpsert) => record), flushCleanup: async () => {} },
		);
		const pageSizes: (string | null)[] = [];
		const report = vi.fn(async () => {});
		let failHeartbeat = true;
		const sync = async () => {
			const [current] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-first"));
			return syncOpenAlexSource(
				{
					database: db,
					sourceConnection: current!,
					credentialResolver: async () => "test-key",
					// The first run stops as soon as it starts on a PDF.
					heartbeat: async () => {
						// The run's second page is its first PDF page.
						if (failHeartbeat && pageSizes.length === 2) {
							failHeartbeat = false;
							throw new Error("lease lost");
						}
					},
					run: { id: run!.id, report },
				},
				{
					attachmentProcessor: processor,
					fetch: worksOnly(async (url) => {
						const perPage = new URL(String(url)).searchParams.get("per_page");
						pageSizes.push(perPage);
						// OpenAlex added W4 between the records stage and the PDF stage.
						const pdfStage = pageSizes.length > 1 || !failHeartbeat;
						const page = pdfStage ? [...results, withPdf(4)] : results;
						return Response.json({ meta: { count: page.length, next_cursor: null }, results: page });
					}),
				},
			);
		};

		await expect(sync()).rejects.toThrow("lease lost");
		expect(pageSizes).toEqual(["200", "200"]);
		expect(processor.reuse).toHaveBeenCalledTimes(3);
		// The records went in without their PDFs.
		expect(await db.select().from(item).where(sql`${item.sourceRecordKey} in ('W1', 'W2', 'W3')`)).toHaveLength(3);

		pageSizes.length = 0;
		await sync();
		// The second run carries on with the PDFs instead of importing the records again.
		expect(pageSizes).toEqual(["200"]);
		expect(await recordsWhenFirstPdfStarted).toBe(3);
		expect(report).toHaveBeenLastCalledWith(4, 4, { missed: 1 });
		const [saved] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-first"));
		expect(saved!.syncCursor).toMatchObject({ stage: "pdfs", pdfs: { done: 4, missed: 1, total: 4 } });
		// The new work's search update belongs to the run, like the other records'.
		const [newWork] = await db.select({ key: item.key }).from(item).where(eq(item.sourceRecordKey, "W4"));
		const newWorkEvents = await db.select().from(outbox).where(eq(outbox.entityKey, newWork!.key));
		expect(newWorkEvents.map((event) => event.sourceSyncRunId)).toEqual([run!.id]);
		expect(saved!.syncCursor).not.toMatchObject({ completedAt: null });
		// The PDF that could not be downloaded is a record issue.
		const issueRows = await db.select().from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceConnectionKey, "oa-first"));
		expect(issueRows.map((row) => row.code)).toEqual(["openalex_pdf_download_failed"]);
	});
}, 120_000);

it("takes a quick look for each PDF while the pages are written, then runs the full search on the ones that missed", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-search", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } });
		const [run] = await db.insert(sourceSyncRun).values({ sourceConnectionKey: "oa-search", workerId: "test" }).returning({ id: sourceSyncRun.id });
		const results = [1, 2, 3].map((id) => ({ ...work(id), best_oa_location: { is_oa: true, pdf_url: `https://example.org/W${id}.pdf`, license: "cc-by" } }));
		const steps: string[] = [];
		const waiting = new Map<string, SourceItemUpsert>();
		const issue = (record: SourceItemUpsert, message: string) => ({ ...record, processingIssue: { code: "openalex_pdf_download_failed", message } });
		const processor = Object.assign(
			// The full search finds W2's PDF on another site and finds none for W3.
			async (record: SourceItemUpsert) => {
				steps.push(`full ${record.sourceRecordKey}`);
				return record.sourceRecordKey === "W3:pdf" ? issue(record, "No link returned the paper's PDF") : record;
			},
			{
				// The quick look finds only W1's PDF.
				quick: async (record: SourceItemUpsert) => {
					steps.push(`quick ${record.sourceRecordKey}`);
					if (record.sourceRecordKey === "W1:pdf") return record;
					waiting.set(record.sourceRecordKey, record);
					return issue(record, "The site that holds the PDF refuses automated requests");
				},
				pending: async () => [...waiting].map(([key, record]) => ({ key, record })),
				searched: async (keys: string[]) => keys.forEach((key) => waiting.delete(key)),
				reuse: async (record: SourceItemUpsert) => record,
				flushCleanup: async () => {},
			},
		);
		const report = vi.fn(async () => {});
		const [current] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-search"));

		await syncOpenAlexSource(
			{ database: db, sourceConnection: current!, credentialResolver: async () => "test-key", heartbeat: async () => {}, run: { id: run!.id, report } },
			{ attachmentProcessor: processor, fetch: worksOnly(async () => Response.json({ meta: { count: results.length, next_cursor: null }, results })) },
		);

		// Every quick look comes before the first full search, and only the two misses are searched in full.
		expect(steps.slice(0, 3).toSorted()).toEqual(["quick W1:pdf", "quick W2:pdf", "quick W3:pdf"]);
		expect(steps.slice(3).toSorted()).toEqual(["full W2:pdf", "full W3:pdf"]);
		// The PDF the full search found is no longer missed, in the progress shown and in the saved state.
		expect(report).toHaveBeenLastCalledWith(3, 3, { missed: 1 });
		const [saved] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-search"));
		expect(saved!.syncCursor).toMatchObject({ stage: "pdfs", pdfs: { done: 3, missed: 1, total: 3 } });
		// Its record issue is gone, and the one PDF nobody holds says what the full search met.
		const issues = await db.select().from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceConnectionKey, "oa-search"));
		expect(issues.map((row) => [row.sourceRecordKey, row.message])).toEqual([["W3:pdf", "No link returned the paper's PDF"]]);
		expect(waiting.size).toBe(0);
	});
}, 120_000);

it("restarts a PDF stage from the records when it must scan in full, and tags works that come back", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-stage", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } });
		const processor = Object.assign(async (record: SourceItemUpsert) => record, {
			reuse: async (record: SourceItemUpsert) => record,
			flushCleanup: async () => {},
		});
		const requests: { perPage: string | null; cursor: string | null }[] = [];
		const current = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-stage")))[0]!;
		const sync = async (respond: (url: URL) => Response, runId?: number) =>
			syncOpenAlexSource(
				{
					database: db,
					sourceConnection: await current(),
					credentialResolver: async () => "test-key",
					heartbeat: async () => {},
					...(runId ? { run: { id: runId, report: async () => {} } } : {}),
				},
				{
					attachmentProcessor: processor,
					sleep: async () => {},
					fetch: worksOnly(async (input) => {
						const url = new URL(String(input));
						requests.push({ perPage: url.searchParams.get("per_page"), cursor: url.searchParams.get("cursor") });
						return respond(url);
					}),
				},
			);
		const page = (ids: number[]) => Response.json({ meta: { count: ids.length, next_cursor: null }, results: ids.map((id) => work(id)) });
		const resumeAt = async (cursor: Record<string, unknown>) =>
			db.update(sourceConnection).set({ syncCursor: { ...(await current()).syncCursor, completedAt: null, ...cursor } }).where(eq(sourceConnection.key, "oa-stage"));
		const record = async (id: number) => (await db.select().from(item).where(eq(item.sourceRecordKey, `W${id}`)))[0]!;
		await sync(() => page([1, 2]));

		// Incremental access is lost mid-way through a nightly PDF stage. The full
		// scan starts over from the records, so W2, now gone from OpenAlex, is withdrawn.
		await resumeAt({ stage: "pdfs", mode: "incremental", updatedSince: "2026-09-20", nextCursor: "*", pdfs: { done: 0, missed: 0, total: null } });
		requests.length = 0;
		await sync((url) =>
			url.searchParams.get("filter")?.includes("from_updated_date:")
				? new Response("Premium from_updated_date requires a paid key", { status: 403 })
				: page([1]),
		);
		expect(requests.map((request) => request.perPage)).toEqual(["200", "200", "200"]);
		expect((await record(2)).deleted).toBe(1);
		expect((await current()).syncCursor).toMatchObject({ stage: "pdfs", mode: "full" });

		// W2 comes back between the records scan and the PDF scan: its search update is the run's.
		const [run] = await db.insert(sourceSyncRun).values({ sourceConnectionKey: "oa-stage", workerId: "test" }).returning({ id: sourceSyncRun.id });
		await resumeAt({ stage: "records", pdfs: null, nextCursor: "*", imported: 0 });
		// The records scan comes first, then the PDF scan.
		let scans = 0;
		await sync(() => page(scans++ ? [1, 2] : [1]), run!.id);
		expect((await record(2)).deleted).toBe(0);
		const events = await db.select().from(outbox).where(eq(outbox.entityKey, (await record(2)).key)).orderBy(outbox.id);
		expect(events.at(-1)?.sourceSyncRunId).toBe(run!.id);

		// PDFs are turned off part-way through the PDF stage: a full records scan
		// puts every page back on its external link instead of finishing the PDF pages.
		await resumeAt({ stage: "pdfs", mode: "full", nextCursor: "page-2", pdfs: { done: 1, missed: 0, total: 2 } });
		await db.update(sourceConnection).set({ config: settings }).where(eq(sourceConnection.key, "oa-stage"));
		requests.length = 0;
		await sync(() => page([1, 2]));
		expect(requests).toEqual([{ perPage: "200", cursor: "*" }]);
		expect((await current()).syncCursor).toMatchObject({ stage: "records", mode: "full" });
	});
}, 120_000);

type SlicedWork = ReturnType<typeof work> & { publication_date?: string; best_oa_location?: unknown };

/**
 * OpenAlex for a query of thirty works, two with no date, answering its OQL
 * and date-sliced OQL in pages of two. Counts are reported a thousand times
 * larger, so the query looks big enough to slice. Each page request is logged
 * as `clause@offset`, or `all@offset` for the whole query.
 */
function slicedOpenAlex(extra: (id: number) => Partial<SlicedWork> = () => ({})) {
	const dated = (id: number) => ({ ...work(id), publication_date: `${2023 + (id % 2)}-${String((id % 12) + 1).padStart(2, "0")}-15` });
	const works: SlicedWork[] = [...Array.from({ length: 28 }, (_, index) => dated(index + 1)), work(29), work(30)].map((candidate, index) => ({
		...candidate,
		...extra(index + 1),
	}));
	const clauseOf = (oql: string) => (oql.includes(") and ") ? oql.slice(oql.indexOf(") and ") + 6) : null);
	const matches = (clause: string | null, date: string | undefined) => {
		if (!clause) return true;
		if (clause === "publication_date is null") return date === undefined;
		const from = /publication_date >= (\S+)/.exec(clause)?.[1];
		const to = /publication_date < (\S+)/.exec(clause)?.[1];
		return date !== undefined && (!from || date >= from) && (!to || date < to);
	};
	const state = { failNextSecondPage: false, failed: null as string | null, totalOffset: 0, planningDown: false };
	const requests: string[] = [];
	const yearGroups = () => {
		const years = Map.groupBy(works.filter((candidate) => candidate.publication_date), (candidate) => candidate.publication_date!.slice(0, 4));
		return Response.json({ meta: { count: 0 }, group_by: [...years].map(([key, list]) => ({ key, count: list.length * 1000 })) });
	};
	const failsOnce = (clause: string | null, offset: number) => {
		if (!clause || offset !== 2 || !state.failNextSecondPage) return false;
		state.failNextSecondPage = false;
		state.failed = clause;
		return true;
	};
	const page = (url: URL, clause: string | null) => {
		const matching = works.filter((candidate) => matches(clause, candidate.publication_date));
		const count = matching.length * 1000 + (clause ? 0 : state.totalOffset);
		if (url.searchParams.get("per_page") === "1") return Response.json({ meta: { count, next_cursor: null }, results: [] });
		const offset = url.searchParams.get("cursor") === "*" ? 0 : Number(url.searchParams.get("cursor"));
		requests.push(`${clause ?? "all"}@${offset}`);
		if (failsOnce(clause, offset)) return new Response("Forbidden", { status: 403 });
		// Pages of two, so most slices have several.
		const next = offset + 2 < matching.length ? String(offset + 2) : null;
		return Response.json({ meta: { count, next_cursor: next }, results: matching.slice(offset, offset + 2) });
	};
	const respond = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const oql = (JSON.parse(String(init?.body)) as { oql: string }).oql;
		if (!oql.endsWith(" group by publication_year")) return page(new URL(String(input)), clauseOf(oql));
		return state.planningDown ? new Response("Service unavailable", { status: 503 }) : yearGroups();
	}) as typeof fetch;
	return { works, clauseOf, requests, respond, state };
}

it("fetches a large full scan as date slices, importing each work once and resuming each slice after a failure", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const query = { oql: "works where title has education" };
		await db.insert(sourceConnection).values({
			key: "oa-sliced", provider: "openalex", scopeKind: "query",
			config: { ...settings, approvedQuery: { ...settings.approvedQuery, query } },
		});
		const openAlex = slicedOpenAlex();
		const { works, clauseOf, requests, respond, state } = openAlex;
		const connection = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-sliced")))[0]!;
		const sync = async () =>
			syncOpenAlexSource(
				{ database: db, sourceConnection: await connection(), credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ fetch: respond, sleep: async () => {} },
			);
		type SavedCursor = { imported: number; nextCursor: string | null; completedAt: string | null; slices: { dates: SliceDates; nextCursor: string | null }[] | null };
		const cursor = async () => (await connection()).syncCursor as unknown as SavedCursor;
		const records = async () => (await db.select({ key: item.sourceRecordKey }).from(item).where(sql`${item.sourceRecordKey} like 'W%'`)).map((row) => row.key);
		const expected = works.map((candidate) => candidate.id.split("/").pop()!).sort();

		// One slice's second page fails once, and the run stops there.
		state.failNextSecondPage = true;
		await expect(sync()).rejects.toMatchObject({ status: 403 });
		const stopped = await cursor();
		expect(stopped.slices!.length).toBeGreaterThan(2);
		const clauseFor = (dates: SliceDates) => clauseOf(slicedQuery(query, dates).oql!)!;
		expect(stopped.slices!.find((slice) => clauseFor(slice.dates) === state.failed)?.nextCursor).toBe("2");

		// The next run resumes that slice at its second page, fetches no finished
		// slice again, and imports every work once.
		requests.length = 0;
		await sync();
		expect(requests).toContain(`${state.failed}@2`);
		expect(requests).not.toContain(`${state.failed}@0`);
		for (const slice of stopped.slices!.filter((candidate) => candidate.nextCursor === null)) {
			expect(requests.filter((request) => request.startsWith(`${clauseFor(slice.dates)}@`))).toEqual([]);
		}
		expect((await records()).sort()).toEqual(expected);
		expect(await cursor()).toMatchObject({ imported: 30, nextCursor: null, completedAt: expect.any(String) });

		// When the slices' counts do not add up to the query's, the scan reads the query as one stream.
		state.totalOffset = 1;
		await db.update(sourceConnection).set({ syncCursor: {} }).where(eq(sourceConnection.key, "oa-sliced"));
		requests.length = 0;
		await sync();
		expect(requests.every((request) => request.startsWith("all@"))).toBe(true);
		expect((await records()).sort()).toEqual(expected);
	});
}, 120_000);

it("reads a large PDF stage in date slices, one after another, resuming a slice after a failure", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const query = { oql: "works where title has education" };
		await db.insert(sourceConnection).values({
			key: "oa-pdf-sliced", provider: "openalex", scopeKind: "query",
			config: { ...settings, downloadPdfs: true, approvedQuery: { ...settings.approvedQuery, query } },
		});
		const { clauseOf, requests, respond, state } = slicedOpenAlex((id) => ({
			best_oa_location: { is_oa: true, pdf_url: `https://host${id}.example.org/W${id}.pdf`, license: "cc-by" },
		}));
		const processor = Object.assign(async (record: SourceItemUpsert) => record, {
			reuse: async (record: SourceItemUpsert) => record,
			flushCleanup: async () => {},
		});
		const connection = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-pdf-sliced")))[0]!;
		const sync = async () =>
			syncOpenAlexSource(
				{ database: db, sourceConnection: await connection(), credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ attachmentProcessor: processor, fetch: respond, sleep: async () => {} },
			);
		await sync();

		// A PDF stage reopened at the start of the query, as after it stopped early. The
		// records stage counted its works like the query: a thousand times larger.
		const finished = (await connection()).syncCursor as Record<string, unknown>;
		const { slices: _recordSlices, ...reopened } = finished;
		await db
			.update(sourceConnection)
			.set({ syncCursor: { ...reopened, imported: 30_000, stage: "pdfs", nextCursor: "*", completedAt: null, pdfs: { done: 0, missed: 0, total: 30 } } })
			.where(eq(sourceConnection.key, "oa-pdf-sliced"));
		requests.length = 0;
		state.failNextSecondPage = true;
		await expect(sync()).rejects.toMatchObject({ status: 403 });
		type SavedCursor = { stage: string; nextCursor: string | null; completedAt: string | null; pdfs: { done: number }; slices: { dates: SliceDates; nextCursor: string | null }[] };
		const stopped = (await connection()).syncCursor as unknown as SavedCursor;
		const clauseFor = (dates: SliceDates) => clauseOf(slicedQuery(query, dates).oql!)!;
		expect(stopped.stage).toBe("pdfs");
		expect(stopped.slices.find((slice) => clauseFor(slice.dates) === state.failed)?.nextCursor).toBe("2");
		// The stage reads the slices, never the whole query.
		expect(requests.some((request) => request.startsWith("all@"))).toBe(false);

		requests.length = 0;
		await sync();
		expect(requests).toContain(`${state.failed}@2`);
		expect(requests).not.toContain(`${state.failed}@0`);
		for (const slice of stopped.slices.filter((candidate) => candidate.nextCursor === null)) {
			expect(requests.filter((request) => request.startsWith(`${clauseFor(slice.dates)}@`))).toEqual([]);
		}
		// Every PDF link is counted once across both runs.
		expect((await connection()).syncCursor).toMatchObject({ stage: "pdfs", nextCursor: null, completedAt: expect.any(String), pdfs: { done: 30 } });
	});
}, 120_000);

it("keeps a PDF stage where it was while OpenAlex cannot plan its slices, then moves it to slices", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const query = { oql: "works where title has education" };
		await db.insert(sourceConnection).values({
			key: "oa-pdf-outage", provider: "openalex", scopeKind: "query",
			config: { ...settings, downloadPdfs: true, approvedQuery: { ...settings.approvedQuery, query } },
		});
		const { requests, respond, state } = slicedOpenAlex((id) => ({
			best_oa_location: { is_oa: true, pdf_url: `https://host${id}.example.org/W${id}.pdf`, license: "cc-by" },
		}));
		const processor = Object.assign(async (record: SourceItemUpsert) => record, {
			reuse: async (record: SourceItemUpsert) => record,
			flushCleanup: async () => {},
		});
		const connection = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-pdf-outage")))[0]!;
		const sync = async () =>
			syncOpenAlexSource(
				{ database: db, sourceConnection: await connection(), credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ attachmentProcessor: processor, fetch: respond, sleep: async () => {} },
			);
		await sync();

		// A PDF stage part-way through the whole query as one stream, as before slices. The records stage
		// counted its works like the query: a thousand times larger.
		const { slices: _recordSlices, ...finished } = (await connection()).syncCursor as Record<string, unknown>;
		const partWay = { ...finished, imported: 30_000, stage: "pdfs", nextCursor: "4", completedAt: null, pdfs: { done: 4, missed: 0, total: 30 } };
		await db.update(sourceConnection).set({ syncCursor: partWay }).where(eq(sourceConnection.key, "oa-pdf-outage"));

		// While OpenAlex cannot plan slices, the run stops and the stage stays where it was.
		requests.length = 0;
		state.planningDown = true;
		await expect(sync()).rejects.toMatchObject({ status: 503 });
		expect((await connection()).syncCursor).toEqual(partWay);
		expect(requests).toEqual([]);

		// Once it can, the stage starts over in slices and counts every PDF link once.
		state.planningDown = false;
		await sync();
		expect(requests.length).toBeGreaterThan(0);
		expect(requests.some((request) => request.startsWith("all@"))).toBe(false);
		expect((await connection()).syncCursor).toMatchObject({ stage: "pdfs", nextCursor: null, completedAt: expect.any(String), pdfs: { done: 30 } });
	});
}, 120_000);

it("writes a page whose works carry more institution facts than one batch takes", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-affiliations", provider: "openalex", scopeKind: "query", config: settings });
		// 200 works with 102 distinct institutions each: 20,400 facts on one page.
		const affiliated = (id: number) => ({
			...work(id),
			authorships: Array.from({ length: 3 }, (_, author) => ({
				raw_author_name: `Author ${author}`,
				institutions: Array.from({ length: 34 }, (_, index) => ({
					id: `https://openalex.org/I${id}${author}${index}`,
					display_name: `Institute ${id}-${author}-${index}`,
					country_code: "KE",
				})),
			})),
		});
		const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-affiliations"));
		await syncOpenAlexSource(
			{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
			{ fetch: async () => Response.json({ meta: { count: 200, next_cursor: null }, results: Array.from({ length: 200 }, (_, index) => affiliated(index + 1)) }) },
		);
		expect(await db.select({ key: item.key }).from(item).where(sql`${item.sourceRecordKey} like 'W%'`)).toHaveLength(200);
		const [saved] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-affiliations"));
		// A scan that was not sliced saves no slice key, so an older release can still read its cursor.
		expect(saved!.syncCursor).not.toHaveProperty("slices");
	});
}, 120_000);

it("locates the institutions an import meets for the first time, with their city, leaving hand-set countries and known places alone", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-locations", provider: "openalex", scopeKind: "query", config: settings });
		await db.insert(institutionCountry).values([
			{ nameKey: "coast college", countryCode: "TZ" },
			{ nameKey: "makerere university", countryCode: "UG", openalexId: "I30", city: "Kampala", latitude: 0.3, longitude: 32.6 },
		]);
		const asked: string[] = [];
		const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-locations"));
		await syncOpenAlexSource(
			{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
			{
				fetch: async (input) => {
					const url = new URL(String(input));
					if (url.pathname !== "/institutions") return Response.json({ meta: { count: 1, next_cursor: null }, results: [work(1)] });
					asked.push(url.searchParams.get("filter")!);
					return Response.json({
						meta: { count: 2 },
						results: [
							{ id: "https://openalex.org/I10", geo: { city: "Nairobi", latitude: -1.28, longitude: 36.82 } },
							{ id: "https://openalex.org/I30", geo: { city: "Kampala", latitude: 9, longitude: 9 } },
						],
					});
				},
			},
		);
		expect(asked).toEqual(["openalex:I10"]);
		const rows = await db.select().from(institutionCountry);
		expect(rows.map(({ nameKey, city, latitude, longitude }) => ({ nameKey, city, latitude, longitude })).sort((a, b) => a.nameKey.localeCompare(b.nameKey))).toEqual([
			{ nameKey: "coast college", city: null, latitude: null, longitude: null },
			{ nameKey: "makerere university", city: "Kampala", latitude: 0.3, longitude: 32.6 },
			{ nameKey: "university of nairobi", city: "Nairobi", latitude: -1.28, longitude: 36.82 },
		]);
	});
}, 120_000);

it("stops starting PDFs after one fails, and still cleans up", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const [connection] = await db
			.insert(sourceConnection)
			.values({ key: "oa-pdf-fail", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } })
			.returning();
		const ids = Array.from({ length: 60 }, (_, index) => index + 1);
		let started = 0;
		let failed = false;
		let cleanedAfterFailure = 0;
		const flushCleanup = async () => {
			if (failed) cleanedAfterFailure++;
		};
		const processor = Object.assign(
			async (record: SourceItemUpsert) => {
				started++;
				if (record.sourceRecordKey === "W1:pdf") {
					failed = true;
					throw new Error("storage unavailable");
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
				return record;
			},
			{ reuse: async (record: SourceItemUpsert) => record, flushCleanup },
		);
		await expect(
			syncOpenAlexSource(
				{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{
					attachmentProcessor: processor,
					fetch: async () =>
						Response.json({
							meta: { count: ids.length, next_cursor: null },
							results: ids.map((id) => ({ ...work(id), best_oa_location: { is_oa: true, pdf_url: `https://host${id}.example.org/W${id}.pdf`, license: "cc-by" } })),
						}),
				},
			),
		).rejects.toThrow("storage unavailable");
		// The twelve waiting for a lane never start.
		expect(started).toBe(48);
		// The failed PDF stage still cleans up what it staged.
		expect(cleanedAfterFailure).toBe(1);
	});
}, 120_000);

it("withdraws a Zenodo version DOI's record once DataCite confirms it, keeps it withdrawn, and brings it back if its concept leaves", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-versions", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } });
		// OpenAlex lists a Zenodo upload twice: once under its concept DOI and once under its version DOI.
		const upload = (id: number, doi: string) => ({
			...work(id, "TVET teachers' digital competence"),
			doi: `https://doi.org/${doi}`,
			publication_date: "2026-09-28",
			indexed_in: ["datacite"],
			best_oa_location: { is_oa: true, pdf_url: `https://zenodo.org/records/${id}/files/paper.pdf`, license: "cc-by" },
		});
		// The version arrives first.
		let works = [upload(2, "10.5281/zenodo.492"), upload(1, "10.5281/zenodo.491"), work(3, "Another study")];
		let dataCiteUp = false;
		let linked = true;
		const respond = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			if (url.host === "api.datacite.org") {
				if (!dataCiteUp) return new Response("Service unavailable", { status: 503 });
				const relations: Record<string, unknown[]> = linked
					? { "10.5281/zenodo.492": [{ relationType: "IsVersionOf", relatedIdentifier: "10.5281/zenodo.491", relatedIdentifierType: "DOI" }] }
					: {};
				return Response.json({
					data: url.searchParams.get("ids")!.split(",").map((doi) => ({ attributes: { doi, relatedIdentifiers: relations[doi as keyof typeof relations] ?? [] } })),
				});
			}
			return Response.json({ meta: { count: works.length, next_cursor: null }, results: works });
		}) as typeof fetch;
		const processor = Object.assign(async (record: SourceItemUpsert) => record, {
			reuse: async (record: SourceItemUpsert) => record,
			flushCleanup: async () => {},
		});
		const connection = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-versions")))[0]!;
		const fullScan = async () => {
			await db.update(sourceConnection).set({ syncCursor: {} }).where(eq(sourceConnection.key, "oa-versions"));
			await syncOpenAlexSource(
				{ database: db, sourceConnection: await connection(), credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ attachmentProcessor: processor, fetch: respond, sleep: async () => {} },
			);
		};
		const live = async () =>
			(await db.select({ key: item.sourceRecordKey }).from(item).where(sql`${item.deleted} = 0 and ${item.sourceRecordKey} like 'W%'`))
				.map((row) => row.key)
				.sort();

		// While DataCite cannot be asked, both are kept.
		await fullScan();
		expect(await live()).toEqual(["W1", "W1:pdf", "W2", "W2:pdf", "W3"]);

		// The next full scan withdraws the version with its PDF, and its PDF stage does not bring it back.
		dataCiteUp = true;
		await fullScan();
		expect(await live()).toEqual(["W1", "W1:pdf", "W3"]);

		// While DataCite cannot be asked, it stays withdrawn.
		dataCiteUp = false;
		await fullScan();
		expect(await live()).toEqual(["W1", "W1:pdf", "W3"]);

		// If DataCite stops linking the two, it comes back; once it links them again, it goes.
		dataCiteUp = true;
		linked = false;
		await fullScan();
		expect(await live()).toEqual(["W1", "W1:pdf", "W2", "W2:pdf", "W3"]);
		linked = true;
		await fullScan();
		expect(await live()).toEqual(["W1", "W1:pdf", "W3"]);

		// If the concept leaves the query, the full scan that finds it gone brings the version back.
		works = works.filter((candidate) => candidate.id !== "https://openalex.org/W1");
		await fullScan();
		expect(await live()).toEqual(["W2", "W2:pdf", "W3"]);
	});
}, 120_000);

it("keeps a repeat's upload in a records-only library when its concept leaves, and points citations at the record kept", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-repeats", provider: "openalex", scopeKind: "query", config: settings });
		const upload = (id: number, doi: string) => ({
			...work(id, "TVET teachers' digital competence"),
			doi: `https://doi.org/${doi}`,
			publication_date: "2026-09-28",
			indexed_in: ["datacite"],
		});
		// W3 cites the version DOI's work.
		const citing = { ...work(3, "Another study"), referenced_works: ["https://openalex.org/W2"] };
		let works = [upload(1, "10.5281/zenodo.491"), upload(2, "10.5281/zenodo.492"), citing];
		const respond = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			if (url.host === "api.datacite.org") {
				return Response.json({
					data: url.searchParams.get("ids")!.split(",").map((doi) => ({
						attributes: {
							doi,
							relatedIdentifiers: doi === "10.5281/zenodo.492" ? [{ relationType: "IsVersionOf", relatedIdentifier: "10.5281/zenodo.491", relatedIdentifierType: "DOI" }] : [],
						},
					})),
				});
			}
			return Response.json({ meta: { count: works.length, next_cursor: null }, results: works });
		}) as typeof fetch;
		const connection = async () => (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-repeats")))[0]!;
		const fullScan = async () => {
			await db.update(sourceConnection).set({ syncCursor: {} }).where(eq(sourceConnection.key, "oa-repeats"));
			await syncOpenAlexSource(
				{ database: db, sourceConnection: await connection(), credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ fetch: respond, sleep: async () => {} },
			);
		};
		const items = async () =>
			new Map((await db.select({ key: item.key, record: item.sourceRecordKey, deleted: item.deleted }).from(item)).map((row) => [row.record, row]));
		const live = async () => [...(await items()).values()].filter((row) => !row.deleted).map((row) => row.record).sort();

		await fullScan();
		expect(await live()).toEqual(["W1", "W3"]);
		// The next scan writes W3 again, and its citation of the repeat lands on the record kept instead.
		await fullScan();
		const byRecord = await items();
		const cites = await db.select({ toKey: itemLink.toKey }).from(itemLink).where(and(eq(itemLink.kind, "cites"), eq(itemLink.fromKey, byRecord.get("W3")!.key)));
		expect(cites).toEqual([{ toKey: byRecord.get("W1")!.key }]);

		// The concept leaves the query: with no PDF stage to read it, the version still comes back in that scan.
		works = works.filter((candidate) => candidate.id !== "https://openalex.org/W1");
		await fullScan();
		expect(await live()).toEqual(["W2", "W3"]);
	});
}, 120_000);

it("writes the PDF pages already fetched when a later page cannot be fetched", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const [connection] = await db
			.insert(sourceConnection)
			.values({ key: "oa-pdf-prefetch", provider: "openalex", scopeKind: "query", config: { ...settings, downloadPdfs: true } })
			.returning();
		const works = [1, 2, 3, 4, 5, 6].map((id) => ({ ...work(id), best_oa_location: { is_oa: true, pdf_url: `https://host${id}.example.org/W${id}.pdf`, license: "cc-by" } }));
		const processor = Object.assign(
			async (record: SourceItemUpsert) => {
				await new Promise((resolve) => setTimeout(resolve, 20));
				return record;
			},
			{ reuse: async (record: SourceItemUpsert) => record, flushCleanup: async () => {} },
		);
		const seen = new Map<string, number>();
		await expect(
			syncOpenAlexSource(
				{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{
					attachmentProcessor: processor,
					sleep: async () => {},
					// Pages of two. The records scan reads all three, and the last one three times to be sure it ends there.
					// The PDF scan cannot read the third.
					fetch: async (input) => {
						const cursor = new URL(String(input)).searchParams.get("cursor")!;
						seen.set(cursor, (seen.get(cursor) ?? 0) + 1);
						if (cursor === "4" && seen.get(cursor)! > 3) return new Response("Forbidden", { status: 403 });
						const from = cursor === "*" ? 0 : Number(cursor);
						return Response.json({ meta: { count: works.length, next_cursor: from + 2 < works.length ? String(from + 2) : null }, results: works.slice(from, from + 2) });
					},
				},
			),
		).rejects.toMatchObject({ status: 403 });
		const [saved] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-pdf-prefetch"));
		expect(saved!.syncCursor).toMatchObject({ stage: "pdfs", nextCursor: "4", pdfs: { done: 4 } });
	});
}, 120_000);
