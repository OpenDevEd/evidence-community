// @vitest-environment jsdom
import { DraftConflict } from "@/components/admin/DraftConflict";
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorialInspector } from "@/components/admin/EditorialInspector";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { AdminReviewSnapshot } from "@/components/admin/admin-api";
import type { AdminItemDetail } from "@/lib/admin/types";
import { minimalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const config = projectPublicLibraryConfig(
	libraryConfigSchema.parse(minimalLibraryConfig),
);
const payload = {
	itemType: "book",
	title: "Submitted title",
	creators: [],
	tags: [],
	collections: [],
};
const submitted: AdminReviewSnapshot = {
	key: "BOOK2345",
	kind: "imported",
	importMethod: "doi",
	itemType: "book",
	title: payload.title,
	date: null,
	creators: [],
	state: "draft",
	revision: 0,
	sourceConnectionKey: "native",
	updatedAt: "2026-09-09T09:00:00Z",
	draft: {
		itemKey: "BOOK2345",
		baseRevision: 0,
		draftRevision: 1,
		generation: "db3932e0-eaec-4c46-89c9-2c76411bc1ab",
		patch: payload,
		payload,
		sourceConnectionKey: "native",
		createdAt: "2026-09-09T09:00:00Z",
		updatedAt: "2026-09-09T09:00:00Z",
	},
	editable: false,
	published: null,
	publishedCollectionKeys: [],
	publishedTags: [],
	tags: [],
	collectionKeys: [],
	attachments: [],
	frozenAttachments: [],
	fileState: "none",
	fileDraft: null,
	filePublication: null,
	fileRemovalPending: false,
	sourceFileUrl: null,
	links: {
		fromSources: [],
		citedBy: [],
		keys: { cites: [], related: [] },
		publishedKeys: { cites: [], related: [] },
		targets: [],
	},
	parentItem: null,
	parentState: null,
	writeback: { available: [], originSourceKey: null, selected: [] },
	reviewId: "edd606b7-a61f-4c39-a8d6-f2a00381937c",
	reviewRevision: 1,
	reviewState: "pending",
	submittedAt: "2026-09-09T09:00:00Z",
	submittedBy: "creator",
	remainingConflicts: {},
	note: null,
	publishing: null,
};
const draftPayload = { ...payload, title: "Newer working title" };
let root: Root;
let container: HTMLDivElement;
let snapshot: AdminReviewSnapshot;
let requests: unknown[];
let childResponses: Response[];
let childRequests: string[];
const draftChanges = vi.fn();
function Inspector({ role, overrides }: { role: "editor" | "creator"; overrides?: Partial<ComponentProps<typeof EditorialInspector>> }) {
	const [working, setWorking] = useState(draftPayload);
	const noop = () => {};
	const props: ComponentProps<typeof EditorialInspector> = {
		detail: {
			...submitted,
			title: working.title,
			editable: true,
			draft: { ...submitted.draft, payload: working },
		},
		payload: working,
		reviewQueue: false,
		busy: false,
		loading: false,
		definitions: [
			{
				itemType: "book",
				fields: [{ field: "title" }],
				creatorTypes: [],
			},
		],
		sources: [],
		error: null,
		fileErrors: {},
		saveMessage: null,
		saveState: "saved",
		validationErrors: {},
		validationRevision: 0,
		onChange: (value) => {
			draftChanges(value);
			setWorking({ ...working, ...value });
		},
		onPublicationChanged: async () => {},
		onStartReviewLinkPick: noop,
		onResolveConcurrentConflict: noop,
		onBackToParent: noop,
		onCreateAttachment: noop,
		onDiscardDraft: noop,
		onDiscardFile: noop,
		onDuplicate: noop,
		onOpenDraft: noop,
		onManageSources: noop,
		onPublish: noop,
		onWritebackResolved: noop,
		onReloadDraft: noop,
		onRetry: noop,
		onRestore: noop,
		onUnpublish: noop,
		onSelectAttachment: noop,
		onChangePdfRemoval: noop,
		onUpload: noop,
		onAddPdf: noop,
	};
	return (
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<NextUIProvider disableAnimation>
				<LibraryConfigProvider config={config}>
					<AdminSessionProvider session={{ role, userId: "creator" }}>
						<EditorialInspector {...props} {...overrides} />
					</AdminSessionProvider>
				</LibraryConfigProvider>
			</NextUIProvider>
		</SWRConfig>
	);
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	}));
	snapshot = structuredClone(submitted);
	requests = [];
	childResponses = [];
	childRequests = [];
	draftChanges.mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/api/admin/items/CHILDKEY")) {
				childRequests.push(url);
				const response = childResponses.shift();
				if (response) return response;
				throw new Error(`Missing child response: ${url}`);
			}
			if (url.endsWith("/review"))
				return Response.json({
					reviews: [
						{
							id: submitted.reviewId,
							state: "pending",
							revision: snapshot.reviewRevision,
						},
					],
				});
			if (url.endsWith(submitted.reviewId)) {
				if (init?.method === "POST") {
					const body = JSON.parse(String(init.body));
					requests.push(body);
					snapshot = {
						...snapshot,
						reviewRevision: snapshot.reviewRevision + 1,
						draft: {
							...snapshot.draft,
							payload: body.records[0].payload,
						},
					};
					return Response.json({
						review: { revision: snapshot.reviewRevision },
					});
				}
				return Response.json({ snapshot });
			}
			throw new Error(`Unexpected request: ${url}`);
		}),
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(document, "fonts");
});
async function clickVersion(name: string) {
	const button = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === name,
	);
	if (!button) throw new Error(`Missing version control: ${name}`);
	await act(async () => {
		button.click();
	});
}
const titleField = () =>
	container.querySelector<HTMLInputElement>(
		'input[aria-label="Title"], input[id="admin-field-title"]',
	);

