import { describe, expect, it } from "vitest";

import {
	sourceRecordValidationOptions,
	validateNativeItemDraft,
} from "@/lib/admin/native-item-validation";
import { sourceIngestionBatchSchema } from "@/lib/source-ingestion/batch-schema";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";

const journal = {
	id: "https://openalex.org/S10",
	display_name: "Journal of Research",
	type: "journal",
	issn_l: "1234-5678",
	host_organization: "https://openalex.org/P10",
	host_organization_name: "Research Press",
};

function work(overrides: Record<string, unknown> = {}) {
	return {
		id: "https://openalex.org/W123",
		type: "article",
		title: "A study",
		...overrides,
	};
}

describe("OpenAlex work mapping", () => {
	it("preserves printed names, author order, affiliation facts and the complete source payload", () => {
		const raw = work({
			doi: "https://doi.org/10.1234/STUDY",
			publication_date: "2024-05-17",
			language: "en",
			abstract_inverted_index: { results: [2], These: [0], are: [1] },
			biblio: {
				volume: "4",
				issue: "2",
				first_page: "15",
				last_page: "22",
			},
			primary_location: {
				landing_page_url: "https://journal.example/study",
				pdf_url: "https://journal.example/study.pdf",
				is_oa: false,
				source: journal,
			},
			authorships: [
				{
					raw_author_name: "María del Carmen de la Cruz",
					author: {
						id: "https://openalex.org/A1",
						display_name: "M. Cruz",
						orcid: "https://orcid.org/0000-0001-0002-0003",
					},
					institutions: [
						{
							id: "https://openalex.org/I1",
							display_name: "University One",
							country_code: "GB",
							ror: "https://ror.org/123",
						},
						{
							id: "https://openalex.org/I2",
							display_name: "University Two",
							country_code: "MA",
						},
					],
				},
				{
					raw_author_name: "",
					author: { display_name: "Research Consortium" },
					institutions: [],
				},
				{ author: { display_name: null }, institutions: [] },
			],
			topics: [
				{
					id: "https://openalex.org/T1",
					score: 0.8,
					display_name: "Research",
				},
			],
			ids: {
				openalex: "https://openalex.org/W123",
				pmid: "https://pubmed.ncbi.nlm.nih.gov/123/",
			},
			apc_paid: { value: 200, currency: "USD", provenance: "doaj" },
		});
		const { items, institutions } = mapOpenAlexWork(raw);
		expect(items).toHaveLength(1);
		expect(items[0]!.raw).toEqual(raw);
		expect(items[0]!.metadata).toMatchObject({
			itemType: "JournalArticle",
			title: "A study",
			DOI: "10.1234/study",
			date: "2024-05-17",
			languageName: "en",
			abstractNote: "These are results",
			publicationTitle: "Journal of Research",
			publisher: "Research Press",
			ISSN: "1234-5678",
			volume: "4",
			issue: "2",
			pages: "15-22",
			url: "https://journal.example/study",
			PMID: "123",
			creators: [
				{
					creatorType: "author",
					name: "María del Carmen de la Cruz",
					institutions: [
						{ display_name: "University One" },
						{ display_name: "University Two" },
					],
				},
				{
					creatorType: "author",
					name: "Research Consortium",
					institutions: [],
				},
			],
		});
		expect(items[0]!.metadata).not.toHaveProperty("institution");
		expect(items[0]!.metadata).not.toHaveProperty("country");
		expect(items[0]!.metadata).not.toHaveProperty("countryFocus");
		expect(institutions).toEqual([
			{
				name: "University One",
				countryCode: "GB",
				openalexId: "I1",
				city: null,
			},
			{
				name: "University Two",
				countryCode: "MA",
				openalexId: "I2",
				city: null,
			},
		]);
		const validated = validateNativeItemDraft(
			items[0]!.metadata,
			sourceRecordValidationOptions,
		);
		expect(validated.item.creators).toEqual(items[0]!.metadata.creators);
		expect(validated.item.publicationTitle).toBe("Journal of Research");
	});

	it.each([
		["dataset", null, "Dataset"],
		["standard", null, "Standard"],
		["preprint", null, "Preprint"],
		["software", null, "ComputerProgram"],
		["conference-paper", null, "ConferencePaper"],
		["review", null, "JournalArticle"],
		["letter", null, "JournalArticle"],
		["book-chapter", null, "BookSection"],
		["book", null, "Book"],
		["dissertation", null, "Thesis"],
		["report", null, "Report"],
		["article", "proceedings-article", "ConferencePaper"],
		["unknown-type", null, "Document"],
	])(
		"maps %s with Crossref type %s to valid %s fields",
		(type, typeCrossref, expected) => {
			const [record] = mapOpenAlexWork(
				work({
					type,
					type_crossref: typeCrossref,
					authorships: [{ author: { display_name: "Ada Lovelace" } }],
					biblio: {
						volume: "2",
						issue: "3",
						first_page: "7",
						last_page: "7",
					},
					primary_location: {
						source: {
							display_name: "Research Series",
							type: "book series",
							host_organization_name: "Repository Host",
							host_organization: "https://openalex.org/I10",
						},
					},
				}),
			).items;
			expect(record!.metadata.itemType).toBe(expected);
			expect(record!.metadata).not.toHaveProperty("publisher");
			expect(record!.metadata).not.toHaveProperty("publicationTitle");
			const validated = validateNativeItemDraft(
				record!.metadata,
				sourceRecordValidationOptions,
			);
			expect(validated.item.itemType).toBe(expected);
			if (expected === "BookSection")
				expect(validated.item.pages).toBe("7");
			if (expected === "Dataset") {
				expect(record!.metadata).not.toHaveProperty("volume");
				expect(record!.metadata).not.toHaveProperty("pages");
			}
		},
	);

	it("does not turn a repository host or a book series into a publisher or publication title", () => {
		for (const sourceType of ["repository", "book series"]) {
			const [record] = mapOpenAlexWork(
				work({
					primary_location: {
						source: { ...journal, type: sourceType },
					},
				}),
			).items;
			expect(record!.metadata).not.toHaveProperty("publisher");
			expect(record!.metadata).not.toHaveProperty("publicationTitle");
		}
	});

	it("uses available sparse metadata and treats provider update times as UTC", () => {
		const [record] = mapOpenAlexWork({
			id: "W15",
			title: null,
			display_name: "Available title",
			publication_year: 2023,
			ids: { doi: "doi:10.1234/SPARSE" },
			created_date: "2023-01-02",
			updated_date: "2024-05-06T12:13:14.123456",
			authorships: [
				{ raw_author_name: null, author: null, institutions: null },
			],
		}).items;
		expect(record!.metadata).toMatchObject({
			title: "Available title",
			date: "2023",
			DOI: "10.1234/sparse",
			url: "https://doi.org/10.1234/sparse",
			creators: [],
		});
		expect(record!.sourceDates).toEqual({
			addedAt: new Date("2023-01-02T00:00:00Z"),
			modifiedAt: new Date("2024-05-06T12:13:14.123Z"),
		});
		expect(record!.processingIssue?.code).toBe("incomplete_authorships");
	});

	it("keeps unknown citation counts unknown and normalizes supplied references", () => {
		const [minimal] = mapOpenAlexWork({
			id: "W1",
			title: null,
			authorships: null,
		}).items;
		expect(minimal).toMatchObject({
			sourceRecordKey: "W1",
			citationMetric: null,
			referencedSourceRecordKeys: [],
			processingIssue: null,
		});
		expect(minimal!.metadata.creators).toEqual([]);
		expect(minimal!.metadata).not.toHaveProperty("title");
		const [record] = mapOpenAlexWork(
			work({
				cited_by_count: 0,
				referenced_works: [
					"https://openalex.org/W5",
					"W2",
					"https://openalex.org/W5",
				],
				is_retracted: true,
			}),
		).items;
		expect(record!.citationMetric).toEqual({
			citedByCount: 0,
			referencedWorksCount: null,
		});
		expect(record!.referencedSourceRecordKeys).toEqual(["W5", "W2"]);
		expect(record!.metadata.tags).toEqual(["Retracted"]);
		expect(
			mapOpenAlexWork(work({ referenced_works_count: 0 })).items[0]!
				.citationMetric,
		).toEqual({ citedByCount: null, referencedWorksCount: 0 });
	});

	it("uses a preferred direct OA PDF as a stable URL-only child while keeping the landing URL on the parent", () => {
		const preferred = {
			is_oa: true,
			pdf_url: "https://repo.example/preferred.pdf",
			landing_page_url: "https://repo.example/work",
			version: "acceptedVersion",
			license: "cc-by",
			evidence: { source: "provider" },
		};
		const { items } = mapOpenAlexWork(
			work({
				primary_location: {
					landing_page_url: "https://journal.example/work",
					is_oa: false,
					pdf_url: "https://journal.example/closed.pdf",
				},
				best_oa_location: preferred,
				locations: [
					{ is_oa: true, pdf_url: "https://repo.example/other.pdf" },
				],
			}),
		);
		expect(items).toHaveLength(2);
		expect(items[0]!.metadata.url).toBe("https://journal.example/work");
		expect(items[1]).toMatchObject({
			sourceRecordKey: "W123:pdf",
			parentSourceRecordKey: "W123",
			metadata: { itemType: "Attachment", tags: [] },
			raw: {
				openalexWorkId: "https://openalex.org/W123",
				location: preferred,
			},
		});
		expect(items[1]!.file).toEqual({
			url: preferred.pdf_url,
			contentType: "application/pdf",
			filename: "W123.pdf",
			linkMode: "linked_url",
			md5: null,
			mtime: null,
			charset: null,
			fullText: null,
			coverUrl: null,
			coverWidth: null,
			coverHeight: null,
			managedPublication: null,
		});
		const batch = sourceIngestionBatchSchema.parse({
			sourceConnectionKey: "openalex-test",
			expectedCursor: {},
			nextCursor: {},
			mappingProfileVersion: "test",
			fetchedAt: new Date("2026-01-01"),
			items,
		});
		expect(batch.items).toHaveLength(2);
		expect(
			validateNativeItemDraft(
				items[1]!.metadata,
				sourceRecordValidationOptions,
			).item.itemType,
		).toBe("Attachment");
	});

	it("finds an eligible PDF after a closed first location and chooses it independently of location order", () => {
		const locations = [
			{ is_oa: false, pdf_url: "https://repo.example/closed.pdf" },
			{
				is_oa: true,
				pdf_url: "https://repo.example/submitted.pdf",
				version: "submittedVersion",
			},
			{
				is_oa: true,
				pdf_url: "https://repo.example/z.pdf",
				version: "publishedVersion",
			},
			{
				is_oa: true,
				pdf_url: "https://repo.example/a.pdf",
				version: "publishedVersion",
			},
		];
		for (const order of [locations, [...locations].reverse()]) {
			const { items } = mapOpenAlexWork(
				work({
					best_oa_location: {
						is_oa: true,
						landing_page_url: "https://repo.example/landing",
					},
					locations: order,
				}),
			);
			expect(items).toHaveLength(2);
			expect(items[1]!.file!.url).toBe("https://repo.example/a.pdf");
		}
		expect(
			mapOpenAlexWork(
				work({
					locations: [
						{
							is_oa: true,
							landing_page_url: "https://repo.example/landing",
						},
					],
				}),
			).items,
		).toHaveLength(1);
		expect(
			mapOpenAlexWork(
				work({
					best_oa_location: {
						is_oa: true,
						pdf_url: "javascript:alert(1)",
					},
				}),
			).items,
		).toHaveLength(1);
	});

	it("reports authorships at the API cap without truncating the returned creators", () => {
		const authorships = Array.from({ length: 100 }, (_, index) => ({
			author: { display_name: `Author ${index}` },
		}));
		const [record] = mapOpenAlexWork(work({ authorships })).items;
		expect(record!.metadata.creators).toHaveLength(100);
		expect(record!.processingIssue?.code).toBe("incomplete_authorships");
		expect(
			mapOpenAlexWork(work({ authorships: authorships.slice(0, 99) }))
				.items[0]!.processingIssue,
		).toBeNull();
	});

	it("rejects invalid work identity, counts and non-JSON raw data", () => {
		for (const input of [
			work({ id: "https://other.example/W123" }),
			work({ cited_by_count: -1 }),
			work({ custom: Number.NaN }),
		]) {
			expect(() => mapOpenAlexWork(input)).toThrow();
		}
	});
});
