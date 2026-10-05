import { Cite } from "@citation-js/core";
import { describe, expect, it } from "vitest";
import { exportCitationItems, formatCitationExport } from "@/lib/citation-export";
import { itemToCitationData } from "@/lib/citation-data";
import { formatCitations } from "@/lib/citation-formatter";

const report = {
	key: "REPORT01", itemType: "Report", title: "Éducation au Sénégal et 教育",
	date: "2026-01-15", number: "R-42", languageName: "fr", publisher: "UNESCO",
	DOI: "10.1234/report", url: "https://publisher.example/report", tags: ["Kenya", "Education"],
	creators: [
		{ name: "Research & Development", creatorType: "author" },
		{ firstName: "Sam", lastName: "Park", creatorType: "editor" },
		{ firstName: "Alex", lastName: "Lee", creatorType: "seriesEditor" },
		{ firstName: "Mina", lastName: "Ito", creatorType: "translator" },
	],
};

describe("citation downloads", () => {
	it.each([
		[{ firstName: "John", lastName: "Smith, Jr." }, "{Smith, Jr.}, John"],
		[{ firstName: "John, Jr.", lastName: "Smith" }, "Smith, {John, Jr.}"],
		[{ name: "Research and Development" }, "{Research and Development}"],
		[{ name: "Smith, Jr., John" }, "{Smith, Jr., John}"],
		[{ firstName: "Research And Development", lastName: "Team" }, "Team, {Research And Development}"],
		[{ firstName: "LLP", lastName: "Ernst AND Young" }, "{Ernst AND Young}, LLP"],
		[{ firstName: "Research\tand\tDevelopment", lastName: "Team" }, "Team, {Research\tand\tDevelopment}"],
	])("protects BibTeX name parts from delimiter parsing: %j", (creator, encoded) => {
		const bib = exportCitationItems([{ ...report, creators: [{ ...creator, creatorType: "author" }] }], "bibtex");
		expect(bib).toContain(`author = {${encoded}}`);
	});
	it("does not add empty RIS notes to ordinary creator names", () => {
		const ris = exportCitationItems([{ ...report, creators: [{ firstName: "Sam", lastName: "Park", creatorType: "author" }] }], "ris");
		expect(ris).not.toMatch(/^N1\s+-\s*$/m);
	});

	it.each(["article", "thesis"])("preserves the access date alongside the %s publication note", type => {
		const data = { ...itemToCitationData(report)!, type, accessed: { "date-parts": [[2025, 1, 2]] } };
		const bib = formatCitationExport(data, "bibtex");
		expect(new Cite(bib).data[0].accessed).toEqual(data.accessed);
		expect(bib).toContain("Publication type:");
	});

	it("separates the RIS publication type from its creator recovery note", () => {
		const ris = exportCitationItems([{ ...report, itemType: "Thesis" }], "ris");
		expect(ris).toContain("Publication type: Thesis. RIS import");
	});

	it("retains original ambiguous RIS creator names in an HTML-safe recovery note", () => {
		const creators = [{ name: "Équipe <R&D>, unité 2", creatorType: "author" }, { firstName: "John", lastName: "Smith, Jr.", creatorType: "editor" }];
		const ris = exportCitationItems([{ ...report, creators }], "ris");
		const note = String(new Cite(ris).data[0].note);
		expect(note).toContain("Équipe &lt;R&amp;D&gt;, unité 2");
		expect(note).toContain("Smith, Jr.");
		expect(note).toContain("John");
		expect(note).not.toContain("<R&D>");
	});

	it("keeps preprints distinct from journal articles without changing their CSL display type", async () => {
		const item = { ...report, itemType: "Preprint" };
		const data = itemToCitationData(item)!;
		expect(data.type).toBe("article");
		const ris = exportCitationItems([item], "ris");
		expect(ris).toMatch(/^TY  - MANSCPT\n/);
		expect(ris).toContain("M3  - Preprint");
		expect(ris).toContain("Publication type: Preprint");
		const bib = exportCitationItems([item], "bibtex");
		expect(bib).toMatch(/^@unpublished\{/);
		expect(bib).toContain("type = {Preprint}");
		expect(bib).toContain("Publication type: Preprint");
		expect((await formatCitations(data, "en-GB")).bibtex.text).toBe(bib);
		expect(data.type).toBe("article");
		expect(exportCitationItems([{ ...item, itemType: "JournalArticle" }], "ris")).toMatch(/^TY  - JOUR\n/);
	});

	it.each([
		[undefined, "misc", "Thesis"],
		["Diploma thesis", "misc", "Diploma thesis"],
		["Master's thesis", "mastersthesis", "Master's thesis"],
		["Doctoral thesis", "phdthesis", "Doctoral thesis"],
		["Doctoral dissertation", "phdthesis", "Doctoral dissertation"],
		["PhD dissertation", "phdthesis", "PhD dissertation"],
		["Ph.D. thesis", "phdthesis", "Ph.D. thesis"],
		["PhD", "phdthesis", "PhD"],
		["MSc thesis", "mastersthesis", "MSc thesis"],
		["Master’s thesis", "mastersthesis", "Master’s thesis"],
	])("preserves thesis type %s without inventing a degree", (type, bibType, genre) => {
		const item = { ...report, itemType: "Thesis", type };
		const bib = exportCitationItems([item], "bibtex");
		expect(bib).toMatch(new RegExp(`^@${bibType}\\{`));
		expect(bib).toContain("Publication type: Thesis");
		if (bibType === "misc") expect(bib).toContain(`type = {${genre}}`);
		const ris = exportCitationItems([item], "ris");
		expect(ris).toMatch(/^TY  - THES\n/);
		expect(ris).toContain(`M3  - ${genre}`);
	});

	it("does not turn a report into a thesis based on its report-type label", () => {
		expect(exportCitationItems([{ ...report, type: "Doctoral thesis" }], "bibtex")).toMatch(/^@techreport\{/);
	});
	it.each([undefined, "https://library.example"])("matches the picker BibTeX with library base URL %s", async baseUrl => {
		const citations = await formatCitations(itemToCitationData(report)!, "en-GB", baseUrl ? `${baseUrl}/lib/REPORT01` : undefined);
		const download = exportCitationItems([report], "bibtex", baseUrl);
		expect(download).toBe(citations.bibtex.text);
		expect(new Cite(download).data[0]).toMatchObject({ "citation-key": "el_REPORT01", DOI: report.DOI, URL: baseUrl ? `${baseUrl}/lib/REPORT01` : report.url });
	});

	it("writes RIS directly without losing creator roles, dates, languages, or long Unicode titles", () => {
		const title = `${report.title} ${"International education research ".repeat(5).trim()}`;
		const output = exportCitationItems([{ ...report, title }], "ris");
		const [parsed] = new Cite(output).data;
		expect(parsed).toMatchObject({
			title, language: "fr", number: "R-42", publisher: "UNESCO", DOI: report.DOI,
			issued: { "date-parts": [[2026, 1, 15]] },
			editor: [{ family: "Park", given: "Sam" }],
			"collection-editor": [{ family: "Lee", given: "Alex" }],
			translator: [{ family: "Ito", given: "Mina" }],
		});
		expect(output).toContain("AU  - Research & Development");
		expect(String(parsed.keyword).split(/,\s*/)).toEqual(["Education", "Kenya"]);
	});

	it.each(["bibtex", "ris"] as const)("keeps selection order and rejects incomplete %s downloads", format => {
		const output = exportCitationItems([report, { ...report, key: "REPORT02", title: "Second report" }], format);
		expect(new Cite(output).data.map(record => record.title)).toEqual([report.title, "Second report"]);
		expect(() => exportCitationItems([report, { ...report, key: "BADITEM", title: "" }], format)).toThrow("BADITEM");
		expect(exportCitationItems([], format)).toBe("");
	});
});
