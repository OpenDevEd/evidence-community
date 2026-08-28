import { describe, expect, it } from "vitest";

import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningResultsData,
} from "@/lib/ai/screening-export";

const results: ScreeningResultsData = {
	result: {
		ABCD1234: {
			title: "Teaching by radio",
			screeningFields: { Country: "Kenya", Randomised: true },
		},
		EFGH5678: {
			title: 'A study of "reading, at home"',
			screeningFields: { Country: null, Randomised: false },
		},
	},
	fields: [
		{ label: "Country", type: "string" },
		{ label: "Randomised", type: "boolean" },
	],
};

describe("taking screening results away", () => {
	it("gives every publication a row in each format", () => {
		const content = screeningExportContent(
			results,
			"https://library.example.org",
		);

		for (const format of [
			content.plaintext,
			content.markdown,
			content.html,
			content.csv,
		]) {
			expect(format).toContain("Teaching by radio");
			expect(format).toContain("Kenya");
		}
	});

	it("links each publication back to the library", () => {
		const content = screeningExportContent(
			results,
			"https://library.example.org",
		);

		expect(content.markdown).toContain(
			"https://library.example.org/lib/ABCD1234",
		);
		expect(content.html).toContain(
			"https://library.example.org/lib/ABCD1234",
		);
	});

	it("keeps a spreadsheet safe from a title that looks like a formula", () => {
		const risky: ScreeningResultsData = {
			...results,
			result: {
				ABCD1234: {
					title: "=SUM(A1:A2)",
					screeningFields: { Country: "Kenya", Randomised: true },
				},
			},
		};

		const csv = screeningExportContent(risky).csv;

		expect(csv).not.toMatch(/(^|,|")=SUM/);
	});

	it("quotes a title containing commas and quotation marks", () => {
		const csv = screeningExportContent(results).csv;

		expect(csv).toContain('"A study of ""reading, at home"""');
	});

	it("refuses results that are not screening results", () => {
		expect(isScreeningResultsData(results)).toBe(true);
		expect(isScreeningResultsData({ result: {}, fields: "no" })).toBe(false);
		expect(isScreeningResultsData("{}")).toBe(false);
		expect(
			isScreeningResultsData({
				result: { A: { title: 1, screeningFields: {} } },
				fields: [],
			}),
		).toBe(false);
	});
});
