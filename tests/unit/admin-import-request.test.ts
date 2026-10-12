import { describe, expect, it } from "vitest";

import {
	doiPreviewRequest,
	filePreviewRequest,
	recordRights,
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

describe("the record's Rights after fixes", () => {
	const checks = [
		{ fix: "", text: "Credits the funder" },
		{ fix: "© Crown copyright", text: "Carries a Crown copyright notice" },
		{ fix: "Licensed under the Open Government Licence v3.0", text: "Is licensed under the OGL" },
	];
	const row = (results: Array<"met" | "not_met">, fixed: number[]): ImportRow => ({
		...rowsFromRecords([record({ id: "1", payload: { rights: "© EdTech Hub 2024. CC BY 4.0" } })])[0]!,
		checks: results.map((result, index) => ({ criterion: checks[index]!.text, page: null, quote: null, recommendation: null, result })),
		fixed,
	});

	it("keeps what the PDF states until a check is fixed", () => {
		expect(recordRights(row(["met", "not_met", "not_met"], []), checks)).toBe("© EdTech Hub 2024. CC BY 4.0");
	});

	it("builds the statement from the fixed checks and the met ones, in the checks' order", () => {
		expect(recordRights(row(["not_met", "met", "not_met"], [2]), checks)).toBe("© Crown copyright. Licensed under the Open Government Licence v3.0");
		expect(recordRights(row(["met", "not_met", "not_met"], [2]), checks)).toBe("Licensed under the Open Government Licence v3.0");
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
