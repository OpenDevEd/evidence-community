import { describe, expect, it } from "vitest";

import {
	checkPasses,
	doiPreviewRequest,
	filePreviewRequest,
	recordRights,
	reviewChecks,
	rowPasses,
	rowsFromRecords,
	selectedImportRecords,
	summarizeImportResults,
	type ImportRow,
} from "@/components/admin/admin-import";
import type { AdminImportPreviewRecord } from "@/lib/admin/item-import-contract";

const record = (
	overrides: Partial<AdminImportPreviewRecord> & { id: string },
): AdminImportPreviewRecord => ({
	creators: [],
	itemType: null,
	method: "file",
	payload: null,
	source: "sample.ris",
	state: "ready",
	title: null,
	year: null,
	...overrides,
});

describe("import input checks", () => {
	it("rejects non-DOI entries before any lookup and normalizes the rest", () => {
		expect(() => doiPreviewRequest("10.1000/abc\nnope")).toThrow("not DOIs: nope");
		expect(() => doiPreviewRequest("  \n")).toThrow("at least one DOI");
		expect(doiPreviewRequest("https://doi.org/10.1000/ABC")).toEqual({
			dois: ["10.1000/abc"],
			files: [],
		});
		const many = Array.from({ length: 501 }, (_, i) => `10.1000/${i}`).join("\n");
		expect(() => doiPreviewRequest(many)).toThrow("no more than 500");
	});

	it("reads chosen files and rejects empty or oversized selections", async () => {
		await expect(filePreviewRequest([])).rejects.toThrow("at least one file");
		await expect(filePreviewRequest([new File([], "empty.ris")])).rejects.toBeInstanceOf(Error);
		const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.ris");
		await expect(filePreviewRequest([big])).rejects.toThrow("larger than 5 MB");
		await expect(
			filePreviewRequest([new File(["TY  - JOUR"], "a.ris")]),
		).resolves.toEqual({ dois: [], files: [{ content: "TY  - JOUR", name: "a.ris" }] });
	});
});

describe("the record's Rights and the AI's fix", () => {
	const row = (fixApplied: boolean): ImportRow => ({
		...rowsFromRecords([record({ id: "1", payload: { rights: "© EdTech Hub 2024. CC BY 4.0" } })])[0]!,
		checks: (["met", "not_met", "not_met"] as const).map((result) => ({ criterion: result, page: null, quote: null, recommendation: null, result })),
		fixApplied,
		rightsFix: { checks: [1], statement: "© Crown copyright 2024. Licensed under the Open Government Licence v3.0" },
	});

	it("keeps what the PDF states until the editor applies the fix", () => {
		expect(recordRights(row(false))).toBe("© EdTech Hub 2024. CC BY 4.0");
		expect(checkPasses(reviewChecks(row(false))[1]!)).toBe(false);
	});

	it("uses the AI's statement once applied, and passes only the checks it names", () => {
		expect(recordRights(row(true))).toBe("© Crown copyright 2024. Licensed under the Open Government Licence v3.0");
		expect(reviewChecks(row(true)).map(checkPasses)).toEqual([true, true, false]);
	});
});

describe("the checks a PDF gets from its own file", () => {
	const properties = { authors: [], doi: "", keywords: [], rights: "", subject: "", title: "" };
	const row = (pdfua: string): ImportRow => ({
		...rowsFromRecords([record({ id: "1" })])[0]!,
		checks: [{ criterion: "Credits the funder", page: 1, quote: "Funded by UK aid", recommendation: null, result: "met" }],
		pdf: { properties, standards: { pdfa: "2B", pdfua, tagged: true }, writable: true },
	});

	it("passes every check only when the file also meets the accessibility and archiving standards", () => {
		expect(rowPasses(row("1"))).toBe(true);
		expect(rowPasses(row(""))).toBe(false);
	});
});

describe("import preview selection", () => {
	it("only sends selected records that have a validated payload", () => {
		const records = [
			record({ id: "1", payload: { itemType: "Book" } }),
			record({ id: "2", payload: null, state: "attention" }),
			record({ id: "3", method: "doi", payload: { itemType: "Book" } }),
		];
		expect(selectedImportRecords(records, new Set(["2", "3"]))).toEqual([
			{ id: "3", method: "doi", payload: { itemType: "Book" } },
		]);
	});

	it("summarizes created keys and failures for the toast", () => {
		expect(
			summarizeImportResults([
				{ id: "1", itemKey: "AAAA2345", outcome: "created" },
				{ id: "2", outcome: "skipped" },
				{ id: "3", outcome: "failed" },
			]),
		).toEqual({ createdKeys: ["AAAA2345"], failed: 1, message: "1 draft created, 1 failed" });
	});
});
