import { describe, expect, it } from "vitest";

import {
	collectionDropIsAllowed,
	recordDropIsAllowed,
} from "@/components/admin/AdminDragDropProvider";
import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

function collection(
	key: string,
	sourceConnectionKey: string,
	options: Partial<AdminCollectionCatalogEntry> = {},
): AdminCollectionCatalogEntry {
	return {
		ancestors: [],
		deleted: false,
		hasChildren: false,
		key,
		name: key,
		parentCollection: null,
		revision: 1,
		sortOrder: 1024,
		sourceConnectionKey,
		updatedAt: "2026-08-10T00:00:00.000Z",
		...options,
	};
}

describe("admin collection drag destinations", () => {
	const dragged = collection("DRAG2345", "zotero-main");

	it("allows root and same-source destinations", () => {
		expect(
			collectionDropIsAllowed(dragged, {
				position: "root",
				targetCollection: null,
			}),
		).toBe(true);
		expect(
			collectionDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "SAME2345",
				targetEntry: collection("SAME2345", "zotero-main"),
			}),
		).toBe(true);
	});

	it("rejects cross-source, deleted, self, and descendant destinations", () => {
		expect(
			collectionDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "OTHR2345",
				targetEntry: collection("OTHR2345", "zotero-secondary"),
			}),
		).toBe(false);
		expect(
			collectionDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "DEAD2345",
				targetEntry: collection("DEAD2345", "zotero-main", {
					deleted: true,
				}),
			}),
		).toBe(false);
		expect(
			collectionDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: dragged.key,
				targetEntry: dragged,
			}),
		).toBe(false);
		expect(
			collectionDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "CHLD2345",
				targetEntry: collection("CHLD2345", "zotero-main", {
					ancestors: [{ key: dragged.key, name: dragged.name }],
				}),
			}),
		).toBe(false);
	});
});

describe("admin record collection destinations", () => {
	const dragged = {
		focusKey: "ITEM2345",
		itemKeys: ["ITEM2345"],
		kind: "records" as const,
		label: "An item",
		sourceConnectionKey: "zotero-main",
	};

	it("allows live native and same-source collections", () => {
		expect(
			recordDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "NATIVE01",
				targetEntry: collection("NATIVE01", "native"),
			}),
		).toBe(true);
		expect(
			recordDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "SAME2345",
				targetEntry: collection("SAME2345", "zotero-main"),
			}),
		).toBe(true);
	});

	it("rejects deleted and unrelated external collections", () => {
		expect(
			recordDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "OTHR2345",
				targetEntry: collection("OTHR2345", "zotero-secondary"),
			}),
		).toBe(false);
		expect(
			recordDropIsAllowed(dragged, {
				position: "inside",
				targetCollection: "DEAD2345",
				targetEntry: collection("DEAD2345", "zotero-main", {
					deleted: true,
				}),
			}),
		).toBe(false);
	});
});
