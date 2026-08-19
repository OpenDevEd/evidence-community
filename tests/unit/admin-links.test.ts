import { describe, expect, it } from "vitest";

import {
	pickableLinkTargets,
	planAdminLinks,
	sourceLabelForOrigin,
} from "@/components/admin/admin-links";
import type { AdminSource } from "@/lib/admin/types";

const sources: AdminSource[] = [
	{
		key: "zotero-main",
		label: "Main Zotero group",
		provider: "zotero",
		readOnly: false,
		status: "active",
		writeback: { enabled: true, supported: true },
	} as AdminSource,
];

const links = {
	fromSources: [{ key: "SRC12345", kind: "related" as const, origin: "source:zotero-main" }],
	citedBy: [{ key: "INCA2345", kind: "cites" as const, origin: "manual" }],
	keys: { cites: ["AAAA2345"], related: [] },
	publishedKeys: { cites: ["AAAA2345", "GONE2345"], related: [] },
	targets: [
		{ deleted: false, itemType: "Book", key: "AAAA2345", title: "Kept book" },
		{ deleted: true, itemType: "Report", key: "GONE2345", title: "Removed report" },
		{ deleted: false, itemType: "Book", key: "SRC12345", title: "From Zotero" },
		{ deleted: false, itemType: "Book", key: "INCA2345", title: "Citing book" },
	],
};

describe("planAdminLinks", () => {
	it("marks drafted, removed and source rows and lists who cites this record", () => {
		const plan = planAdminLinks({
			keys: { cites: ["AAAA2345", "NEWW2345"], related: [] },
			knownTargets: [
				{ deleted: false, itemType: "Thesis", key: "NEWW2345", title: "Just picked" },
			],
			links,
			sources,
		});
		expect(plan.outgoing.cites.map((row) => [row.key, row.change, row.removable])).toEqual([
			["AAAA2345", "unchanged", true],
			["NEWW2345", "added", true],
			["GONE2345", "removed", false],
		]);
		expect(plan.outgoing.cites[1]!.title).toBe("Just picked");
		expect(plan.outgoing.cites[2]!.deleted).toBe(true);
		expect(plan.outgoing.related).toEqual([
			expect.objectContaining({
				key: "SRC12345",
				origin: "source:zotero-main",
				removable: false,
				sourceLabel: "Main Zotero group",
				title: "From Zotero",
			}),
		]);
		expect(plan.citedBy.map((row) => [row.title, row.removable])).toEqual([
			["Citing book", false],
		]);
	});

	it("falls back to the key when a source is unknown", () => {
		expect(sourceLabelForOrigin("source:other", sources)).toBe("other");
		expect(sourceLabelForOrigin("manual", sources)).toBeNull();
	});
});

describe("pickableLinkTargets", () => {
	it("hides the record itself and records already linked", () => {
		expect(
			pickableLinkTargets(
				[{ key: "SELF2345" }, { key: "AAAA2345" }, { key: "FREE2345" }],
				{ excludeKeys: ["AAAA2345"], selfKey: "SELF2345" },
			),
		).toEqual([{ key: "FREE2345" }]);
	});
});