async function settleRequests() {
	await act(async () => {
		for (let index = 0; index < 5; index += 1) await Promise.resolve();
	});
}

function revisionValue(label: string) {
	const term = [...container.querySelectorAll("dt")].find(
		(entry) => entry.textContent?.trim() === label,
	);
	return term?.parentElement?.querySelector("dd")?.textContent?.trim();
}

it("saves submitted corrections without changing the newer working draft", async () => {
	await act(async () => root.render(<Inspector role="editor" />));
	await clickVersion("Submitted version");
	const field = titleField();
	expect(field?.value).toBe("Submitted title");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)!.set!.call(field, "Reviewed title");
		field!.dispatchEvent(new Event("input", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(700);
	});
	expect(requests).toEqual([
		{
			action: "correct",
			expectedRevision: 1,
			records: [
				{
					itemKey: "BOOK2345",
					baseRevision: 0,
					payload: { ...payload, title: "Reviewed title" },
				},
			],
		},
	]);
	expect(draftChanges).not.toHaveBeenCalled();
	await clickVersion("Working draft");
	expect(titleField()?.value).toBe("Newer working title");
	await clickVersion("Submitted version");
	expect(titleField()?.value).toBe("Reviewed title");
});

it("lets Creators edit the working draft while keeping the submitted version read only", async () => {
	await act(async () => root.render(<Inspector role="creator" />));
	expect(titleField()?.disabled).toBe(false);
	await clickVersion("Submitted version");
	expect(titleField()?.value).toBe("Submitted title");
	expect(titleField()?.disabled).toBe(true);
	expect(
		[...container.querySelectorAll("button")].filter(
			(button) => button.textContent?.trim() === "Publish version",
		),
	).toHaveLength(0);
	await clickVersion("Working draft");
	expect(titleField()?.value).toBe("Newer working title");
	expect(titleField()?.disabled).toBe(false);
	expect(requests).toEqual([]);
});

it("keeps attachment display tags removable through a field patch", async () => {
	const tags = ["hide", "internal", "_comingsoon", "research"];
	const attachmentPayload = {
		...payload,
		itemType: "Attachment",
		parentItem: submitted.key,
		tags,
		title: "Submitted PDF",
	};
	const change = vi.fn();
	await act(async () =>
		root.render(
			<Inspector
				role="creator"
				overrides={{
					detail: {
						...submitted,
						editable: true,
						key: "CHILDKEY",
						itemType: "Attachment",
						parentItem: submitted.key,
						parentState: "draft",
						title: "Submitted PDF",
						tags,
						draft: {
							...submitted.draft!,
							itemKey: "CHILDKEY",
							patch: attachmentPayload,
							payload: attachmentPayload,
						},
					},
					payload: attachmentPayload,
					definitions: [
						{
							itemType: "Attachment",
							fields: [{ field: "title" }],
							creatorTypes: [],
						},
					],
					onChange: change,
				}}
			/>,
		),
	);

	const closeButtons = [
		...container.querySelectorAll<HTMLElement>(
			'[aria-label^="Remove tag "]',
		),
	];
	expect(
		closeButtons.map((button) => button.getAttribute("aria-label")),
	).toEqual(
		expect.arrayContaining(tags.map((tag) => `Remove tag ${tag}`)),
	);
	const hide = closeButtons.find(
		(button) => button.getAttribute("aria-label") === "Remove tag hide",
	);
	expect(hide).toBeTruthy();
	await act(async () => hide!.click());

	const update = change.mock.calls[0]?.[0] as
		| Record<string, unknown>
		| ((current: Record<string, unknown>) => Record<string, unknown>);
	expect(update).toBeTypeOf("function");
	const current = { ...attachmentPayload, title: "Latest working title" };
	expect(
		typeof update === "function" ? update(current) : update,
	).toEqual({
		...current,
		tags: ["internal", "_comingsoon", "research"],
	});

	const tagInput = container.querySelector<HTMLInputElement>(
		'input[placeholder="Add a tag"]',
	);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)!.set!.call(tagInput, "  RESEARCH ");
		tagInput!.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(
		container.querySelector<HTMLButtonElement>('[aria-label="Add tag"]')
			?.disabled,
	).toBe(true);
	expect(container.textContent).toContain("This tag is already added.");
});

