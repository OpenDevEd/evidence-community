import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PublicationFile } from "@opendeved/doi-sync-core";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import {
	createPublicationFileReader,
	PublicationFileUnavailableError,
} from "@/lib/publication/publication-file-adapter";
import type { PublicationRepositorySnapshot } from "@/lib/publication/repository";

const bytes = new Uint8Array([1, 2, 3]);
const downloadPublic = vi.fn(async () => bytes);
const storage = { downloadPublic } as unknown as EvidenceFileStorage;

function row(
	changes: Partial<PublicationRepositorySnapshot["files"][number]> = {},
): PublicationRepositorySnapshot["files"][number] {
	return {
		itemKey: "PDFABCDE",
		sourceConnectionKey: "native",
		parentItemKey: "ABCDEFGH",
		uploadRevision: 2,
		revision: 3,
		sourceObjectPath: "private/PDFABCDE.pdf",
		sourceCoverObjectPath: "private/PDFABCDE.png",
		objectPath: "public/PDFABCDE.pdf",
		publicUrl: "https://files.example.org/PDFABCDE.pdf",
		filename: "study.pdf",
		contentType: "application/pdf",
		sizeBytes: 3,
		sha256: "a".repeat(64),
		md5: "b".repeat(32),
		coverObjectPath: "public/PDFABCDE.png",
		coverPublicUrl: "https://files.example.org/PDFABCDE.png",
		coverWidth: 100,
		coverHeight: 140,
		pageCount: 1,
		publicationTags: [],
		publishedAt: new Date("2026-08-13T00:00:00Z"),
		createdAt: new Date("2026-08-13T00:00:00Z"),
		updatedAt: new Date("2026-08-13T00:00:00Z"),
		...changes,
	};
}

function file(changes: Partial<PublicationFile> = {}): PublicationFile {
	return {
		fileKey: "PDFABCDE",
		publicationRevision: 3,
		filename: "study.pdf",
		contentType: "application/pdf",
		size: 3,
		sha256: "a".repeat(64),
		...changes,
	};
}

describe("publication file reader", () => {
	it("downloads the exact current public object", async () => {
		downloadPublic.mockClear();
		const reader = createPublicationFileReader(storage, [row()]);
		await expect(reader.readFile(file())).resolves.toEqual(bytes);
		expect(downloadPublic).toHaveBeenCalledWith("public/PDFABCDE.pdf");
	});

	it("does not fall back to an unpublished or missing object", async () => {
		const reader = createPublicationFileReader(storage, []);
		await expect(reader.readFile(file())).rejects.toThrow(
			PublicationFileUnavailableError,
		);
	});

	it.each([
		{ publicationRevision: 4 },
		{ filename: "different.pdf" },
		{ contentType: "text/plain" },
		{ size: 4 },
		{ sha256: "b".repeat(64) },
	] satisfies Array<Partial<PublicationFile>>)(
		"rejects a stale manifest: %j",
		async (change) => {
			const reader = createPublicationFileReader(storage, [row()]);
			await expect(reader.readFile(file(change))).rejects.toThrow(
				"changed after this Zenodo job was planned",
			);
		},
	);
});
