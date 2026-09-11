import { describe, expect, it } from "vitest";

import { BibTeXExporter } from "@/lib/formatAsBibTeX";
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
		const bibtex = await new BibTeXExporter({
			...storedReport(),
			creators: [
				{ firstName: "Amina", lastName: "Amber", creatorType: "author" },
				{ firstName: "Sam", lastName: "Park", creatorType: "editor" },
				{ firstName: "Cher", creatorType: "author" },
				{ firstName: "Alex", lastName: "Lee", creatorType: "seriesEditor" },
				{ firstName: "Mina", lastName: "Ito", creatorType: "translator" },
			],
		} as never).toBibTeX();

		expect(bibtex).toContain("\tauthor = {Amber, Amina and Cher}");
		expect(bibtex).toContain("\teditor = {Park, Sam and Lee, Alex}");
		expect(bibtex).toContain("\ttranslator = {Ito, Mina}");
	});

	it("keeps an organization as one author instead of treating it as the publisher", async () => {
		const exporter = new BibTeXExporter({
			...storedReport(),
			publisher: undefined,
			creators: [
				{ name: "Learning and Evidence Group", creatorType: "author" },
				{ firstName: "Caitlin", lastName: "Mills", creatorType: "author" },
			],
		} as never);
		const bibtex = await exporter.toBibTeX();
		const ris = await exporter.toRIS();

		expect(bibtex).toContain("\tauthor = {{Learning and Evidence Group} and Mills, Caitlin}");
		expect(bibtex).not.toContain("\tinstitution = ");
		expect(ris).toMatch(/^AU  - Learning and Evidence Group$/m);
		expect(ris).toMatch(/^AU  - Mills, Caitlin$/m);
		expect(ris).not.toMatch(/^PB  - /m);
	});

	it("keeps the number and language in BibTeX", async () => {
		const bibtex = await new BibTeXExporter(
			storedReport() as never,
		).toBibTeX();

		expect(bibtex).toContain("@techreport{RPT12345");
		expect(bibtex).toContain("R-42");
		expect(bibtex).toContain("fr");
		expect(bibtex).toContain("Amber Institute");
	});

	it("keeps the number and language in RIS", async () => {
		const ris = await new BibTeXExporter(storedReport() as never).toRIS();

		expect(ris).toContain("R-42");
		expect(ris).toContain("fr");
	});

	it("names each BibTeX field once", async () => {
		// A report's publisher is written as `institution`, and the search
		// index also carries an `institution` value. The entry must still name
		// the field once.
		const bibtex = await new BibTeXExporter({
			...storedReport(),
			institution: ["Amber Institute"],
		} as never).toBibTeX();

		const institutionLines = [
			...bibtex.matchAll(/\n\tinstitution = /gu),
		];
		expect(institutionLines).toHaveLength(1);
	});

	it("loses the number and language without the field names", async () => {
		// Proof that the naming step is what carries these fields through:
		// the same record with its stored names alone drops both.
		const { number, languageName, ...withoutNames } = storedReport();
		const exporter = new BibTeXExporter(withoutNames as never);
		Object.assign(exporter.item, { number, languageName });

		const bibtex = await exporter.toBibTeX();

		expect(bibtex).not.toContain("R-42");
		expect(bibtex).not.toContain("language");
	});
});
