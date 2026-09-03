import { createHash } from "node:crypto";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database-schema";
import type {
	EvidenceFileStorage,
	SignedFileUpload,
} from "@/lib/admin/file-storage";
import {
	MAX_SOURCE_RECORD_BYTES,
	sourceIngestionBatchSchema,
} from "@/lib/source-ingestion/batch-schema";
import {
	MAX_ZOTERO_FULL_TEXT_BYTES,
	ZoteroAttachmentProcessingError,
	createZoteroAttachmentProcessor,
	sourcePublicationPaths,
	truncateUtf8,
} from "@/lib/source-ingestion/zotero/attachment-processor";
import type { ZoteroApiClient } from "@/lib/source-ingestion/zotero/client";
import {
	fitZoteroFullTextToRecordLimit,
	mapZoteroItem,
	ZoteroAttachmentPermanentError,
} from "@/lib/source-ingestion/zotero/mapper";
import type { ZoteroItemResponse } from "@/lib/source-ingestion/zotero/schema";

class MemoryStorage implements EvidenceFileStorage {
	readonly publicObjects = new Map<string, Uint8Array>();
	readonly removedPublicPaths: string[][] = [];

	async createSignedUpload(): Promise<SignedFileUpload> {
		throw new Error("not used");
	}

	async downloadPrivate(): Promise<Uint8Array> {
		throw new Error("not used");
	}

	async downloadPublic(path: string): Promise<Uint8Array> {
		const bytes = this.publicObjects.get(path);
		if (!bytes) throw new Error("not found");
		return bytes;
	}

	async uploadPrivate(): Promise<void> {
		throw new Error("not used");
	}

	async uploadPublic(path: string, data: Uint8Array): Promise<void> {
		this.publicObjects.set(path, data);
	}

	publicUrl(path: string) {
		return `https://storage.example.org/${path}`;
	}

	async removePrivate(): Promise<void> {
		throw new Error("not used");
	}

	async removePublic(paths: string[]): Promise<void> {
		this.removedPublicPaths.push(paths);
		for (const path of paths) this.publicObjects.delete(path);
	}
}

function publicationDatabase(rows: Record<string, unknown>[] = []) {
	return {
		insert: () => ({
			values: () => ({ onConflictDoUpdate: async () => undefined }),
		}),
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					leftJoin: () => ({
						where: () => ({ limit: async () => rows }),
					}),
				}),
			}),
		}),
	} as unknown as Database;
}

async function fixturePdf() {
	const document = await PDFDocument.create();
	const page = document.addPage([612, 792]);
	const font = await document.embedFont(StandardFonts.Helvetica);
	page.drawText("OPENSCHOLAR ATTACHMENT PROCESSOR TOKEN", {
		font,
		size: 14,
		x: 50,
		y: 700,
	});
	return document.save({ useObjectStreams: false });
}

function attachment(
	overrides: Record<string, unknown> = {},
): ZoteroItemResponse {
	return {
		data: {
			itemType: "attachment",
			parentItem: "PARENT01",
			contentType: "application/pdf",
			filename: "fixture.pdf",
			linkMode: "imported_file",
			mtime: "1785974400000",
			tags: [{ tag: "purple-publish" }],
			...overrides,
		},
		key: "ATTACH01",
		version: 1,
	};
}

