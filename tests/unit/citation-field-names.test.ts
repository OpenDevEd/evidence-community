import { describe, expect, it } from "vitest";
import { Cite } from "@citation-js/core";

import { exportCitationItems } from "@/lib/citation-export";
import { withZoteroFieldNames } from "@/lib/item-field-codec";

/**
 * A record exactly as PostgreSQL and the search index store it: the report
 * number lives in the shared `number` column and the language in
 * `languageName`.
 */
function storedReport() {
	return {
		key: "RPT12345",
		itemType: "Report",
		title: "Amber report evidence",
		number: "R-42",
		languageName: "fr",
		publisher: "Amber Institute",
		date: "2026-01-15",
		creators: [
			{ firstName: "Amina", lastName: "Amber", creatorType: "author" },
		],
	};
}

describe("stored field names become Zotero field names", () => {
	it("names a report's number and language the way citations expect", () => {
		const named = withZoteroFieldNames(storedReport()) as Record<
			string,
			unknown
		>;

		expect(named.reportNumber).toBe("R-42");
		expect(named.language).toBe("fr");
		expect(named.institution).toBe("Amber Institute");
		// The stored names survive, so readers of the raw record still work.
		expect(named.number).toBe("R-42");
		expect(named.languageName).toBe("fr");
		// The item type is left alone; the citation code matches on it.
		expect(named.itemType).toBe("Report");
	});

	it("names a patent's number differently from a report's", () => {
		const named = withZoteroFieldNames({
			itemType: "Patent",
			number: "US-9",
		}) as Record<string, unknown>;

		expect(named.patentNumber).toBe("US-9");
		expect(named.reportNumber).toBeUndefined();
	});

	it("leaves a record with no item type alone", () => {
		expect(withZoteroFieldNames({ number: "7" })).toEqual({ number: "7" });
	});
});

// These run the real converter. Nothing is mocked, so they prove what a
// reader actually downloads.
describe("real citation output for a stored report", () => {
	it("exports ordered creator roles without an empty leading name", async () => {
		const bibtex = exportCitationItems([{
			...storedReport(),
			creators: [
				{ firstName: "Amina", lastName: "Amber", creatorType: "author" },
				{ firstName: "Sam", lastName: "Park", creatorType: "editor" },
				{ firstName: "Cher", creatorType: "author" },
				{ firstName: "Alex", lastName: "Lee", creatorType: "seriesEditor" },
				{ firstName: "Mina", lastName: "Ito", creatorType: "translator" },
			],
		}], "bibtex");

		expect(bibtex).toContain("\tauthor = {Amber, Amina and {Cher}}");
		expect(bibtex).toContain("\teditor = {Park, Sam and Lee, Alex}");
		expect(bibtex).toContain("\ttranslator = {Ito, Mina}");
	});

	it("keeps an organization as one author instead of treating it as the publisher", async () => {
		const item = {
			...storedReport(),
			publisher: undefined,
			creators: [
				{ name: "UNESCO and Evidence Group", creatorType: "author" },
				{ firstName: "Caitlin", lastName: "Mills", creatorType: "author" },
			],
		};
		const bibtex = exportCitationItems([item], "bibtex");
		const ris = exportCitationItems([item], "ris");

		const [record] = (await Cite.async(bibtex)).data;
		expect(record.author).toHaveLength(2);
		expect(record.publisher).toBeUndefined();
		expect(ris).toMatch(/^AU  - UNESCO and Evidence Group$/m);
		expect(ris).toMatch(/^AU  - Mills, Caitlin$/m);
		expect(ris).not.toMatch(/^PB  - /m);
	});

	it("escapes TeX characters in creator names while preserving RIS text", async () => {
		const name = String.raw`Research & Development 50% $5 #1_A \\ ^ ~ {Lab}`;
		const item = {
			...storedReport(),
			creators: [{ name, creatorType: "author" }],
		};
		const bibtex = exportCitationItems([item], "bibtex");
		const authorLine = bibtex.split("\n").find((line) => line.startsWith("\tauthor = "));
		for (const escaped of [String.raw`\&`, String.raw`\%`, String.raw`\$`, String.raw`\#`, String.raw`\_`, String.raw`\textbackslash{}`, String.raw`\textasciicircum{}`, String.raw`\textasciitilde{}`, String.raw`\{`, String.raw`\}`]) {
			expect(authorLine).toContain(escaped);
		}
		expect(exportCitationItems([item], "ris")).toContain(`AU  - ${name}`);
	});

	it("keeps the number and language in BibTeX", async () => {
		const bibtex = exportCitationItems([storedReport()], "bibtex");

		expect(bibtex).toContain("@techreport{el_RPT12345");
		expect(bibtex).toContain("R-42");
		expect(bibtex).toContain("fr");
		expect(bibtex).toContain("Amber Institute");
	});

	it("keeps the number and language in RIS", async () => {
		const ris = exportCitationItems([storedReport()], "ris");

		expect(ris).toContain("R-42");
		expect(ris).toContain("fr");
	});

	it("names each BibTeX field once", async () => {
		// A report's publisher is written as `institution`, and the search
		// index also carries an `institution` value. The entry must still name
		// the field once.
		const bibtex = exportCitationItems([{
			...storedReport(),
			institution: ["Amber Institute"],
		}], "bibtex");

		const institutionLines = [
			...bibtex.matchAll(/\n\tinstitution = /gu),
		];
		expect(institutionLines).toHaveLength(1);
	});
});

it("exports the resolved public DOI without choosing again from attachment or Extra metadata", async () => {
	for (const DOI of [null, "10.5555/current"]) {
		const item = {
			...storedReport(), DOI, extra: "DOI: 10.5555/extra",
			attachmentsData: [{ url: "https://doi.org/10.5555/attachment", tags: ["_r:doi"] }],
		};
		const bibtex = exportCitationItems([item], "bibtex");
		const ris = exportCitationItems([item], "ris");
		if (DOI) {
			expect(bibtex).toContain("doi = {10.5555/current}");
			expect(ris).toContain("DO  - 10.5555/current");
		} else {
			expect(bibtex).not.toContain("doi =");
			expect(ris).not.toContain("DO  -");
		}
	}
});
