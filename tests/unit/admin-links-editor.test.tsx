// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminItemDetail, AdminSource } from "@/lib/admin/types";

vi.mock("server-only", () => ({}));

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
		sourceFields: [], importedTopics: [], importChecks: null, openalexId: null, addedPaper: false, withdrawn: false,
		kind: "created",
		importMethod: null,
		attachments: [],
		collectionKeys: [],
		creators: [],
		date: null,
		draft: null,
		editable: true,
		fileDraft: null,
		filePublication: null,
		fileRemovalPending: false,
		openAccessFromSources: null,
		readingStudyType: null,
		fileState: "none",
		itemType: "Book",
		key: "SELF2345",
		links: {
			fromSources: [{ key: "SRCA2345", kind: "related", origin: "source:zotero-main" }],
			citedBy: [{ key: "INCA2345", kind: "cites", origin: "manual" }],
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
		sourcePdf: null,
		sourcePdfChangePending: false,
		state: "published",
		tags: [],
		title: "Self",
		updatedAt: "2026-01-01T00:00:00.000Z",
		writeback: {
			available: [],
			originSourceKey: null,
			selected: [],
		},
	};
}

describe("AdminLinksEditor", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(document, "fonts");
	});

	async function render(
		payload: Record<string, unknown>,
		onChange = vi.fn(),
		readOnly = false,
		pick: {
			onStartPick?: (kind: "cites" | "related") => void;
			onStopPick?: () => void;
			pickingKind?: "cites" | "related" | null;
		} = {},
	) {
		await act(async () => {
			root.render(
				<AdminLinksEditor
					detail={detail()}
					errors={{}}
					knownTargets={[
						{ deleted: false, itemType: "Thesis", key: "NEWW2345", title: "Just picked" },
					]}
					onChange={onChange}
					onStartPick={pick.onStartPick}
					onStopPick={pick.onStopPick}
					payload={payload}
					pickingKind={pick.pickingKind ?? null}
					readOnly={readOnly}
					sources={sources}
				/>,
			);
		});
		return onChange;
	}

	async function selectTab(label: "References" | "Related" | "Citations") {
		const tab = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
		expect(tab).not.toBeNull();
		await act(async () => tab!.click());
		expect(tab!.getAttribute("aria-pressed")).toBe("true");
	}

	it("switches link kinds while keeping source and incoming links read only", async () => {
		await render({
			itemType: "Book",
			links: { cites: ["AAAA2345", "NEWW2345"], related: [] },
		});
		await selectTab("References");

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


		await selectTab("Related");
		const sourceRow = container.querySelector('[data-admin-link-key="SRCA2345"]');
		expect(sourceRow?.getAttribute("data-admin-link-origin")).toBe("source:zotero-main");
		expect(sourceRow?.querySelector('button[aria-label^="Remove"]')).toBeNull();
		expect(sourceRow?.querySelector('[aria-label="Read only"]')).not.toBeNull();
		expect(sourceRow?.textContent).toContain("Main Zotero group");

		await selectTab("Citations");
		const incoming = container.querySelector('[data-admin-link-list="citedBy"]');
		expect(incoming?.textContent).toContain("Citing book");
		expect(incoming?.querySelector('button[aria-label^="Remove"]')).toBeNull();
	});

	it("removes a manual link through onChange and keeps everything else", async () => {
		const onChange = await render({
			itemType: "Book",
			links: { cites: ["AAAA2345"], related: ["BBBB2345"] },
		});
		const remove = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Remove Kept book from References"]',
		);
		expect(remove).not.toBeNull();
		await act(async () => remove!.click());
		expect(onChange).toHaveBeenCalledWith({
			itemType: "Book",
			links: { cites: [], related: ["BBBB2345"] },
		});
	});

	it("hands picking over to the record table instead of opening a dialog", async () => {
		const onStartPick = vi.fn();
		const onStopPick = vi.fn();
		await render({ itemType: "Book", links: { cites: [], related: [] } }, vi.fn(), false, {
			onStartPick,
			onStopPick,
		});
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		const add = container.querySelector<HTMLButtonElement>('[data-admin-link-pick="cites"]');
		expect(add?.disabled).toBe(false);
		await act(async () => add!.click());
		expect(onStartPick).toHaveBeenCalledWith("cites");

		await render({ itemType: "Book", links: { cites: [], related: [] } }, vi.fn(), false, {
			onStartPick,
			onStopPick,
			pickingKind: "cites",
		});
		const done = container.querySelector<HTMLButtonElement>('[data-admin-link-pick="cites"]');
		expect(done?.getAttribute("aria-pressed")).toBe("true");
		await act(async () => done!.click());
		expect(onStopPick).toHaveBeenCalled();
	});

	it("opens a linked record when its title is clicked", async () => {
		const onOpenRecord = vi.fn();
		await act(async () => {
			root.render(
				<AdminLinksEditor
					detail={detail()}
					errors={{}}
					onChange={vi.fn()}
					onOpenRecord={onOpenRecord}
					payload={{ itemType: "Book", links: { cites: ["AAAA2345"], related: [] } }}
					readOnly={false}
					sources={sources}
				/>,
			);
		});
		const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open Kept book"]');
		expect(open).not.toBeNull();
		await act(async () => open!.click());
		expect(onOpenRecord).toHaveBeenCalledWith("AAAA2345");
		await selectTab("Citations");
		// Incoming rows open too
		const openIncoming = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Citing book"]',
		);
		expect(openIncoming).not.toBeNull();
	});

	it("keeps adding disabled and prevents mutation when read only", async () => {
		const onStartPick = vi.fn();
		const onChange = vi.fn();
		await render({ itemType: "Book", links: { cites: ["AAAA2345"], related: [] } }, onChange, true, { onStartPick });
		for (const kind of ["References", "Related"] as const) {
			await selectTab(kind);
			const add = container.querySelector<HTMLButtonElement>("button[data-admin-link-pick]");
			expect(add?.disabled).toBe(true);
			await act(async () => add!.click());
			expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
		}
		await selectTab("Citations");
		expect(container.querySelector("button[data-admin-link-pick]")).toBeNull();
		expect(onStartPick).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
	});
});
