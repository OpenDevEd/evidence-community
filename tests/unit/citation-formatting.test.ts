import { describe, expect, it } from "vitest";
import { itemToCitationData } from "@/lib/citation-data";
import { formatCitations } from "@/lib/citation-formatter";

const article = {
	key: "ARTICLE1", itemType: "JournalArticle", title: "Evidence & education",
	creators: [{ firstName: "Jane", lastName: "Smith", creatorType: "author" }],
	date: "2026-09", publicationTitle: "Journal of Education",
	volume: "42", issue: "3", pages: "101-109", DOI: "10.1234/example",
};

describe("record citations", () => {
	it("formats the record with the selected style without a translation service", async () => {
		const data = itemToCitationData(article)!;
		expect(data.issued).toEqual({ "date-parts": [[2026, 9]] });
		const citations = await formatCitations(data, "en-GB");
		expect(citations.apa).toBe("Smith, J. (2026). Evidence & education. Journal of Education, 42(3), 101–109. https://doi.org/10.1234/example");
		expect(citations.chicago).toContain('Smith, Jane. 2026.');
		expect(citations.harvard).toContain("Smith, J. (2026)");
		expect(citations.mla).toContain("Smith, Jane.");
		expect(citations.vancouver).toContain("Smith J.");
		expect(citations.vancouver).toContain("42(3):101–9");
	});

	it("preserves corporate authors, editor roles and canonical report fields", () => {
		const data = itemToCitationData({
			key: "REPORT01", itemType: "Report", title: "Schools in Kenya", number: "KE-4",
			languageName: "en", date: "2025", publisher: "WHO",
			creators: [
				{ name: "World Health Organization", creatorType: "author" },
				{ firstName: "Jane", lastName: "Doe", creatorType: "editor" },
			],
		});
		expect(data).toMatchObject({ type: "report", number: "KE-4", language: "en",
			author: [{ literal: "World Health Organization" }], editor: [{ given: "Jane", family: "Doe" }],
			issued: { "date-parts": [[2025]] },
		});
	});

	it("uses the record identity for a stable BibTeX key and escapes metadata", async () => {
		const data = itemToCitationData({ ...article, title: "A {test}: 50% & more" })!;
		const citations = await formatCitations(data, "en-GB");
		expect(citations.bibtex).toMatch(/^@article\{el_ARTICLE1,/);
		expect(citations.bibtex).toContain("50\\% \\& more");
		expect(citations.bibtex).toContain("10.1234/example");
		expect(citations.bibtex).not.toContain("<div");
	});

	it("does not invent a date or author when the source has neither", async () => {
		const data = itemToCitationData({ key: "WEBPAGE1", itemType: "Webpage", title: "Undated evidence" })!;
		expect(data.issued).toBeUndefined();
		const citations = await formatCitations(data, "en-GB");
		expect(citations.apa).toBe("Undated evidence. (n.d.).");
	});

	it("does not expose a citation for attachments or a missing title", () => {
		expect(itemToCitationData({ key: "EMPTY001", itemType: "Report", title: "  " })).toBeNull();
		expect(itemToCitationData({ key: "FILE0001", itemType: "Attachment", title: "PDF" })).toBeNull();
	});
});
