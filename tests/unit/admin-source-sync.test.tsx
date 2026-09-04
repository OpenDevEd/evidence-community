// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSource, AdminSourceSync } from "@/lib/admin/types";

const testState = vi.hoisted(() => ({
	api: {
		getAdminSourceIssues: vi.fn(),
		setAdminSourceIssueDismissed: vi.fn(),
	},
	swrResult: {
		data: undefined as Record<string, unknown> | undefined,
		error: undefined as unknown,
		isLoading: false,
		mutate: vi.fn(),
	},
}));

vi.mock("server-only", () => ({}));
vi.mock("swr", () => ({ default: () => testState.swrResult }));
vi.mock("@/components/admin/admin-api", () => testState.api);

import {
	AdminSourceSyncBadge,
	AdminSourceSyncPanel,
} from "@/components/admin/AdminSourceSyncDialog";

const source: AdminSource = {
	collectionCount: 0,
	key: "zotero-main",
	label: "Zotero · group-42",
	provider: "zotero",
	readOnly: true,
	status: "active",
	sync: null,
	writeback: { enabled: false, supported: true },
};

function sync(changes: Partial<AdminSourceSync> = {}): AdminSourceSync {
	return {
		issueCount: 0,
		lastError: null,
		lastFailureAt: null,
		lastRecords: null,
		lastSuccessAt: null,
		processed: null,
		runningSince: null,
		status: "idle",
		...changes,
	};
}

