import { describe, expect, it } from "vitest";

import {
	buildPublicationFileManifest,
	buildPublicationIdentifiers,
	buildPublicationRecordSnapshot,
	type EvidenceLibraryPublicationRecord,
} from "@/lib/publication/record-adapter";

function record(
	changes: Partial<EvidenceLibraryPublicationRecord> = {},
): EvidenceLibraryPublicationRecord {
	return {
		key: "ABCDEFGH",
		revision: 3,
		itemType: "JournalArticle",
		title: "  A   useful study  ",
		date: "2024",
		abstractNote: "  A   summary ",
		languageName: "eng",
		publisher: "Publisher",
		institution: "Institute",
		rights: "Copyright holder",
		creators: [
			{
				creatorType: "author",
				firstName: "Ada",
				lastName: "Lovelace",
				institutions: [{ display_name: "Analytical Society" }],
			},
		],
		createdAt: new Date("2020-05-06T00:00:00Z"),
		dateAdded: new Date("2021-06-07T00:00:00Z"),
		publicationTitle: "Research Journal",
		volume: "12",
		sourceConnectionKey: "zotero-example",
		updatedAt: new Date("2026-08-12T00:00:00Z"),
		...changes,
	};
}

describe("publication record adapter", () => {
	it("builds a stable provider-neutral snapshot from the canonical record", () => {
		expect(
			buildPublicationRecordSnapshot({
				record: record(),
				tags: [" Evidence ", "_r:doi", "internal", "Evidence"],
				baseUrl: "https://library.example.org",
				license: "cc-by-4.0",
			}),
		).toEqual({
			recordKey: "ABCDEFGH",
			canonicalRevision: 3,
			landingUrl: "https://library.example.org/lib/ABCDEFGH",
			itemType: "JournalArticle",
			title: "A useful study",
			publicationDate: "2024-01-01",
			abstract: "A summary",
			language: "eng",
			publisher: "Publisher",
			institution: "Institute",
			rights: "Copyright holder",
			license: "cc-by-4.0",
			creators: [
				{
					type: "personal",
					name: "Lovelace, Ada",
					creatorType: "author",
					givenName: "Ada",
					familyName: "Lovelace",
					affiliation: "Analytical Society",
				},
			],
			tags: ["Evidence"],
			fields: {
				publicationTitle: "Research Journal",
				volume: "12",
			},
		});
	});

	it("uses the stable creation date when the record has no publication date", () => {
		const withoutDate = record({ date: null, dateAdded: null });
		expect(
			buildPublicationRecordSnapshot({
				record: withoutDate,
				tags: [],
				baseUrl: "https://library.example.org",
				license: "cc-by-4.0",
			}).publicationDate,
		).toBe("2020-05-06");
	});

	it("does not leak database or source bookkeeping into provider fields", () => {
		const snapshot = buildPublicationRecordSnapshot({
			record: record(),
			tags: [],
			baseUrl: "https://library.example.org",
			license: "cc-by-4.0",
		});
		expect(snapshot.fields).not.toHaveProperty("sourceConnectionKey");
		expect(snapshot.fields).not.toHaveProperty("updatedAt");
	});

	it("rejects incomplete creators with a useful message", () => {
		expect(() =>
			buildPublicationRecordSnapshot({
				record: record({
					creators: [{ creatorType: "author", firstName: "Ada" }],
				}),
				tags: [],
				baseUrl: "https://library.example.org",
				license: "cc-by-4.0",
			}),
		).toThrow("Creator 1 needs a family name");
	});

	it("maps published file rows and normalized identifiers", () => {
		expect(
			buildPublicationFileManifest([
				{
					itemKey: "FILE0001",
					revision: 2,
					filename: "paper.pdf",
					contentType: "application/pdf",
					sizeBytes: 123,
					sha256: "a".repeat(64),
				},
			]),
		).toEqual({
			files: [
				{
					fileKey: "FILE0001",
					publicationRevision: 2,
					filename: "paper.pdf",
					contentType: "application/pdf",
					size: 123,
					sha256: "a".repeat(64),
				},
			],
		});
		expect(
			buildPublicationIdentifiers({
				bibliographicDoi: "https://doi.org/10.1234/Example",
				managedCrossrefDoi: "10.1234/example",
			}),
		).toEqual({
			bibliographicDoi: "10.1234/example",
			managedCrossrefDoi: "10.1234/example",
		});
	});
});
