import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "@/lib/markdown-text";

describe("markdownToPlainText", () => {
	it("keeps a link's words, and its address when asked", () => {
		const text = "See the [study](https://example.org/paper_(2026)) and ![chart](https://example.org/a.png \"Chart\").";
		expect(markdownToPlainText(text, { links: "text" })).toBe("See the study and chart.");
		expect(markdownToPlainText(text)).toBe("See the study (https://example.org/paper_(2026)) and chart.");
	});

	it("drops emphasis, headings and code marks", () => {
		expect(markdownToPlainText("# Title\n**bold**, _it_ and `code`")).toBe("Title\nbold, it and code");
	});
});
