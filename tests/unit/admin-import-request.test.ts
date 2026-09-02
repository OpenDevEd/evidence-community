import { describe, expect, it } from "vitest";

import {
	doiPreviewRequest,
	filePreviewRequest,
	importRowStatus,
	selectedImportRecords,
	summarizeImportResults,
	toggleImportSelection,
} from "@/components/admin/admin-import";
import type { AdminImportPreviewRecord } from "@/lib/admin/item-import-contract";

const record = (
	overrides: Partial<AdminImportPreviewRecord> & { id: string },
): AdminImportPreviewRecord => ({
	creators: [],
	itemType: null,
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
		const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.ris");
		await expect(filePreviewRequest([big])).rejects.toThrow("larger than 5 MB");
		await expect(
			filePreviewRequest([new File(["TY  - JOUR"], "a.ris")]),
		).resolves.toEqual({ dois: [], files: [{ content: "TY  - JOUR", name: "a.ris" }] });
	});
});

describe("import preview selection", () => {
	it("only sends selected records that have a validated payload", () => {
		const records = [
			record({ id: "1", payload: { itemType: "Book" } }),
			record({ id: "2", payload: null, state: "attention" }),
			record({ id: "3", payload: { itemType: "Book" } }),
		];
		const selected = toggleImportSelection(new Set(["1", "2"]), "3", true);
		expect(selectedImportRecords(records, toggleImportSelection(selected, "1", false))).toEqual([
			{ id: "3", payload: { itemType: "Book" } },
		]);
	});

	it("shows the preview state until a commit result replaces it", () => {
		const existing = record({ id: "1", existingKey: "ABCD2345", state: "existing" });
		expect(importRowStatus(existing, undefined)).toMatchObject({ label: "Already in library" });
		expect(importRowStatus(existing, { id: "1", itemKey: "WXYZ6789", outcome: "created" })).toMatchObject({
			label: "Draft created",
			tone: "ready",
		});
		expect(importRowStatus(existing, { id: "1", message: "Check the title.", outcome: "failed" })).toMatchObject({
			label: "Check the title.",
			tone: "attention",
		});
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