describe("Zotero attachment publication", () => {
	it("keeps untagged PDFs metadata-only without downloading or publishing", async () => {
		const storage = new MemoryStorage();
		const downloadAttachment = vi.fn();
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase(),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage,
		});
		const result = await processor(
			attachment({ md5: "a".repeat(32), tags: [{ tag: "private" }] }),
			{
				client: { downloadAttachment } as unknown as ZoteroApiClient,
				prefix: "groups/6632364",
				sourceConnectionKey: "zotero-openscholar-test",
			},
		);
		expect(result).toMatchObject({
			url: null,
			fullText: null,
			coverUrl: null,
			managedPublication: null,
		});
		expect(downloadAttachment).not.toHaveBeenCalled();
		expect(storage.publicObjects.size).toBe(0);
	});

	it("downloads, verifies, processes, and publishes a tagged PDF", async () => {
		const bytes = await fixturePdf();
		const md5 = createHash("md5").update(bytes).digest("hex");
		const storage = new MemoryStorage();
		const downloadAttachment = vi.fn().mockResolvedValue({
			bytes,
			contentType: "application/pdf",
			etag: md5,
		});
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase(),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage,
		});
		const result = await processor(attachment({ md5 }), {
			client: { downloadAttachment } as unknown as ZoteroApiClient,
			prefix: "groups/6632364",
			sourceConnectionKey: "zotero-openscholar-test",
		});
		const paths = sourcePublicationPaths(
			"zotero-openscholar-test",
			"ATTACH01",
			md5,
		);
		expect(downloadAttachment).toHaveBeenCalledWith(
			"groups/6632364",
			"ATTACH01",
			10_000_000,
		);
		expect([...storage.publicObjects.keys()].sort()).toEqual(
			[paths.cover, paths.pdf].sort(),
		);
		expect(result).toMatchObject({
			url: `https://storage.example.org/${paths.pdf}`,
			coverUrl: `https://storage.example.org/${paths.cover}`,
			coverWidth: 1600,
			managedPublication: {
				objectPath: paths.pdf,
				coverObjectPath: paths.cover,
				pageCount: 1,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				sizeBytes: bytes.byteLength,
			},
		});
		expect(result?.fullText).toContain(
			"OPENSCHOLAR ATTACHMENT PROCESSOR TOKEN",
		);
	});

	it("rejects changed bytes instead of publishing mismatched content", async () => {
		const bytes = await fixturePdf();
		const storage = new MemoryStorage();
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase(),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage,
		});
		await expect(
			processor(attachment({ md5: "0".repeat(32) }), {
				client: {
					downloadAttachment: vi.fn().mockResolvedValue({ bytes }),
				} as unknown as ZoteroApiClient,
				prefix: "groups/6632364",
				sourceConnectionKey: "zotero-openscholar-test",
			}),
		).rejects.toBeInstanceOf(ZoteroAttachmentProcessingError);
		expect(storage.publicObjects.size).toBe(0);
	});

	it("reuses a matching managed publication without downloading", async () => {
		const md5 = "a".repeat(32);
		const paths = sourcePublicationPaths(
			"zotero-openscholar-test",
			"ATTACH01",
			md5,
		);
		const downloadAttachment = vi.fn();
		const storage = new MemoryStorage();
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase([
				{
					contentType: "application/pdf",
					coverHeight: 2000,
					coverObjectPath: paths.cover,
					coverUrl: `https://storage.example.org/${paths.cover}`,
					coverWidth: 1600,
					filename: "old-name.pdf",
					fullText: "Existing extracted text",
					linkMode: "imported_file",
					md5,
					mtime: "1",
					objectPath: paths.pdf,
					pageCount: 2,
					sha256: "b".repeat(64),
					sizeBytes: 900,
					url: `https://storage.example.org/${paths.pdf}`,
				},
			]),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage,
		});
		const result = await processor(
			attachment({ filename: "new-name.pdf", md5 }),
			{
				client: { downloadAttachment } as unknown as ZoteroApiClient,
				prefix: "groups/6632364",
				sourceConnectionKey: "zotero-openscholar-test",
			},
		);
		expect(downloadAttachment).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			filename: "new-name.pdf",
			fullText: "Existing extracted text",
			managedPublication: { objectPath: paths.pdf },
		});
	});

	it("accepts a published linked URL without downloading or managing it", async () => {
		const downloadAttachment = vi.fn();
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase(),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage: new MemoryStorage(),
		});
		const mapped = await mapZoteroItem(
			attachment({
				filename: "linked.pdf",
				linkMode: "linked_url",
				md5: null,
				url: "https://library.example.org/evidence.pdf",
			}),
			processor,
			new Set(),
			{
				client: { downloadAttachment } as unknown as ZoteroApiClient,
				prefix: "groups/6632364",
				sourceConnectionKey: "zotero-openscholar-test",
			},
		);
		expect(mapped).toMatchObject({
			operation: "upsert",
			file: {
				filename: "linked.pdf",
				linkMode: "linked_url",
				managedPublication: null,
				url: "https://library.example.org/evidence.pdf",
			},
			processingIssue: null,
		});
		expect(downloadAttachment).not.toHaveBeenCalled();
	});

	it("contains a published linked URL without a URL as a record issue", async () => {
		const downloadAttachment = vi.fn();
		const processor = createZoteroAttachmentProcessor({
			database: publicationDatabase(),
			maxPdfBytes: 10_000_000,
			publishTags: ["purple-publish"],
			storage: new MemoryStorage(),
		});
		const mapped = await mapZoteroItem(
			attachment({ linkMode: "linked_url", md5: null, url: "" }),
			processor,
			new Set(),
			{
				client: { downloadAttachment } as unknown as ZoteroApiClient,
				prefix: "groups/6632364",
				sourceConnectionKey: "zotero-openscholar-test",
			},
		);
		expect(mapped).toMatchObject({
			file: {
				linkMode: "linked_url",
				managedPublication: null,
				url: null,
			},
			processingIssue: { code: "zotero_file_metadata_invalid" },
		});
		expect(downloadAttachment).not.toHaveBeenCalled();
	});

	it("bounds permanent attachment issue messages without wedging the batch", async () => {
		const mapped = await mapZoteroItem(attachment(), async () => {
			throw new ZoteroAttachmentPermanentError(
				"zotero_file_unavailable",
				`  ${"x".repeat(5_000)}  `,
				null,
			);
		});
		expect(mapped.operation).toBe("upsert");
		if (mapped.operation !== "upsert") return;
		expect(mapped.processingIssue?.message).toHaveLength(4096);
		expect(
			sourceIngestionBatchSchema.safeParse({
				sourceConnectionKey: "zotero-test",
				expectedCursor: {},
				nextCursor: { version: 1 },
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				collections: [],
				items: [mapped],
			}).success,
		).toBe(true);
	});
});