it("loads the live attachment status for a frozen submitted attachment and retries failures", async () => {
	const childPayload = {
		itemType: "Attachment",
		parentItem: submitted.key,
		title: "Submitted PDF",
		creators: [],
		tags: [],
		collections: [],
	};
	const frozenAttachment: AdminReviewSnapshot["frozenAttachments"][number] = {
		...submitted,
		key: "CHILDKEY",
		itemType: "Attachment",
		parentItem: submitted.key,
		parentState: "draft",
		title: "Submitted PDF",
		draft: {
			...submitted.draft!,
			itemKey: "CHILDKEY",
			patch: childPayload,
			payload: childPayload,
		},
	};
	const liveAttachment: AdminItemDetail = {
		...frozenAttachment,
		revision: 7,
		sourceConnectionKey: "zotero-main",
		state: "published",
		parentState: "published",
		published: childPayload,
		filePublication: {
			coverPublicUrl: "https://minimal.example.org/cover.jpg",
			filename: "submitted.pdf",
			itemKey: "CHILDKEY",
			pageCount: 12,
			publicUrl: "https://minimal.example.org/submitted.pdf",
			publishedAt: "2026-09-09T10:00:00Z",
			sha256: "a".repeat(64),
			sizeBytes: 1024,
			uploadRevision: 2,
		},
	};
	snapshot = {
		...submitted,
		attachments: [{ ...frozenAttachment, parentItem: submitted.key }],
		frozenAttachments: [frozenAttachment],
	};
	childResponses.push(
		Response.json({}, { status: 503 }),
		Response.json({ item: liveAttachment }),
	);

	await act(async () => root.render(<Inspector role="editor" />));
	await clickVersion("Submitted version");
	const attachment = container.querySelector<HTMLButtonElement>(
		'[aria-label="Open Submitted PDF"]',
	);
	expect(attachment).toBeTruthy();
	await act(async () => attachment!.click());
	await settleRequests();
	expect(container.textContent).toContain("Something went wrong. Try again.");
	const retry = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === "Try again",
	);
	expect(retry).toBeTruthy();
	await act(async () => retry!.click());
	await settleRequests();

	expect(childRequests).toEqual([
		"/api/admin/items/CHILDKEY",
		"/api/admin/items/CHILDKEY",
	]);
	const publicLink = container.querySelector<HTMLAnchorElement>(
		'a[aria-label="Open public item"]',
	);
	expect(publicLink?.href).toBe(
		"https://minimal.example.org/lib/BOOK2345/download/CHILDKEY",
	);
	expect(revisionValue("Source")).toBe("Zotero Main");
	expect(revisionValue("Published revision")).toBe("7");
});

it("shows report conflict values under form field names and preserves the server choice keys", async () => {
	const resolve = vi.fn();
	await act(async () =>
		root.render(
			<NextUIProvider disableAnimation>
				<DraftConflict
					conflictFields={["number", "languageName"]}
					payload={{
						itemType: "Report",
						reportNumber: "R-2",
						language: "French",
					}}
					published={{
						itemType: "Report",
						reportNumber: "R-1",
						language: "English",
					}}
					disabled={false}
					onResolve={resolve}
				/>
			</NextUIProvider>,
		),
	);
	const apply = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === "Apply to draft",
	)!;
	expect(apply.disabled).toBe(true);
	for (const value of ["R-2", "English"]) {
		const choice = [...container.querySelectorAll("label")].find((label) =>
			label.textContent?.includes(value),
		);
		expect(choice, `Missing saved field value: ${value}`).toBeTruthy();
		await act(async () => choice!.click());
	}
	expect(apply.disabled).toBe(false);
	await act(async () => apply.click());
	expect(resolve).toHaveBeenCalledWith({
		number: "draft",
		languageName: "published",
	});
});


it.each(["note", "attachment"])("resolves a child %s conflict without requiring a separate review", async (itemType) => {
	const childPayload = { itemType, note: "Local note", creators: [], tags: [], collections: [] };
	await act(async () => root.render(<Inspector role="creator" overrides={{
		detail: { ...submitted, itemType, title: "", parentItem: "PARN2345", parentState: "published", editable: true, draft: { ...submitted.draft, payload: childPayload } },
		payload: childPayload,
		definitions: [{ itemType, fields: [{ field: "note" }], creatorTypes: [] }],
		concurrentConflict: { generation: submitted.draft.generation, draftRevision: 2, payload: { ...childPayload, note: "Other note" } },
		validationErrors: { note: "Changed in another session." },
		saveState: "conflict",
	}} />));
	expect(container.querySelector('[aria-label="Resolve draft conflicts"]')).not.toBeNull();
	expect(container.querySelector('[aria-label="Review requirements"]')).toBeNull();
});
