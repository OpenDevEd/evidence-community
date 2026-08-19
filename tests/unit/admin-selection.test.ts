import { describe, expect, it } from "vitest";

import { resolveAdminSelection } from "@/lib/admin/selection";
import type { AdminItemDetail } from "@/lib/admin/types";

function attachmentDetail(key: string): AdminItemDetail {
	return {
		attachments: [],
		collectionKeys: [],
		creators: [],
		date: null,
		draft: null,
		editable: true,
		fileDraft: null,
		filePublication: null,
		links: {
			fromSources: [],
			incoming: [],
			keys: { cites: [], related: [] },
			publishedKeys: { cites: [], related: [] },
			targets: [],
		},
		fileState: "none",
		itemType: "Attachment",
		key,
		parentItem: "PARENT01",
		parentState: "published",
		published: {},
		publishedCollectionKeys: [],
		publishedTags: [],
		revision: 1,
		sourceConnectionKey: "native",
		sourceFileUrl: null,
		state: "published",
		tags: [],
		title: "Attachment",
		updatedAt: "2026-01-01T00:00:00.000Z",
		writeback: {
			effective: false,
			itemEnabled: false,
			reason: "not-linked",
			sourceEnabled: false,
			sourceKey: null,
			sourceLabel: null,
			sourceStatus: null,
			supported: false,
		},
	};
}

describe("resolveAdminSelection", () => {
	it("preserves a visible top-level selection", () => {
		expect(
			resolveAdminSelection(
				"ITEM0001",
				new Set(["ITEM0001"]),
				null,
				"ITEM0001",
			),
		).toBe("ITEM0001");
	});

	it("preserves the selected attachment across top-level list refreshes", () => {
		const detail = attachmentDetail("ATTACH01");
		expect(
			resolveAdminSelection(
				detail.key,
				new Set(["ITEM0001"]),
				detail,
				"ITEM0001",
			),
		).toBe("ATTACH01");
	});

	it("falls back when the previous top-level selection disappeared", () => {
		expect(
			resolveAdminSelection(
				"OLDITEM1",
				new Set(["ITEM0001"]),
				null,
				"ITEM0001",
			),
		).toBe("ITEM0001");
	});

	it("keeps the open record selected while it is pinned, even when hidden", () => {
		expect(
			resolveAdminSelection("OPEN2345", new Set(["AAAA2345"]), null, "AAAA2345", {
				pinned: true,
			}),
		).toBe("OPEN2345");
		expect(
			resolveAdminSelection("OPEN2345", new Set(["AAAA2345"]), null, "AAAA2345"),
		).toBe("AAAA2345");
	});
});
