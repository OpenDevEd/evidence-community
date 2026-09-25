import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { fetch as transport, Response } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("undici", async (importOriginal) => ({
	...(await importOriginal<typeof import("undici")>()),
	fetch: vi.fn(),
}));

import type { Database } from "@/db/database-schema";
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
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
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
});

describe("OpenAlex PDF processing", () => {
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
						expect.objectContaining({ sourceLabel: "OpenAlex", citedByCount: 5 }),
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
				).subarray(0, 8),
			).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
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

			// A metadata update with identical PDF bytes must not restage active objects.
			vi.mocked(transport).mockResolvedValueOnce(new Response(bytes));
			storage.publicUploadHook = async () => {
				throw new Error("Unexpected repeated upload");
			};
			const updated = await processor(
				mapped(externalUrl, "2026-09-25T00:00:00Z")[1]!,
				"openalex-pdf-a",
			);
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
				new Response("x".repeat(21)),
			);
			const original = mapped()[1]!;
			const oversized = await processor(original, "openalex-pdf-a");
			expect(oversized.file).toEqual(original.file);
			expect(oversized.processingIssue).toMatchObject({
				code: "openalex_pdf_download_failed",
			});
			expect(oversized.processingIssue!.message).toContain("too large");
			vi.mocked(transport).mockResolvedValueOnce(
				new Response("Not a PDF"),
			);
			const invalid = await processor(original, "openalex-pdf-a");
			expect(invalid.file).toEqual(original.file);
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