describe("source import state in the admin", () => {
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

	async function render(node: React.ReactNode) {
		await act(async () => root.render(node));
	}

	it("announces the import state and the issue count on the sidebar badge", async () => {
		const onClick = vi.fn();
		await render(
			<AdminSourceSyncBadge
				label={source.label}
				onClick={onClick}
				sync={sync({ issueCount: 3, status: "failed" })}
			/>,
		);
		const badge = container.querySelector("button")!;
		expect(badge.getAttribute("aria-label")).toBe(
			"Zotero · group-42 import: Last import failed, 3 record issues",
		);
		expect(badge.textContent).toBe("3");
		await act(async () => badge.click());
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("shows the running import, the last failure, and lets the issues open a record", async () => {
		testState.swrResult = {
			data: {
				issues: [
					{
						attachmentFilename: "Hassler et al. - 2018.pdf",
						code: "zotero_file_metadata_invalid",
						dismissedAt: null,
						itemKey: "ITEM0001",
						message: "Zotero attachment 5HKK3TV9: a published PDF must have a valid filename and MD5",
						sourceRecordKey: "5HKK3TV9",
						title: "Sustaining and Scaling Pedagogic Innovation",
						updatedAt: "2026-09-04T10:00:00.000Z",
					},
					{
						// One saved issue with two failures: a dropped field and a
						// linked attachment without a URL.
						attachmentFilename: "notes.pdf",
						code: "zotero_fields_dropped",
						dismissedAt: null,
						itemKey: "ITEM0002",
						message:
							"Some fields could not be stored and were left out: url (This value is too long). Zotero attachment BBBB2345: a published linked URL must have a valid URL",
						sourceRecordKey: "BBBB2345",
						title: "Report with a linked file",
						updatedAt: "2026-09-04T09:00:00.000Z",
					},
				],
				dismissedTotal: 1,
				hasMore: true,
				nextCursor: "page-2",
				total: 250,
			},
			error: undefined,
			isLoading: false,
			mutate: vi.fn(),
		};
		const onOpenRecord = vi.fn();
		await render(
			<AdminSourceSyncPanel
				onIssuesChanged={vi.fn()}
				onOpenRecord={onOpenRecord}
				source={source}
				sync={sync({
					lastError: "Check date and try again.",
					lastFailureAt: "2026-09-04T08:00:00.000Z",
					lastRecords: 500,
					lastSuccessAt: "2026-09-03T08:00:00.000Z",
					processed: 1_500,
					runningSince: "2026-09-04T11:55:00.000Z",
					status: "running",
				})}
			/>,
		);
		const text = container.textContent ?? "";
		expect(text).toContain("Importing");
		expect(text).toContain("1,500 records processed so far");
		expect(text).toContain("500 records.");
		expect(text).toContain("Check date and try again.");

		expect(text).toContain("Showing 2 of 250 open issues.");
		const rows = container.querySelectorAll("[data-admin-source-issues] li");
		expect(rows).toHaveLength(2);
		// The reader sees the parent record, the file, what happened, and what
		// to do, not the worker's technical message alone.
		const first = rows[0]!.textContent ?? "";
		expect(first).toContain("Sustaining and Scaling Pedagogic Innovation");
		expect(first).toContain("File: Hassler et al. - 2018.pdf");
		expect(first).toContain("PDF not published");
		expect(first).toContain("Zotero has no uploaded copy of this file");
		expect(first).toContain("Details: Zotero attachment 5HKK3TV9");
		const second = rows[1]!.textContent ?? "";
		expect(second).toContain("Some fields were left out; PDF not published");
		expect(second).toContain("add the URL to the attachment");
		expect(second).not.toContain("group storage");
		expect(rows[1]!.textContent).toContain("BBBB2345");
		await act(async () => rows[0]!.querySelector("button")!.click());
		expect(onOpenRecord).toHaveBeenCalledWith("ITEM0001");
	});

	it("says so when there are no issues", async () => {
		testState.swrResult = {
			data: { dismissedTotal: 0, hasMore: false, issues: [], nextCursor: null, total: 0 },
			error: undefined,
			isLoading: false,
			mutate: vi.fn(),
		};
		await render(
			<AdminSourceSyncPanel
				onIssuesChanged={vi.fn()}
				onOpenRecord={vi.fn()}
				source={source}
				sync={sync({ lastSuccessAt: "2026-09-03T08:00:00.000Z", status: "succeeded" })}
			/>,
		);
		expect(container.textContent).toContain("No open record issues");
		expect(container.querySelector("[data-admin-source-issues]")).toBeNull();
	});

	it("dismisses an issue, refreshes the list, and tells the sidebar", async () => {
		const issue = {
			attachmentFilename: null,
			code: "zotero_fields_dropped",
			dismissedAt: null,
			itemKey: "ITEM0001",
			message: "Some fields could not be stored and were left out: creators.",
			sourceRecordKey: "AAAA2345",
			title: "Paper",
			updatedAt: "2026-09-04T10:00:00.000Z",
		};
		const mutate = vi.fn();
		testState.swrResult = {
			data: { dismissedTotal: 0, hasMore: false, issues: [issue], nextCursor: null, total: 1 },
			error: undefined,
			isLoading: false,
			mutate,
		};
		testState.api.setAdminSourceIssueDismissed.mockResolvedValue({
			dismissedAt: "2026-09-04T12:00:00.000Z",
		});
		const onIssuesChanged = vi.fn();
		await render(
			<AdminSourceSyncPanel
				onIssuesChanged={onIssuesChanged}
				onOpenRecord={vi.fn()}
				source={source}
				sync={sync({ issueCount: 1, status: "succeeded" })}
			/>,
		);
		const dismiss = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Dismiss issue: Paper"]',
		)!;
		await act(async () => dismiss.click());
		expect(testState.api.setAdminSourceIssueDismissed).toHaveBeenCalledWith(
			"zotero-main",
			"AAAA2345",
			true,
		);
		expect(mutate).toHaveBeenCalledTimes(1);
		expect(onIssuesChanged).toHaveBeenCalledTimes(1);
	});

	it("loads the next page after the first and keeps the earlier rows", async () => {
		const row = (key: string) => ({
			attachmentFilename: null,
			code: "zotero_fields_dropped",
			dismissedAt: null,
			itemKey: key,
			message: "Some fields could not be stored and were left out: creators.",
			sourceRecordKey: key,
			title: `Paper ${key}`,
			updatedAt: "2026-09-04T10:00:00.000Z",
		});
		testState.swrResult = {
			data: { dismissedTotal: 0, hasMore: true, issues: [row("AAAA2345")], nextCursor: "c1", total: 2 },
			error: undefined,
			isLoading: false,
			mutate: vi.fn(),
		};
		testState.api.getAdminSourceIssues.mockResolvedValue({
			dismissedTotal: 0,
			hasMore: false,
			issues: [row("BBBB2345")],
			nextCursor: null,
			total: 2,
		});
		await render(
			<AdminSourceSyncPanel
				onIssuesChanged={vi.fn()}
				onOpenRecord={vi.fn()}
				source={source}
				sync={sync({ issueCount: 2, status: "succeeded" })}
			/>,
		);
		const loadMore = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Load more",
		)!;
		await act(async () => loadMore.click());
		expect(testState.api.getAdminSourceIssues).toHaveBeenCalledWith("zotero-main", {
			cursor: "c1",
			dismissed: false,
		});
		expect(container.querySelectorAll("[data-admin-source-issues] li")).toHaveLength(2);
		expect(container.textContent).toContain("Showing 2 of 2 open issues.");
		expect(
			[...container.querySelectorAll("button")].some((button) => button.textContent === "Load more"),
		).toBe(false);
	});
});
