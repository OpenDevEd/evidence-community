// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSource } from "@/lib/admin/types";
import type { SourceStatus } from "@/lib/source-ingestion/source-status";

const mocks = vi.hoisted(() => ({
	api: {
		dismissAdminSourceIssues: vi.fn(),
		getAdminSourceIssuePage: vi.fn(),
		getAdminSourceIssueTypes: vi.fn(),
		restoreAdminSourceIssues: vi.fn(),
	},
	toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/components/admin/admin-api", () => mocks.api);
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { AdminSourceStatusBadge, AdminSourceStatusDialog } from "@/components/admin/AdminSourceStatus";

const base = { issues: {}, key: "zotero-main", lastSuccessAt: "2026-09-26T18:10:00.000Z", pdfs: null, provider: "zotero" as const, searchFailed: 0 };

function source(activity: SourceStatus): AdminSource {
	return {
		activity,
		collectionCount: 0,
		externalScopeKey: "2129771",
		key: "zotero-main",
		label: "ODEN docs",
		provider: "zotero",
		readOnly: true,
		scopeKind: "group",
		status: "active",
		writeback: { enabled: false, supported: true },
	};
}

const issue = (key: string) => ({
	detail: null,
	itemKey: `ITEM${key}`,
	links: [{ href: `https://www.zotero.org/groups/2129771/items/${key}`, kind: "zotero-web" as const }],
	message: `Zotero attachment ${key}: a published PDF must have a valid filename and MD5`,
	meta: "Piper et al. 2018",
	sourceRecordKey: key,
	title: `Report ${key}`,
});

describe("the admin's source status dialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		// jsdom lays nothing out: every observed box reports room for ten rows.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(private readonly report: ResizeObserverCallback) {}
				observe() {
					queueMicrotask(() => this.report([{ contentRect: { height: 440 } } as ResizeObserverEntry], this as never));
				}
				unobserve() {}
				disconnect() {}
			},
		);
		Element.prototype.getAnimations ??= () => [];
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		mocks.api.getAdminSourceIssueTypes.mockResolvedValue({ types: [] });
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(document, "fonts");
	});

	async function open(activity: SourceStatus, extra: { onOpenRecord?: (key: string) => void; onClose?: () => void } = {}) {
		await act(async () =>
			root.render(
				<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
					<AdminSourceStatusDialog
						configurationHref="https://openscholar.test/evidence-libraries/lib1/configuration?section=sources"
						onClose={extra.onClose ?? vi.fn()}
						onIssuesChanged={vi.fn()}
						onOpenRecord={extra.onOpenRecord ?? vi.fn()}
						source={source(activity)}
					/>
				</SWRConfig>,
			),
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
	}

	const progress = () => document.querySelector('[role="progressbar"]');

	it("shows how far an import is, and runs the bar without a number when the total is unknown", async () => {
		const running = { ...base, changed: null, searchable: null, state: "running" as const, phase: "import" as const, done: 3_200, startedAt: "2026-09-27T12:04:00.000Z", minutesLeft: 4 };
		await open({ ...running, total: 12_800 });
		expect(progress()?.getAttribute("aria-label")).toBe("Import progress");
		expect(progress()?.getAttribute("aria-valuenow")).toBe("25");

		await open({ ...running, total: null });
		expect(progress()?.hasAttribute("aria-valuenow")).toBe(false);

		await open({ ...running, phase: "search", total: 12_800 });
		expect(progress()?.getAttribute("aria-label")).toBe("Search update progress");
	});

	it("shows the PDF step once the records are in, counting PDFs added and those that could not be downloaded", async () => {
		await open({
			...base,
			changed: null,
			searchable: 12_000,
			state: "running",
			phase: "pdfs",
			done: 3_000,
			total: 6_000,
			startedAt: "2026-09-27T12:04:00.000Z",
			minutesLeft: 150,
			pdfs: { added: 2_400, missed: 600 },
		});
		expect(document.body.textContent).toContain("Add PDFs");
		expect(document.body.textContent).toContain("of 6,000 PDFs");
		expect(progress()?.getAttribute("aria-label")).toBe("PDF progress");
		expect(progress()?.getAttribute("aria-valuenow")).toBe("3000");
		expect(document.body.textContent).toContain("600 could not be downloaded");
		expect(document.body.textContent).toContain("3 h left");
	});

	it("sends a failed import to the library's configuration, with the raw error one press away", async () => {
		await open({
			...base,
			changed: 14,
			searchable: 12_000,
			state: "failed",
			failure: { code: "access_denied", details: "ZoteroApiError 403 Forbidden", at: "2026-09-27T12:04:00.000Z" },
		});
		const link = [...document.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes("Open configuration"));
		expect(link?.getAttribute("href")).toBe("https://openscholar.test/evidence-libraries/lib1/configuration?section=sources");
		const details = document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
		expect(document.body.textContent).not.toContain("ZoteroApiError 403 Forbidden");
		await act(async () => details.click());
		expect(document.body.textContent).toContain("ZoteroApiError 403 Forbidden");
	});

	it("says there is nothing to fix from the first frame when the status counts no issues", async () => {
		// The issue list never arrives: the dialog must not wait for it to say so.
		mocks.api.getAdminSourceIssueTypes.mockReturnValue(new Promise(() => {}));
		await open({ ...base, changed: 14, searchable: 12_000, state: "succeeded", issues: {} });
		expect(document.body.textContent).toContain("No record issues to fix.");
	});

	it("does not ask for record issues before the first import", async () => {
		await open({ ...base, changed: null, lastSuccessAt: null, searchable: 0, state: "idle" });
		expect(mocks.api.getAdminSourceIssueTypes).not.toHaveBeenCalled();
		expect(document.querySelector('[aria-label="Record issues"]')).toBeNull();
	});

	it("dismisses a record's issue at once, undoes that dismissal, and opens a record in the editor", async () => {
		let open_ = [issue("AAAA1111"), issue("BBBB2222")];
		mocks.api.getAdminSourceIssueTypes.mockImplementation(async () => ({
			types: [{ count: open_.length, key: "pdf-not-uploaded", kind: "pdf", next: "Upload the files.", title: "PDF not published" }],
		}));
		mocks.api.getAdminSourceIssuePage.mockImplementation(async () => ({ count: open_.length, issues: open_ }));
		mocks.api.dismissAdminSourceIssues.mockImplementation(async () => {
			open_ = [issue("BBBB2222")];
			return { batch: "2026-09-27T12:05:00.000Z", count: 1 };
		});
		mocks.api.restoreAdminSourceIssues.mockResolvedValue({ count: 1 });
		const onOpenRecord = vi.fn();
		await open({ ...base, changed: 14, searchable: 12_000, state: "succeeded", issues: { zotero_file_metadata_invalid: 2 } }, { onOpenRecord });

		const dismiss = document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss issue: Report AAAA1111"]')!;
		await act(async () => dismiss.click());
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		expect(mocks.api.dismissAdminSourceIssues).toHaveBeenCalledWith("zotero-main", { record: "AAAA1111" });
		expect(document.querySelector('button[aria-label="Dismiss issue: Report AAAA1111"]')).toBeNull();

		const [, options] = mocks.toast.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];
		await act(async () => options.action.onClick());
		expect(mocks.api.restoreAdminSourceIssues).toHaveBeenCalledWith("zotero-main", "2026-09-27T12:05:00.000Z");

		await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Edit record: Report BBBB2222"]')!.click());
		expect(onOpenRecord).toHaveBeenCalledWith("ITEMBBBB2222");
	});

	it("puts an issue back when its dismissal fails", async () => {
		mocks.api.getAdminSourceIssueTypes.mockResolvedValueOnce({
			types: [{ count: 1, key: "pdf-not-uploaded", kind: "pdf", next: "Upload the files.", title: "PDF not published" }],
		});
		mocks.api.getAdminSourceIssuePage.mockResolvedValueOnce({ count: 1, issues: [issue("AAAA1111")] });
		await open({ ...base, changed: 14, searchable: 12_000, state: "succeeded", issues: { zotero_file_metadata_invalid: 1 } });
		// The server refuses, and so does the refresh after it.
		mocks.api.dismissAdminSourceIssues.mockRejectedValue(new Error("offline"));
		mocks.api.getAdminSourceIssueTypes.mockRejectedValue(new Error("offline"));
		mocks.api.getAdminSourceIssuePage.mockRejectedValue(new Error("offline"));

		await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss issue: Report AAAA1111"]')!.click());
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		expect(mocks.toast.error).toHaveBeenCalled();
		expect(document.querySelector('button[aria-label="Dismiss issue: Report AAAA1111"]')).not.toBeNull();
	});

	it("never shows one source's issues under another source's name", async () => {
		mocks.api.getAdminSourceIssueTypes.mockResolvedValueOnce({
			types: [{ count: 2, key: "fields", kind: "fields", next: "Fix the fields.", title: "Some fields were left out" }],
		});
		mocks.api.getAdminSourceIssuePage.mockResolvedValue({ count: 2, issues: [issue("AAAA1111"), issue("BBBB2222")] });
		const succeeded = { ...base, changed: 14, searchable: 12_000, state: "succeeded" as const, issues: { zotero_fields_dropped: 2 } };
		await open(succeeded);
		expect(document.querySelector('[aria-label="Record issues"]')).not.toBeNull();

		// The next source's issues are still loading.
		mocks.api.getAdminSourceIssueTypes.mockReturnValueOnce(new Promise(() => {}));
		await act(async () =>
			root.render(
				<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
					<AdminSourceStatusDialog
						configurationHref="https://openscholar.test/configuration"
						onClose={vi.fn()}
						onIssuesChanged={vi.fn()}
						onOpenRecord={vi.fn()}
						source={{ ...source({ ...succeeded, key: "openalex-main", provider: "openalex" }), key: "openalex-main", label: "Tusome", provider: "openalex" }}
					/>
				</SWRConfig>,
			),
		);
		expect(document.querySelector('[aria-label="Record issues"]')).toBeNull();
	});

	it("names the state and the open issues on the sidebar badge", async () => {
		const onClick = vi.fn();
		await act(async () =>
			root.render(
				<AdminSourceStatusBadge
					activity={{ ...base, changed: 14, searchable: 12_000, state: "succeeded", issues: { a: 2, b: 1 } }}
					label="ODEN docs"
					onClick={onClick}
				/>,
			),
		);
		const badge = container.querySelector("button")!;
		expect(badge.getAttribute("aria-label")).toBe("ODEN docs import: Up to date, 3 record issues");
		await act(async () => badge.click());
		expect(onClick).toHaveBeenCalledTimes(1);

		// Records that never reached search are not up to date, whatever the import says.
		await act(async () =>
			root.render(
				<AdminSourceStatusBadge
					activity={{ ...base, changed: 14, searchable: 12_000, searchFailed: 2, state: "succeeded" }}
					label="ODEN docs"
					onClick={onClick}
				/>,
			),
		);
		expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("ODEN docs import: Up to date, 2 not in search");
	});
});
