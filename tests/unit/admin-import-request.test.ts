import { describe, expect, it } from "vitest";

import {
	appliedOf,
	checkPasses,
	createdKeys,
	doiPreviewRequest,
	filePreviewRequest,
	recordPayload,
	reviewChecks,
	rowsFromRecords,
	selectedImportRecords,
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
		expect(() => doiPreviewRequest("10.1000/abc\nnope")).toThrow("name no paper: nope");
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

describe("the changes the AI suggests", () => {
	const row: ImportRow = {
		...rowsFromRecords([record({ id: "1", payload: { rights: "© EdTech Hub 2024. CC BY 4.0", title: "Girls' learning" } })])[0]!,
		checks: (["met", "not_met", "not_met"] as const).map((result) => ({ criterion: result, page: null, quote: null, recommendation: null, result })),
		suggestions: [
			{ apply: false, checks: [1], field: "rights", reason: "The check asks for Crown copyright", value: "© Crown copyright 2024" },
			{ apply: true, checks: [], field: "title", reason: "The instructions ask for British English", value: "Girls' learning in Sierra Leone" },
		],
	};

	it("starts with the ones the library's instructions call for", () => {
		expect([...appliedOf(null, row)]).toEqual([1]);
	});

	it("keeps what the PDF states until the editor applies a change", () => {
		expect(recordPayload(row, new Set([1]))).toMatchObject({ rights: "© EdTech Hub 2024. CC BY 4.0", title: "Girls' learning in Sierra Leone" });
		expect(reviewChecks(row, new Set([1])).map(checkPasses)).toEqual([true, false, false]);
	});

	it("uses an applied change, and passes only the checks it names", () => {
		expect(recordPayload(row, new Set([0]))).toMatchObject({ rights: "© Crown copyright 2024", title: "Girls' learning" });
		expect(reviewChecks(row, new Set([0])).map(checkPasses)).toEqual([true, true, false]);
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

	it("selects only the drafts an import created", () => {
		expect(
			createdKeys([
				{ id: "1", itemKey: "AAAA2345", outcome: "created" },
				{ id: "2", outcome: "skipped" },
				{ id: "3", outcome: "failed" },
			]),
		).toEqual(["AAAA2345"]);
	});
});
