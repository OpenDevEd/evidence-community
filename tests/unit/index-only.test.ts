import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { isIndexOnly } from "@/lib/search-index/index-only";
import { documentFromWork, indexOnlyKey } from "@/lib/search-index/index-only-document";

const loadedAt = new Date("2026-11-05T00:00:00Z");
const options = { sourceConnectionKey: "server-files", loadedAt };
const work = {
	id: "https://openalex.org/W2620998106",
	title: "Teachers and literacy in Kenya",
	type: "article",
	doi: "https://doi.org/10.1234/abc",
	language: "en",
	publication_date: "2018-06-01",
	publication_year: 2018,
	cited_by_count: 7,
	referenced_works_count: 2,
	open_access: { is_oa: true },
	abstract_inverted_index: { Teachers: [0], teach: [1] },
	best_oa_location: { is_oa: true, pdf_url: "https://example.org/paper.pdf", landing_page_url: "https://example.org/paper" },
	authorships: [
		{
			raw_author_name: "A. Author",
			author: { display_name: "A. Author" },
			institutions: [{ id: "https://openalex.org/I1", display_name: "University of Nairobi", country_code: "KE" }],
		},
		{
			raw_author_name: "B. Author",
			author: { display_name: "B. Author" },
			institutions: [{ id: "https://openalex.org/I2", display_name: "Makerere University", country_code: "UG" }],
		},
	],
};

describe("index-only records", () => {
	it("gives every OpenAlex id its own stable, valid record key", () => {
		const ids = [1, 2, 33, 2620998106, 7220200302, 2620998106 + 700_000_000_000];
		const keys = ids.map(indexOnlyKey);
		expect(new Set(keys).size).toBe(ids.length);
		expect(keys.every(isCanonicalRecordKey)).toBe(true);
		expect(indexOnlyKey(2620998106)).toBe(indexOnlyKey(2620998106));
		expect(() => indexOnlyKey(33 ** 8)).toThrow("too large");
	});

	it("makes a search document from a work, with its authors' institutions and countries", () => {
		const document = documentFromWork(work, options);

		expect(document).toMatchObject({
			title: "Teachers and literacy in Kenya",
			DOI: "10.1234/abc",
			abstractNote: "Teachers teach",
			year: "2018",
			country: ["KE"],
			authorCountry: ["KE", "UG"],
			institutionsWithAuthors: ["University of Nairobi", "Makerere University"],
			fullNames: ["A. Author", "B. Author"],
			citationCount: 7,
			openAccess: true,
			hasPdf: true,
			sourceRecordKey: "W2620998106",
			deleted: 0,
		});
		expect(document.key).toBe(indexOnlyKey(2620998106));
	});

	it("links a work's PDF without storing it, under a key of its own", () => {
		const document = documentFromWork(work, options);
		const [pdf] = document.attachmentsData as { key: string; linkMode: string; url: string }[];

		expect(pdf).toMatchObject({ linkMode: "linked_url", url: "https://example.org/paper.pdf" });
		expect(pdf!.key).not.toBe(document.key);
	});

	it("is only ever on for a library that asks for it", () => {
		const search = (value: object) => ({ services: { search: value } }) as Parameters<typeof isIndexOnly>[0];

		expect(isIndexOnly(search({ engine: "elasticsearch", indexOnly: true }))).toBe(true);
		expect(isIndexOnly(search({ engine: "elasticsearch", indexOnly: false }))).toBe(false);
		expect(isIndexOnly(search({ engine: "meilisearch" }))).toBeFalsy();
	});
});