describe("Zotero attachment bounds", () => {
	it("truncates UTF-8 without splitting a code point", () => {
		expect(truncateUtf8("abc🙂def", 6)).toBe("abc");
		expect(
			Buffer.byteLength(
				truncateUtf8(
					"x".repeat(MAX_ZOTERO_FULL_TEXT_BYTES + 10),
					MAX_ZOTERO_FULL_TEXT_BYTES,
				),
			),
		).toBe(MAX_ZOTERO_FULL_TEXT_BYTES);
	});

	it("rejects managed publication metadata without the public bundle", () => {
		const parsed = sourceIngestionBatchSchema.safeParse({
			sourceConnectionKey: "zotero-test",
			expectedCursor: {},
			nextCursor: { version: 1 },
			mappingProfileVersion: "test",
			fetchedAt: new Date(),
			collections: [],
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "ATTACH01",
					remoteVersion: "1",
					raw: {},
					metadata: { itemType: "Attachment" },
					file: {
						managedPublication: {
							objectPath: "source/document.pdf",
							coverObjectPath: "source/cover.png",
							sizeBytes: 10,
							sha256: "a".repeat(64),
							pageCount: 1,
							staged: true,
						},
					},
				},
			],
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.map(({ message }) => message)).toContain(
				"managedPublication requires PDF metadata, public file, cover, dimensions, and extracted text",
			);
		}
	});

	it("fits escaped full text against the serialized source-record limit", () => {
		const record = {
			operation: "upsert" as const,
			sourceRecordKey: "ATTACH01",
			remoteVersion: "1",
			raw: { padding: "r".repeat(450_000) },
			metadata: { itemType: "Attachment" },
			parentSourceRecordKey: null,
			collections: [],
			aliases: [],
			citationMetric: null,
			referencedSourceRecordKeys: [],
			processingIssue: null,
			file: {
				url: null,
				contentType: "application/pdf",
				filename: "fixture.pdf",
				linkMode: "imported_file",
				md5: "a".repeat(32),
				mtime: null,
				charset: null,
				fullText: '\n"\\'.repeat(500_000),
				coverUrl: null,
				coverWidth: null,
				coverHeight: null,
				managedPublication: null,
			},
			sourceDates: null,
		};
		const fitted = fitZoteroFullTextToRecordLimit(record);
		expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(
			MAX_SOURCE_RECORD_BYTES,
		);
		if (fitted.operation !== "upsert")
			throw new Error("Expected an upsert");
		expect(fitted.file?.fullText?.length).toBeLessThan(
			record.file.fullText.length,
		);
	});

	it("contains oversized Zotero raw records as durable issues", () => {
		const fitted = fitZoteroFullTextToRecordLimit({
			operation: "upsert",
			sourceRecordKey: "OVERSIZE",
			remoteVersion: "1",
			raw: { payload: "x".repeat(MAX_SOURCE_RECORD_BYTES + 1) },
			metadata: { itemType: "Report", title: "Oversized report" },
			parentSourceRecordKey: null,
			collections: [],
			aliases: [],
			citationMetric: null,
			referencedSourceRecordKeys: [],
			file: null,
			processingIssue: null,
			sourceDates: null,
		});
		expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(
			MAX_SOURCE_RECORD_BYTES,
		);
		expect(fitted).toMatchObject({
			processingIssue: { code: "zotero_record_too_large" },
			raw: { _openscholarTruncated: true },
		});
	});
});
