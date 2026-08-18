// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminItemDetail, AdminSource } from "@/lib/admin/types";

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/admin-api", () => ({
	getAdminItems: vi.fn(async () => ({ hasMore: false, items: [], nextCursor: null })),
}));

import { AdminLinksEditor } from "@/components/admin/AdminLinksEditor";

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

function detail(): AdminItemDetail {
	return {
		attachments: [],
		collectionKeys: [],
		creators: [],
		date: null,
		draft: null,
		editable: true,
		fileDraft: null,
		filePublication: null,
		fileState: "none",
		itemType: "Book",
		key: "SELF2345",
		links: {
			fromSources: [{ key: "SRCA2345", kind: "related", origin: "source:zotero-main" }],
			incoming: [{ key: "INCA2345", kind: "cites", origin: "manual" }],
			keys: { cites: ["AAAA2345"], related: [] },
			publishedKeys: { cites: ["AAAA2345", "GONE2345"], related: [] },
			targets: [
				{ deleted: false, itemType: "Book", key: "AAAA2345", title: "Kept book" },
				{ deleted: false, itemType: "Report", key: "GONE2345", title: "Removed report" },
				{ deleted: false, itemType: "Book", key: "SRCA2345", title: "From Zotero" },
				{ deleted: false, itemType: "Book", key: "INCA2345", title: "Citing book" },
			],
		},
		parentItem: null,
		parentState: null,
		published: { itemType: "Book", title: "Self" },
		publishedCollectionKeys: [],
		publishedTags: [],
		revision: 2,
		sourceConnectionKey: "native",
		sourceFileUrl: null,
		state: "published",
		tags: [],
		title: "Self",
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

describe("AdminLinksEditor", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function render(
		payload: Record<string, unknown>,
		onChange = vi.fn(),
		readOnly = false,
	) {
		await act(async () => {
			root.render(
				<AdminLinksEditor
					detail={detail()}
					errors={{}}
					onChange={onChange}
					payload={payload}
					readOnly={readOnly}
					sources={sources}
				/>,
			);
		});
		return onChange;
	}

	it("shows the four lists with change markers and locked source rows", async () => {
		await render({
			itemType: "Book",
			links: { cites: ["AAAA2345", "NEWW2345"], related: [] },
		});
		const headings = [...container.querySelectorAll("h4")].map((node) => node.textContent);
		expect(headings).toEqual(["Cites", "Related", "Cited by", "Related to this record"]);

		const cites = [...container.querySelectorAll('[data-admin-link-kind="cites"]')]
			.filter((node) => node.closest('[data-admin-link-list="cites"]'))
			.map((node) => [
				node.getAttribute("data-admin-link-key"),
				node.getAttribute("data-admin-link-change"),
			]);
		expect(cites).toEqual([
			["AAAA2345", "unchanged"],
			["NEWW2345", "added"],
			["GONE2345", "removed"],
		]);
		expect(container.textContent).toContain("Added in this draft");
		expect(container.textContent).toContain("Removed in this draft");

		const sourceRow = container.querySelector('[data-admin-link-key="SRCA2345"]');
		expect(sourceRow?.getAttribute("data-admin-link-origin")).toBe("source:zotero-main");
		expect(sourceRow?.querySelector("button")).toBeNull();
		expect(sourceRow?.querySelector('[aria-label="Read only"]')).not.toBeNull();
		expect(sourceRow?.textContent).toContain("Main Zotero group");

		const incoming = container.querySelector('[data-admin-link-incoming="cites"]');
		expect(incoming?.textContent).toContain("Citing book");
		expect(incoming?.querySelector("button")).toBeNull();
	});

	it("removes a manual link through onChange and keeps everything else", async () => {
		const onChange = await render({
			itemType: "Book",
			links: { cites: ["AAAA2345"], related: ["BBBB2345"] },
		});
		const remove = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Remove Kept book from Cites"]',
		);
		expect(remove).not.toBeNull();
		await act(async () => remove!.click());
		expect(onChange).toHaveBeenCalledWith({
			itemType: "Book",
			links: { cites: [], related: ["BBBB2345"] },
		});
	});

	it("offers no add or remove controls when read only", async () => {
		await render({ itemType: "Book", links: { cites: ["AAAA2345"], related: [] } }, vi.fn(), true);
		expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
		expect(container.textContent).not.toContain("Add to Cites");
	});
});
