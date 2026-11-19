import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("admin file projections", () => {
	it("never exposes private draft fields or extracted text", async () => {
		const { fileDraftJson } =
			await import("@/lib/admin/file-projection");
		const projection = fileDraftJson({
			actualSha256: "actual",
			actualSizeBytes: 42,
			coverHeight: 1600,
			coverWidth: 1200,
			expectedSha256: "expected",
			expectedSizeBytes: 42,
			extractedText: "private extracted text",
			filename: "evidence.pdf",
			itemKey: "ABCDEFGH",
			objectPath: "private/file.pdf",
			pageCount: 1,
			readyAt: new Date("2026-07-30T12:00:00.000Z"),
			updatedAt: new Date("2026-07-30T12:00:00.000Z"),
			uploadRevision: 2,
		} as Parameters<typeof fileDraftJson>[0]);

		expect(projection).not.toHaveProperty("extractedText");
		expect(projection).not.toHaveProperty("objectPath");
		expect(projection).not.toHaveProperty("coverObjectPath");
		expect(projection?.readyAt).toBe("2026-07-30T12:00:00.000Z");
	});

	it("never exposes publication storage ownership fields", async () => {
		const { filePublicationJson } =
			await import("@/lib/admin/file-projection");
		const projection = filePublicationJson({
			coverObjectPath: "public/cover.png",
			coverPublicUrl: "https://example.test/cover.png",
			filename: "evidence.pdf",
			itemKey: "ABCDEFGH",
			objectPath: "public/file.pdf",
			pageCount: 1,
			publicUrl: "https://example.test/file.pdf",
			publishedAt: new Date("2026-07-30T12:00:00.000Z"),
			sha256: "hash",
			sizeBytes: 42,
			sourceCoverObjectPath: "private/cover.png",
			sourceObjectPath: "private/file.pdf",
			uploadRevision: 2,
		} as Parameters<typeof filePublicationJson>[0], false);

		expect(projection).not.toHaveProperty("objectPath");
		expect(projection).not.toHaveProperty("coverObjectPath");
		expect(projection).not.toHaveProperty("sourceObjectPath");
		expect(projection).not.toHaveProperty("sourceCoverObjectPath");
	});

	it("removes extracted full text from published item details", async () => {
		const { publishedItemJson } =
			await import("@/lib/admin/file-projection");
		const projection = publishedItemJson({
			fullTextPDF: "private extracted text",
			itemType: "Book",
			key: "ABCDEFGH",
			title: "Evidence",
			updatedAt: new Date("2026-07-30T12:00:00.000Z"),
		} as Parameters<typeof publishedItemJson>[0]);

		expect(projection).not.toHaveProperty("fullTextPDF");
		expect(projection).toMatchObject({
			key: "ABCDEFGH",
			title: "Evidence",
			updatedAt: "2026-07-30T12:00:00.000Z",
		});
	});
});
