import { describe, expect, it } from "vitest";

import { isRecordDragData } from "@/components/admin/AdminDragDropProvider";
import { recordDragLabel, recordDragSelection } from "@/lib/admin/record-drag";
import type { AdminItemSummary } from "@/lib/admin/types";

function item(key: string, sourceConnectionKey = "native"): AdminItemSummary {
	return {
		creators: [],
		date: null,
		fileState: "none",
		itemType: "document",
		key,
		revision: 1,
		sourceConnectionKey,
		state: "published",
		title: `Title ${key}`,
		updatedAt: "2026-01-01T00:00:00.000Z",
		withdrawn: false,
	};
}

describe("admin record drag", () => {
	const nativeA = item("AAAA1111");
	const nativeB = item("BBBB2222");
	const imported = item("CCCC3333", "zotero-main");
	const items = [nativeA, imported, nativeB];

	it("drags an unselected native record by itself", () => {
		expect(
			recordDragSelection(
				nativeA,
				items,
				new Set(["BBBB2222"]),
				new Set(["native"]),
			),
		).toEqual(["AAAA1111"]);
	});

	it("drags all selected native records in visible order", () => {
		expect(
			recordDragSelection(
				nativeB,
				items,
				new Set(["BBBB2222", "CCCC3333", "AAAA1111"]),
				new Set(["native"]),
			),
		).toEqual(["AAAA1111", "BBBB2222"]);
	});

	it("drags selected records from the same editable source", () => {
		expect(
			recordDragSelection(
				imported,
				items,
				new Set(["AAAA1111", "CCCC3333"]),
				new Set(["native", "zotero-main"]),
			),
		).toEqual(["CCCC3333"]);
	});

	it("does not make records from a read-only source draggable", () => {
		expect(
			recordDragSelection(
				imported,
				items,
				new Set(["CCCC3333"]),
				new Set(["native"]),
			),
		).toEqual([]);
	});

	it("uses the record title for one record and a count for a group", () => {
		expect(recordDragLabel(nativeA, ["AAAA1111"])).toBe("Title AAAA1111");
		expect(recordDragLabel(nativeA, ["AAAA1111", "BBBB2222"])).toBe(
			"2 selected records",
		);
	});

	it("requires the grabbed record focus key in record drag payloads", () => {
		expect(
			isRecordDragData({
				focusKey: "BBBB2222",
				itemKeys: ["AAAA1111", "BBBB2222"],
				kind: "records",
				label: "2 selected records",
				sourceConnectionKey: "native",
			}),
		).toBe(true);
		expect(
			isRecordDragData({
				itemKeys: ["AAAA1111", "BBBB2222"],
				kind: "records",
				label: "2 selected records",
				sourceConnectionKey: "native",
			}),
		).toBe(false);
	});
});
