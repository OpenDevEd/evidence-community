import { createHash } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { fetch as transport, Response } from "undici";
import { forgetHosts } from "@opendeved/paper-pdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("undici", async (importOriginal) => ({
	...(await importOriginal<typeof import("undici")>()),
	fetch: vi.fn(),
}));

import type { Database } from "@/db/database-schema";
import { computedCache } from "@/db/schema/tables/computedCache";
import { item } from "@/db/schema/tables/item";
import {
	itemFilePublication,
	sourceConnection,
	sourceFileCleanup,
} from "@/db/schema/source";
import { openItemDraft, publishItemDraft, unpublishNativeItem } from "@/lib/admin/native-item-service";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { createOpenAlexAttachmentProcessor } from "@/lib/source-ingestion/openalex/attachment-processor";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { openAlexSyncIsDue, syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { uploadSourcePublication } from "@/lib/source-ingestion/attachment-storage";
import { getSourceCitationMetrics } from "@/lib/links/citation-metrics";
import {
	MemoryFileStorage,
	createPdf,
	fileHash,
} from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const externalUrl = "https://93.184.216.34/research.pdf";
const policy = { writebackConfig: { ...libraryConfigSchema.parse(maximalLibraryConfig), sources: [{ key: "openalex-pdf-a", writebackEnabled: false }] } };

function mapped(url = externalUrl, version = "2026-09-24T01:02:03Z", id = 123) {
	return mapOpenAlexWork({
		id: `https://openalex.org/W${id}`,
		title: "Research",
		type: "article",
		cited_by_count: 5,
		updated_date: version,
		best_oa_location: {
			is_oa: true,
			pdf_url: url,
			license: "cc-by",
			version: "publishedVersion",
		},
	}).items;
}

async function sources(database: Database) {
	await database.insert(sourceConnection).values([
		{
			key: "openalex-pdf-a",
			provider: "openalex",
			scopeKind: "query",
			config: { downloadPdfs: true },
		},
		{
			key: "openalex-pdf-b",
			provider: "openalex",
			scopeKind: "query",
			config: { downloadPdfs: true },
		},
	]);
}

async function firstPublicationValue<
	Key extends keyof typeof itemFilePublication.$inferSelect,
>(database: Database, key: Key) {
	return (await database.select().from(itemFilePublication))[0]?.[key];
}

beforeEach(() => {
	vi.mocked(transport).mockReset();
	// What the PDF search learned about a host in one test says nothing in the next.
	forgetHosts();
});

describe("OpenAlex PDF processing", () => {
	it("stages a PDF while a page of the same source is being written", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			// Each item insert waits a second, so the write holds its source lock that long.
			await database.execute(sql`create function slow_item_write() returns trigger language plpgsql as $$ begin perform pg_sleep(1); return null; end $$`);
			await database.execute(sql`create trigger slow_item_write after insert on item for each statement execute function slow_item_write()`);
			const [parent] = mapped(`${externalUrl}?written`, "2026-09-24T01:02:03Z", 200);
			const writing = writeSourceIngestionBatch(database, {
				sourceConnectionKey: "openalex-pdf-a",
				expectedCursor: {},
				nextCursor: {},
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				items: [parent],
			});
			await new Promise((resolve) => setTimeout(resolve, 200));
			const started = Date.now();
			await uploadSourcePublication({
				database,
				storage: new MemoryFileStorage(),
				sourceConnectionKey: "openalex-pdf-a",
				paths: { pdf: "staged/document.pdf", cover: "staged/cover.png" },
				bytes: new Uint8Array([1]),
				cover: new Uint8Array([1]),
			});
			// Staging does not wait for the write to finish.
			expect(Date.now() - started).toBeLessThan(500);
			await writing;
		});
	});

	it("keeps later pages' staged PDFs while an earlier page waits for a slow download", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			await database
				.update(sourceConnection)
				.set({
					config: {
						name: "AI in education",
						searchUrl: "/results/saved-search-1",
						approvedQuery: { version: "v1", approvedAt: "2026-09-24T00:00:00Z", query: { search: "Research" } },
						downloadPdfs: true,
					},
				})
				.where(eq(sourceConnection.key, "openalex-pdf-a"));
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({ database, storage, maxPdfBytes: 1_000_000 });
			const works = [1, 2, 3, 4, 5, 6].map((id) => mapped(`${externalUrl}?work=${id}`, "2026-09-24T01:02:03Z", id)[0]!.raw);
			// The first page's first PDF arrives last, after the other pages have staged theirs.
			vi.mocked(transport).mockImplementation(async (input) => {
				if (String(input).endsWith("?work=1")) await new Promise((resolve) => setTimeout(resolve, 300));
				return new Response(await createPdf(String(input)));
			});
			const [connection] = await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a"));
			await syncOpenAlexSource(
				{ database, sourceConnection: connection!, credentialResolver: async () => "test", heartbeat: async () => {} },
				{
					attachmentProcessor: processor,
					sleep: async () => {},
					// Pages of two works.
					fetch: async (input) => {
						const cursor = new URL(String(input)).searchParams.get("cursor");
						const from = cursor === "*" ? 0 : Number(cursor);
						return globalThis.Response.json({
							meta: { count: works.length, next_cursor: from + 2 < works.length ? String(from + 2) : null },
							results: works.slice(from, from + 2),
						});
					},
				},
			);
			expect(await database.select().from(itemFilePublication)).toHaveLength(6);
			expect(storage.publicFiles.size).toBe(12);
		});
	});

	it("takes a finished run's PDFs down on the next run once PDFs are turned off, even after an unfinished refresh", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const settings = {
				name: "AI in education",
				searchUrl: "/results/saved-search-1",
				approvedQuery: { version: "v1", approvedAt: "2026-09-24T00:00:00Z", query: { search: "Research" } },
			};
			const setPdfs = (downloadPdfs: boolean) =>
				database.update(sourceConnection).set({ config: { ...settings, downloadPdfs } }).where(eq(sourceConnection.key, "openalex-pdf-a"));
			const processor = createOpenAlexAttachmentProcessor({ database, storage: new MemoryFileStorage(), maxPdfBytes: 1_000_000 });
			const works = [1, 2].map((id) => mapped(`${externalUrl}?work=${id}`, "2026-09-24T01:02:03Z", id)[0]!.raw);
			vi.mocked(transport).mockImplementation(async (input) => new Response(await createPdf(String(input))));
			const sync = async () => {
				const [connection] = await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a"));
				await syncOpenAlexSource(
					{ database, sourceConnection: connection!, credentialResolver: async () => "test", heartbeat: async () => {} },
					{ attachmentProcessor: processor, fetch: async () => globalThis.Response.json({ meta: { count: works.length, next_cursor: null }, results: works }) },
				);
				return (await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a")))[0]!;
			};
			await setPdfs(true);
			expect((await sync()).syncCursor).toMatchObject({ stage: "pdfs" });
			expect(await database.select().from(itemFilePublication)).toHaveLength(2);

			// A nightly refresh stopped part-way through its records hides the finished PDF stage.
			const [finished] = await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a"));
			await database
				.update(sourceConnection)
				.set({
					syncCursor: {
						...finished!.syncCursor,
						stage: "records",
						mode: "incremental",
						updatedSince: "2026-09-20",
						completedAt: null,
						nextCursor: "page-2",
						pdfs: null,
					},
				})
				.where(eq(sourceConnection.key, "openalex-pdf-a"));
			await setPdfs(false);
			const [turnedOff] = await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a"));
			expect(openAlexSyncIsDue(turnedOff!, new Date())).toBe(true);
			expect((await sync()).syncCursor).toMatchObject({ stage: "records", mode: "full" });
			expect(await database.select().from(itemFilePublication)).toHaveLength(0);
		});
	});

	it("follows a landing page's citation_pdf_url to its PDF", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const processor = createOpenAlexAttachmentProcessor({ database, storage: new MemoryFileStorage(), maxPdfBytes: 1_000_000 });
			const landing = (meta: string) =>
				new Response(`<html><head>${meta}<title>Research</title></head></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
			vi.mocked(transport)
				.mockResolvedValueOnce(landing('<meta content="/files/research.pdf?download=1&amp;v=2" name="citation_pdf_url">'))
				.mockResolvedValueOnce(new Response(await createPdf("LINKED PDF")));
			const [, attachment] = mapped();
			const published = await processor(attachment!, "openalex-pdf-a");
			expect(published.processingIssue).toBeNull();
			expect(published.file?.fullText).toContain("LINKED PDF");
			expect(String(vi.mocked(transport).mock.calls[1]![0])).toBe("https://93.184.216.34/files/research.pdf?download=1&v=2");

			// A relative link resolves against the page a redirect ended on.
			const redirected = landing('<meta name="citation_pdf_url" content="paper.pdf">');
			Object.defineProperty(redirected, "url", { value: "https://93.184.216.34/articles/123/index.html" });
			vi.mocked(transport)
				.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/articles/123/index.html" } }))
				.mockResolvedValueOnce(redirected)
				.mockResolvedValueOnce(new Response(await createPdf("MOVED PDF")));
			const [, moved] = mapped(`${externalUrl}?moved`, "2026-09-24T01:02:03Z", 125);
			expect((await processor(moved!, "openalex-pdf-a")).processingIssue).toBeNull();
			expect(String(vi.mocked(transport).mock.calls.at(-1)![0])).toBe("https://93.184.216.34/articles/123/paper.pdf");

			// A landing page sent without an HTML content type is still read.
			vi.mocked(transport)
				.mockResolvedValueOnce(new Response('<!doctype html><meta name="citation_pdf_url" content="/untyped.pdf">', { headers: { "content-type": "application/octet-stream" } }))
				.mockResolvedValueOnce(new Response(await createPdf("UNTYPED PDF")));
			const [, untyped] = mapped(`${externalUrl}?untyped`, "2026-09-24T01:02:03Z", 126);
			expect((await processor(untyped!, "openalex-pdf-a")).processingIssue).toBeNull();

			// A landing page that names no PDF is a PDF that is not available, not one that cannot be read.
			vi.mocked(transport).mockResolvedValueOnce(landing('<meta name="citation_title" content="Research">'));
			const [, other] = mapped(`${externalUrl}?landing`, "2026-09-24T01:02:03Z", 124);
			expect((await processor(other!, "openalex-pdf-a")).processingIssue?.code).toBe("openalex_pdf_download_failed");
		});
	});

	it("keeps a PDF the quick search missed for the full search, across restarts", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const processor = createOpenAlexAttachmentProcessor({ database, storage: new MemoryFileStorage(), maxPdfBytes: 1_000_000 });
			const [, attachment] = mapped();
			vi.mocked(transport).mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

			const missed = await processor.quick(attachment!, "openalex-pdf-a");

			expect(missed.processingIssue).toMatchObject({ code: "openalex_pdf_download_failed", message: expect.stringContaining("refuses automated requests (HTTP 403)") });
			// The quick search asked the record's own link and nothing else.
			expect(transport).toHaveBeenCalledTimes(1);

			// Another processor, as after a restart, finds the record waiting for its own source and no other.
			const later = createOpenAlexAttachmentProcessor({ database, storage: new MemoryFileStorage(), maxPdfBytes: 1_000_000 });
			const pending = await later.pending("openalex-pdf-a", 10);
			expect(pending.map(({ record }) => record?.sourceRecordKey)).toEqual(["W123:pdf"]);
			expect(await later.pending("openalex-pdf-b", 10)).toEqual([]);

			await later.searched(pending.map(({ key }) => key));
			expect(await later.pending("openalex-pdf-a", 10)).toEqual([]);
		});
	});

	it("shares hosted PDFs, survives refresh failure and rejects a reuse that lost its publication", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({
				database,
				storage,
				maxPdfBytes: 1_000_000,
			});
			const write = (sourceConnectionKey: string, items: unknown[]) =>
				writeSourceIngestionBatch(database, {
					sourceConnectionKey,
					expectedCursor: {},
					nextCursor: {},
					mappingProfileVersion: "test",
					fetchedAt: new Date(),
					items,
				});
			const [parent, original] = mapped();
			vi.mocked(transport).mockResolvedValueOnce(
				new Response(await createPdf("FIRST PDF")),
			);
			const hosted = await processor(original!, "openalex-pdf-a");
			// Each step is timed for the PDF stage's log, and taking the times starts them again.
			expect(processor.takeTimings("openalex-pdf-a")).toMatchObject({ download: { count: 1 }, read: { count: 1 }, upload: { count: 1 } });
			expect(processor.takeTimings("openalex-pdf-a")).toMatchObject({ download: { count: 0 }, read: { count: 0 }, upload: { count: 0 } });
			await write("openalex-pdf-a", [parent, hosted]);
			const shared = await processor(original!, "openalex-pdf-b");
			expect(shared.file?.managedPublication?.objectPath).toBe(
				hosted.file?.managedPublication?.objectPath,
			);
			expect(transport).toHaveBeenCalledTimes(1);
			await write("openalex-pdf-b", [parent, shared]);
			expect(
				await firstPublicationValue(database, "sourceConnectionKey"),
			).toBe("openalex-pdf-a");
			await database.insert(sourceFileCleanup).values(
				[...storage.publicFiles.keys()].map((objectPath) => ({
					sourceConnectionKey: "openalex-pdf-b",
					objectPath,
				})),
			);
			await processor.flushCleanup("openalex-pdf-b");
			expect(storage.publicFiles.size).toBe(2);

			const next = mapped(
				`${externalUrl}?version=2`,
				"2026-09-25T01:02:03Z",
			);
			vi.mocked(transport).mockRejectedValueOnce(
				new Error("Publisher unavailable"),
			);
			const failed = await processor(next[1]!, "openalex-pdf-a");
			expect(failed.processingIssue?.code).toBe(
				"openalex_pdf_download_failed",
			);
			expect(failed.file?.url).toBe(hosted.file?.url);
			await write("openalex-pdf-a", [next[0], failed]);
			await processor.flushCleanup("openalex-pdf-a");
			expect(storage.publicFiles.size).toBe(2);
			// The search remembers the miss and asks nothing until its time comes, here as if it had.
			expect((await processor(next[1]!, "openalex-pdf-a")).processingIssue?.message).toContain("as an earlier search found");
			await database.delete(computedCache).where(like(computedCache.key, "pdf-search:paper:%"));
			vi.mocked(transport).mockResolvedValueOnce(
				new Response(await createPdf("UPDATED PDF")),
			);
			const replaced = await processor(next[1]!, "openalex-pdf-a");
			expect(replaced.processingIssue).toBeNull();
			expect(replaced.file?.fullText).toContain("UPDATED PDF");
			await write("openalex-pdf-a", [next[0], replaced]);
			await processor.flushCleanup("openalex-pdf-a");
			expect(storage.publicFiles.size).toBe(2);
			// B read the original publication before A replaced and cleaned it.
			await expect(
				write("openalex-pdf-b", [
					next[0],
					{
						...shared,
						remoteVersion: next[1]!.remoteVersion,
						sourceDates: next[1]!.sourceDates,
					},
				]),
			).rejects.toThrow(/staged|staging/i);
			expect(await firstPublicationValue(database, "publicUrl")).toBe(
				replaced.file?.url,
			);
		});
	}, 120_000);

	it.each([false, true])(
		"cleans hosted files only after supplying sources opt out, overlapping source %s",
		async (overlappingSource) => {
			await withIsolatedPublicationDatabase(async (database) => {
				await sources(database);
				const storage = new MemoryFileStorage();
				const processor = createOpenAlexAttachmentProcessor({
					database,
					storage,
					maxPdfBytes: 1_000_000,
				});
				const [parent, original] = mapped();
				vi.mocked(transport).mockResolvedValueOnce(
					new Response(await createPdf("REMOVE HOSTED PDF")),
				);
				const hosted = await processor(original!, "openalex-pdf-a");
				await writeSourceIngestionBatch(database, {
					sourceConnectionKey: "openalex-pdf-a",
					expectedCursor: {},
					nextCursor: {},
					mappingProfileVersion: "test",
					fetchedAt: new Date(),
					items: [parent, hosted],
				});
				if (overlappingSource) {
					const shared = await processor(original!, "openalex-pdf-b");
					await writeSourceIngestionBatch(database, {
						sourceConnectionKey: "openalex-pdf-b",
						expectedCursor: {},
						nextCursor: {},
						mappingProfileVersion: "test",
						fetchedAt: new Date(),
						items: [parent, shared],
					});
					const [work] = await database.select({ key: item.key }).from(item).where(eq(item.itemType, "JournalArticle"));
					expect(await getSourceCitationMetrics(database, work!.key)).toEqual([
						expect.objectContaining({ sourceLabel: "Openscholar", citedByCount: 5 }),
					]);
				}
				await database
					.update(sourceConnection)
					.set({
						config: {
							name: "AI in education",
							searchUrl: "/results/saved-search-1",
							approvedQuery: {
								version: "v1",
								approvedAt: "2026-09-24T00:00:00Z",
								query: { search: "Research" },
							},
							downloadPdfs: false,
						},
					})
					.where(eq(sourceConnection.key, "openalex-pdf-a"));
				const sync = async () => {
					const [connection] = await database
						.select()
						.from(sourceConnection)
						.where(eq(sourceConnection.key, "openalex-pdf-a"));
					return syncOpenAlexSource(
						{
							database,
							sourceConnection: connection!,
							credentialResolver: async () => "test",
							heartbeat: async () => {},
						},
						{
							attachmentProcessor: processor,
							fetch: async () =>
								globalThis.Response.json({
									meta: { count: 1, next_cursor: null },
									results: [parent!.raw],
								}),
						},
					);
				};
				await sync();
				if (overlappingSource) {
					expect(
						await database.select().from(itemFilePublication),
					).toHaveLength(1);
					expect(storage.publicFiles.size).toBe(2);
					await database
						.update(sourceConnection)
						.set({ config: { downloadPdfs: false } })
						.where(eq(sourceConnection.key, "openalex-pdf-b"));
					await sync();
				}
				expect(
					await database.select().from(itemFilePublication),
				).toEqual([]);
				expect(await database.select().from(sourceFileCleanup)).toEqual(
					[],
				);
				expect(storage.publicFiles.size).toBe(0);
				expect(
					(
						await database
							.select()
							.from(item)
							.where(eq(item.itemType, "Attachment"))
					)[0]?.url,
				).toBe(externalUrl);
			});
		},
		120_000,
	);
	it.each([true, false])(
		"lets an opted-in overlapping search host a PDF without an URL-only search removing it, existing attachment %s",
		async (hasAttachment) => {
			await withIsolatedPublicationDatabase(async (database) => {
				await sources(database);
				const storage = new MemoryFileStorage();
				const processor = createOpenAlexAttachmentProcessor({
					database,
					storage,
					maxPdfBytes: 1_000_000,
				});
				const [parent, original] = mapped();
				const write = (sourceConnectionKey: string, items: unknown[]) =>
					writeSourceIngestionBatch(database, {
						sourceConnectionKey,
						expectedCursor: {},
						nextCursor: {},
						mappingProfileVersion: "test",
						fetchedAt: new Date(),
						items,
					});
				await write(
					"openalex-pdf-a",
					hasAttachment ? [parent, original] : [parent],
				);
				vi.mocked(transport).mockResolvedValueOnce(
					new Response(await createPdf("SHARED PDF")),
				);
				const hosted = await processor(original!, "openalex-pdf-b");
				await write("openalex-pdf-b", [parent, hosted]);
				expect(
					(await database.select().from(itemFilePublication))[0]
						?.sourceConnectionKey,
				).toBe("openalex-pdf-b");
				await write(
					"openalex-pdf-a",
					mapped(externalUrl, "2026-09-25T00:00:00Z"),
				);
				expect(
					(
						await database
							.select()
							.from(item)
							.where(eq(item.itemType, "Attachment"))
					)[0]?.url,
				).toBe(hosted.file!.url);
				expect(
					await database.select().from(itemFilePublication),
				).toHaveLength(1);
				await processor.flushCleanup("openalex-pdf-a");
				expect(storage.publicFiles.size).toBe(2);
			});
		},
		120_000,
	);
	it("publishes actual PDF bytes, consumes staging in the writer and reuses an unchanged publication", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const bytes = await createPdf("OPENALEX PDF TEXT");
			vi.mocked(transport).mockResolvedValueOnce(
				new Response(bytes, {
					headers: { "content-type": "application/pdf" },
				}),
			);
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({
				database,
				storage,
				maxPdfBytes: 1_000_000,
			});
			const [parent, original] = mapped();
			const processed = await processor(original!, "openalex-pdf-a");
			expect(processed.raw).toEqual(original!.raw);
			expect(processed.file).toMatchObject({
				contentType: "application/pdf",
				filename: "W123.pdf",
				linkMode: "imported_url",
				md5: createHash("md5").update(bytes).digest("hex"),
				coverWidth: 1600,
				managedPublication: {
					pageCount: 1,
					sha256: fileHash(bytes),
					sizeBytes: bytes.byteLength,
					staged: true,
				},
			});
			expect(processed.file!.fullText).toContain("OPENALEX PDF TEXT");
			const publication = processed.file!.managedPublication!;
			expect(publication.objectPath).toContain(
				`sources/openalex/openalex-pdf-a/W123:pdf/${fileHash(bytes)}/`,
			);
			expect(
				await storage.downloadPublic(publication.objectPath),
			).toEqual(bytes);
			expect(
				Buffer.from(
					await storage.downloadPublic(publication.coverObjectPath),
				).subarray(0, 3),
			).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
			expect(
				await database.select().from(sourceFileCleanup),
			).toHaveLength(2);
			await writeSourceIngestionBatch(database, {
				sourceConnectionKey: "openalex-pdf-a",
				expectedCursor: {},
				nextCursor: { completed: true },
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				items: [parent, processed],
			});
			expect(
				await database.select().from(itemFilePublication),
			).toHaveLength(1);
			expect(
				await database.select().from(sourceFileCleanup),
			).toHaveLength(0);
			await processor.flushCleanup("openalex-pdf-a");
			expect(storage.publicFiles.size).toBe(2);

			vi.mocked(transport).mockRejectedValue(
				new Error("Unexpected repeat download"),
			);
			const reused = await processor(original!, "openalex-pdf-a");
			expect(reused.processingIssue).toBeNull();
			expect(reused.file).toEqual({
				...processed.file,
				managedPublication: { ...publication, staged: false },
			});
			expect(transport).toHaveBeenCalledTimes(1);

			// The records stage keeps a published PDF without downloading. OpenAlex
			// bumps the version for any metadata change, and the same PDF URL keeps
			// both the file and the new version, so the PDF stage skips it too.
			const kept = await processor.reuse(original!, "openalex-pdf-a");
			expect(kept.remoteVersion).toBe(original!.remoteVersion);
			expect(kept.file!.managedPublication).toEqual({ ...publication, staged: false });
			const bumped = mapped(externalUrl, "2026-09-25T00:00:00Z")[1]!;
			const refreshed = await processor.reuse(bumped, "openalex-pdf-a");
			expect(refreshed.remoteVersion).toBe(bumped.remoteVersion);
			expect(refreshed.file!.managedPublication).toEqual({ ...publication, staged: false });
			expect((await processor(bumped, "openalex-pdf-a")).file!.managedPublication).toEqual({ ...publication, staged: false });
			expect(transport).toHaveBeenCalledTimes(1);

			// A new PDF URL keeps the file but loses its version, so the PDF stage
			// downloads again. Identical bytes must not restage active objects.
			const moved = mapped("https://93.184.216.34/moved.pdf", "2026-09-26T00:00:00Z")[1]!;
			const flagged = await processor.reuse(moved, "openalex-pdf-a");
			expect(flagged.remoteVersion).toBeNull();
			expect(flagged.file!.managedPublication).toEqual({ ...publication, staged: false });
			await writeSourceIngestionBatch(database, {
				sourceConnectionKey: "openalex-pdf-a",
				expectedCursor: { completed: true },
				nextCursor: { completed: true, again: true },
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				items: [parent, flagged],
			});
			vi.mocked(transport).mockResolvedValueOnce(new Response(bytes));
			storage.publicUploadHook = async () => {
				throw new Error("Unexpected repeated upload");
			};
			const updated = await processor(moved, "openalex-pdf-a");
			expect(transport).toHaveBeenCalledTimes(2);
			expect(updated.processingIssue).toBeNull();
			expect(updated.file!.managedPublication).toEqual({
				...publication,
				staged: false,
			});
			expect(
				await database.select().from(sourceFileCleanup),
			).toHaveLength(0);
		});
	}, 120_000);

	it("keeps the external link on upload failure and cleans only that source's staged files", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const bytes = await createPdf("PRESERVED SOURCE PDF");
			vi.mocked(transport).mockImplementation(
				async () => new Response(bytes),
			);
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({
				database,
				storage,
				maxPdfBytes: 1_000_000,
			});
			const [parent, original] = mapped();
			const saved = await processor(original!, "openalex-pdf-a");
			await writeSourceIngestionBatch(database, {
				sourceConnectionKey: "openalex-pdf-a",
				expectedCursor: {},
				nextCursor: {},
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				items: [parent, saved],
			});
			const savedPaths = [...storage.publicFiles.keys()].sort();
			storage.publicUploadHook = async () => {
				throw new Error("Storage upload failed");
			};
			const other = mapped(externalUrl, undefined, 456)[1]!;
			const failed = await processor(other, "openalex-pdf-b");
			expect(failed.file).toEqual(other.file);
			expect(failed.raw).toEqual(other.raw);
			expect(failed.processingIssue).toMatchObject({
				code: "openalex_pdf_storage_failed",
			});
			expect(failed.processingIssue!.message).toContain(
				"Storage upload failed",
			);
			expect(
				await database
					.select()
					.from(sourceFileCleanup)
					.where(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							"openalex-pdf-b",
						),
					),
			).toHaveLength(2);
			await processor.flushCleanup("openalex-pdf-b");
			expect([...storage.publicFiles.keys()].sort()).toEqual(savedPaths);
			expect(
				await database.select().from(sourceFileCleanup),
			).toHaveLength(0);
		});
	}, 120_000);

	it("contains blocked URLs, oversized downloads and invalid PDFs as record issues without staging files", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({
				database,
				storage,
				maxPdfBytes: 20,
			});
			const privateRecord = mapped("http://127.0.0.1/private.pdf")[1]!;
			const blocked = await processor(privateRecord, "openalex-pdf-a");
			expect(blocked.file).toEqual(privateRecord.file);
			expect(blocked.processingIssue?.code).toBe(
				"openalex_pdf_download_failed",
			);
			expect(transport).not.toHaveBeenCalled();
			vi.mocked(transport).mockResolvedValueOnce(
				new Response(await createPdf("LARGER THAN TWENTY BYTES")),
			);
			const original = mapped()[1]!;
			const oversized = await processor(original, "openalex-pdf-a");
			expect(oversized.file).toEqual(original.file);
			expect(oversized.processingIssue).toMatchObject({
				code: "openalex_pdf_download_failed",
			});
			expect(oversized.processingIssue!.message).toContain("too large");
			// A file that starts and ends as a PDF and holds no document is downloaded, and then cannot be read.
			const hollow = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
			const unreadable = Buffer.concat([hollow, Buffer.from(`xref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n${hollow.byteLength}\n%%EOF\n`)]);
			vi.mocked(transport).mockResolvedValueOnce(new Response(unreadable));
			const roomy = createOpenAlexAttachmentProcessor({ database, storage, maxPdfBytes: 1_000_000 });
			const [, another] = mapped(`${externalUrl}?hollow`, "2026-09-24T01:02:03Z", 127);
			const invalid = await roomy(another!, "openalex-pdf-a");
			expect(invalid.file).toEqual(another!.file);
			expect(invalid.processingIssue?.code).toBe("openalex_pdf_invalid");
			expect(storage.publicFiles.size).toBe(0);
			expect(
				await database.select().from(sourceFileCleanup),
			).toHaveLength(0);
		});
	}, 120_000);

	it("keeps a withdrawn record's hosted PDF withdrawn until the record is published again", async () => {
		await withIsolatedPublicationDatabase(async (database) => {
			await sources(database);
			const storage = new MemoryFileStorage();
			const processor = createOpenAlexAttachmentProcessor({
				database,
				storage,
				maxPdfBytes: 1_000_000,
			});
			const [parent, original] = mapped();
			vi.mocked(transport).mockResolvedValueOnce(
				new Response(await createPdf("HOSTED PDF")),
			);
			const hosted = await processor(original!, "openalex-pdf-a");
			const write = () =>
				writeSourceIngestionBatch(database, {
					sourceConnectionKey: "openalex-pdf-a",
					expectedCursor: {},
					nextCursor: {},
					mappingProfileVersion: "test",
					fetchedAt: new Date(),
					items: [parent, hosted],
				});
			const { itemKeys } = await write();
			const hostedPaths = [...storage.publicFiles.keys()].sort();
			expect(hostedPaths).toHaveLength(2);

			await unpublishNativeItem(database, itemKeys.W123!);
			expect(
				(await database.select().from(sourceFileCleanup))
					.map((row) => row.objectPath)
					.sort(),
			).toEqual(hostedPaths);
			await processor.flushCleanup("openalex-pdf-a");
			expect(storage.publicFiles.size).toBe(0);
			await write();
			expect(
				(await database.select().from(item)).map((row) => row.deleted),
			).toEqual([1, 1]);
			expect(await database.select().from(itemFilePublication)).toEqual([]);

			const completed = { completedAt: "2026-09-25T00:00:00Z", reconciledAt: "2026-09-25T00:00:00Z" };
			await database.update(sourceConnection).set({ syncCursor: completed }).where(eq(sourceConnection.key, "openalex-pdf-a"));
			await openItemDraft(database, itemKeys.W123!, policy);
			await publishItemDraft(database, itemKeys.W123!, policy);
			const [connection] = await database.select().from(sourceConnection).where(eq(sourceConnection.key, "openalex-pdf-a"));
			expect(connection!.syncCursor).toEqual({ ...completed, reconciledAt: null });
			vi.mocked(transport).mockResolvedValueOnce(new Response(await createPdf("HOSTED PDF")));
			await writeSourceIngestionBatch(database, {
				sourceConnectionKey: "openalex-pdf-a", expectedCursor: connection!.syncCursor, nextCursor: {}, mappingProfileVersion: "test", fetchedAt: new Date(),
				items: [parent, await processor(original!, "openalex-pdf-a")],
			});
			expect((await database.select().from(item)).map((row) => row.deleted)).toEqual([0, 0]);
			expect(await database.select().from(itemFilePublication)).toHaveLength(1);
		});
	}, 120_000);
});
