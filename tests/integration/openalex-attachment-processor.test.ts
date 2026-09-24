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
import {
	itemFilePublication,
	sourceConnection,
	sourceFileCleanup,
} from "@/db/schema/source";
import { createOpenAlexAttachmentProcessor } from "@/lib/source-ingestion/openalex/attachment-processor";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import {
	MemoryFileStorage,
	createPdf,
	fileHash,
} from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const externalUrl = "https://93.184.216.34/research.pdf";

function mapped(url = externalUrl, version = "2026-09-24T01:02:03Z") {
	return mapOpenAlexWork({
		id: "https://openalex.org/W123",
		title: "Research",
		type: "article",
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
		{ key: "openalex-pdf-a", provider: "openalex", scopeKind: "query" },
		{ key: "openalex-pdf-b", provider: "openalex", scopeKind: "query" },
	]);
}

beforeEach(() => {
	vi.mocked(transport).mockReset();
});

describe("OpenAlex PDF processing", () => {
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
			const failed = await processor(original!, "openalex-pdf-b");
			expect(failed.file).toEqual(original!.file);
			expect(failed.raw).toEqual(original!.raw);
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
});
