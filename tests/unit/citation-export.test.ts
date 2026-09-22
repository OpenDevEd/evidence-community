import { Cite } from "@citation-js/core";
import { describe, expect, it } from "vitest";
import { exportCitationItems } from "@/lib/citation-export";
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
