// @vitest-environment jsdom
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
const draftChanges = vi.fn();
function Inspector({ role }: { role: "editor" | "creator" }) {
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
						<EditorialInspector {...props} />
					</AdminSessionProvider>
				</LibraryConfigProvider>
			</NextUIProvider>
		</SWRConfig>
	);
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	}));
	snapshot = structuredClone(submitted);
	requests = [];
	draftChanges.mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
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
