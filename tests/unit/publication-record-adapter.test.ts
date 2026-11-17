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
				libraryLicense: "cc-by-4.0",
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
			rights: "Copyright holder",
			license: "cc-by-4.0",
			creators: [
				{
					type: "personal",
					name: "Lovelace, Ada",
					creatorType: "author",
					givenName: "Ada",
					familyName: "Lovelace",
					affiliations: [{ name: "Analytical Society" }],
				},
			],
			tags: ["Evidence"],
			fields: {
				publicationTitle: "Research Journal",
				volume: "12",
			},
		});
	});

	it("deposits the record's own licence, and refuses a new DOI for a record with none", () => {
		const sent = (licence: EvidenceLibraryPublicationRecord["licence"], libraryLicense: string | null) => {
			const snapshot = buildPublicationRecordSnapshot({ record: record({ licence }), tags: [], baseUrl: "https://library.example.org", libraryLicense });
			return { license: snapshot.license, customLicense: snapshot.customLicense };
		};
		// The record's licence wins over the library's, which only covers a record registered before records had one.
		expect(sent({ kind: "zenodo", id: "cc-by-nc-4.0" }, "cc-by-4.0")).toEqual({ license: "cc-by-nc-4.0", customLicense: undefined });
		expect(sent({ kind: "custom", title: "Open Government Licence v3.0", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" }, null)).toEqual({
			license: undefined,
			customLicense: { title: "Open Government Licence v3.0", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
		});
		expect(() => sent(null, null)).toThrow(/licence/u);
		expect(() => sent({ kind: "custom", title: "Our terms", url: "" }, "cc-by-4.0")).toThrow(/licence/u);
	});

    it.each([null, "not-a-date"])("never invents a publication date from record creation for %s", date => {
        if (date === null) {
            expect(() => buildPublicationRecordSnapshot({record: record({date}), tags: [], baseUrl: "https://library.example.org", libraryLicense: "cc-by-4.0"})).toThrow();
        } else {
            expect(buildPublicationRecordSnapshot({record: record({date}), tags: [], baseUrl: "https://library.example.org", libraryLicense: "cc-by-4.0"}).publicationDate).toBe(date);
        }
    });

	it("sends a language written out as its code, and a code or other text as stored", () => {
		const sent = (languageName: string) =>
			buildPublicationRecordSnapshot({ record: record({ languageName }), tags: [], baseUrl: "https://library.example.org", libraryLicense: "cc-by-4.0" }).language;
		// The registrars take codes. A code is left alone so a registered record reads as it did; text that names no language is theirs to refuse.
		expect(["English", "eng", "en-GB", "English; French"].map(sent)).toEqual(["en", "eng", "en-GB", "English; French"]);
	});

	it("does not leak database or source bookkeeping into provider fields", () => {
		const snapshot = buildPublicationRecordSnapshot({
			record: record(),
			tags: [],
			baseUrl: "https://library.example.org",
			libraryLicense: "cc-by-4.0",
		});
		expect(snapshot.fields).not.toHaveProperty("sourceConnectionKey");
		expect(snapshot.fields).not.toHaveProperty("updatedAt");
	});

	it("uses the Zotero record institution field independently of author affiliations", () => {
		const snapshot = (itemType: string) =>
			buildPublicationRecordSnapshot({
				record: record({ itemType, publisher: "Record Institute" }),
				tags: [],
				baseUrl: "https://library.example.org",
				libraryLicense: "cc-by-4.0",
			});

		expect(snapshot("Report").institution).toBe("Record Institute");
		expect(snapshot("Thesis").institution).toBe("Record Institute");
		expect(snapshot("JournalArticle")).not.toHaveProperty("institution");
		expect(snapshot("Standard")).not.toHaveProperty("institution");
		expect(snapshot("Report").creators[0]?.affiliations).toEqual([
			{ name: "Analytical Society" },
		]);
	});

	it("carries every field a record holds: affiliations by ROR and country, topics, design, places, pages, its file and the records it cites", () => {
		const snapshot = buildPublicationRecordSnapshot({
			record: record({
				creators: [
					{ creatorType: "author", firstName: "Ada", lastName: "Lovelace", institutions: [{ id: "https://openalex.org/I4210087849", display_name: "University of Rwanda", country_code: "rw" }, { display_name: "Analytical Society" }] },
					{ creatorType: "editor", firstName: "Grace", lastName: "Hopper" },
				],
				numPages: "12",
			}),
			tags: [],
			baseUrl: "https://library.example.org",
			libraryLicense: "cc-by-4.0",
			extras: {
				links: [
					{ kind: "cites", key: "CITED001", doi: "10.1000/cited.1" },
					{ kind: "cites", key: "NODOI001", doi: null },
					{ kind: "related", key: "RELATED1", doi: "10.1000/related.1" },
				],
				topicNames: ["Climate change impacts on agriculture"],
				// Read from the record, as readers see them: no editor chose either.
				studyType: "meta-analysis",
				countries: ["RW", "eastern_africa"],
				institutions: { "university of rwanda": { ror: "https://ror.org/00286hs46", country: "RW" } },
				fullTextUrl: "https://library.example.org/api/item/ABCDEFGH/download/PDF00001",
				formats: ["application/pdf"],
			},
		});

		expect(snapshot.creators).toEqual([
			{ type: "personal", name: "Lovelace, Ada", creatorType: "author", givenName: "Ada", familyName: "Lovelace", affiliations: [{ name: "University of Rwanda", ror: "00286hs46", country: "RW" }, { name: "Analytical Society" }] },
			{ type: "personal", name: "Hopper, Grace", creatorType: "editor", givenName: "Grace", familyName: "Hopper" },
		]);
		expect(snapshot).toMatchObject({
			subjects: ["Climate change impacts on agriculture"],
			methods: "Meta-analysis",
			locations: [{ place: "Rwanda", country: "RW" }, { place: "Eastern Africa" }],
			pages: 12,
			formats: ["application/pdf"],
			fullTextUrl: "https://library.example.org/api/item/ABCDEFGH/download/PDF00001",
			references: ["10.1000/cited.1"],
			relations: [{ type: "isRelatedMaterial", identifierType: "doi", identifier: "10.1000/related.1" }],
		});
	});

	it("rejects incomplete creators with a useful message", () => {
		expect(() =>
			buildPublicationRecordSnapshot({
				record: record({
					creators: [{ creatorType: "author", firstName: "Ada" }],
				}),
				tags: [],
				baseUrl: "https://library.example.org",
				libraryLicense: "cc-by-4.0",
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
					md5: "b".repeat(32),
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
