// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/admin-api", async (original) => ({
	...(await original<typeof import("@/components/admin/admin-api")>()),
	getAdminDigests: vi.fn(), getAdminDigest: vi.fn(), saveAdminDigest: vi.fn(), moveAdminDigest: vi.fn(), getAdminDigestPapers: vi.fn(), getAdminDigestCited: vi.fn(),
}));
// The text editor has its own test; here its place is a plain box that reports what is typed.
vi.mock("@/components/admin/AdminDigestEditor", () => ({
	CHIP: "",
	AdminDigestEditor: ({ markdown, onChange }: { markdown: string; onChange: (value: string) => void }) => <textarea aria-label="Digest text" value={markdown} onChange={(event) => onChange(event.target.value)} />,
}));

import * as api from "@/components/admin/admin-api";
import { AdminDigestsInspector, AdminDigestsMain, useAdminDigests } from "@/components/admin/AdminDigests";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocked = vi.mocked(api);
const ID = "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64";
const words = { title: "Heat and harvests", summary: "Two studies.", markdown: "## Heat\n\nParks cooled their surroundings.", note: "" };
const ai = { title: "Heat and harvests", summary: "Two studies.", markdown: "## Heat\n\nParks cooled the streets." };
const creator = { id: "user_creator", name: "Eunice Jengo", photo: null };

function digest(patch: Partial<api.AdminDigest> = {}): api.AdminDigest {
	return {
		id: ID, day: "12", month: "Oct", date: "12 October 2026", period: "5 to 12 October", publicationCount: 298, state: "draft", writing: false, revision: 3,
		words, cited: {}, error: null, published: null, publishedAt: null, ai, checkedBy: null, attribution: true,
		events: [{ kind: "written", at: "2026-10-12T06:00:00.000Z", actor: null }, { kind: "edited", at: "2026-10-12T14:12:00.000Z", actor: creator }], sent: null, ...patch,
	};
}
const row = (id: string, title: string | null, state: api.AdminDigest["state"], checkedBy: { id: string; name: string; photo: null; role: "editor" } | null = null) => ({ id, day: "12", month: "Oct", date: "12 October 2026", period: "5 to 12 October", publicationCount: 298, title, state, checkedBy });
const list = (editions: ReturnType<typeof row>[]): api.AdminDigestList => ({
	editions, page: 1, pages: 3, total: 41, counts: { all: 41, draft: 1, review: 2, published: 38 },
	overview: { sending: true, paused: false, approval: true, attribution: false, next: { day: "Monday 19 October", time: "09:00" }, subscribers: 1024 },
});

let root: Root;
let container: HTMLDivElement;
const text = () => container.textContent ?? "";
const button = (name: string | RegExp) => [...container.querySelectorAll("button")].filter((element) => (typeof name === "string" ? element.textContent?.trim() === name : name.test(element.textContent ?? "")));
const press = (element: Element | undefined) => { expect(element).toBeDefined(); return act(async () => { (element as HTMLElement).click(); }); };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function Panes({ start }: { start: string }) {
	const [param, setParam] = useState<string | null>(start);
	const digests = useAdminDigests(param, setParam);
	return <><main><AdminDigestsMain digests={digests} /></main><aside><AdminDigestsInspector digests={digests} configurationHref="https://openscholar.example/libraries/amber/configuration?section=sources" /></aside><output>{param} waiting {digests.waiting}</output></>;
}
async function show(start: string, role: "creator" | "editor", address = "") {
	await act(async () => root.render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<NextUIProvider disableAnimation>
				<NuqsTestingAdapter searchParams={address}><AdminSessionProvider session={{ role, userId: role === "creator" ? creator.id : "user_editor", name: role === "creator" ? creator.name : "Gugulethu Dube", image: null, doiProviders: { crossref: true, zenodo: true }, defaultLicence: "cc-by-4.0", defaultFileAccess: null }}><Panes start={start} /></AdminSessionProvider></NuqsTestingAdapter>
			</NextUIProvider>
		</SWRConfig>,
	));
	await settle();
}

beforeEach(() => {
	container = document.createElement("div"); document.body.append(container); root = createRoot(container);
	mocked.getAdminDigests.mockResolvedValue(list([row(ID, "Heat and harvests", "review"), row("b", null, "writing"), row("c", "September", "published", { id: "user_editor", name: "Gugulethu Dube", photo: null, role: "editor" })]));
	mocked.getAdminDigest.mockResolvedValue(digest());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });

describe("digests in the admin", () => {
	it("lists the editions with where each stands, a page at a time, and opens one", async () => {
		await show("list", "editor");
		expect(text()).toContain("Heat and harvests");
		expect(text()).toContain("In review");
		expect(text()).toContain("AI is writing this digest");
		expect(text()).toContain("Gugulethu Dube");
		expect(text()).toContain("1 to 20 of 41");
		// The navigation's count and the right pane's summary come with the list.
		expect(text()).toContain("waiting 2");
		expect(text()).toContain("Monday 19 October, 09:00");
		expect(text()).toContain("1,024");
		// What the library's settings make of a digest: an editor publishes it, and readers are not told who.
		expect(text()).toContain("An editor publishes it");
		expect(text()).toContain("No name");
		expect([...container.querySelectorAll("a")].find((link) => link.textContent === "Digest settings")?.href).toBe("https://openscholar.example/libraries/amber/configuration?section=notifications");
		// The Edition column sorts the list, as a column of the record table does.
		expect(button(/^Edition/)[0]!.textContent).toBe("Edition, sorted descending");
		await press(button(/^Edition/)[0]);
		expect(mocked.getAdminDigests).toHaveBeenLastCalledWith({ page: 1, show: "all", sort: "oldest" });
		expect(button(/^Edition/)[0]!.textContent).toBe("Edition, sorted ascending");
		await press(button(/Heat and harvests/)[0]);
		await settle();
		expect(text()).toContain(`${ID} waiting`);
		expect(mocked.getAdminDigest).toHaveBeenCalledWith(ID);
	});

	it("lists the digests the address names, so a reload keeps them", async () => {
		mocked.getAdminDigests.mockResolvedValue(list([row(ID, "Heat and harvests", "review")]));
		await show("list", "editor", "?digestState=review");
		expect(mocked.getAdminDigests).toHaveBeenLastCalledWith(expect.objectContaining({ show: "review" }));
	});

	it("offers a Creator review, never publishing, and shows who did what", async () => {
		mocked.moveAdminDigest.mockResolvedValue(digest({ state: "review", revision: 4 }));
		await show(ID, "creator");
		expect(text()).toContain("Eunice Jengo");
		expect(text()).toContain("edited the text");
		expect(button(/Publish/)).toHaveLength(0);
		await press(button("Send to queue")[0]);
		await settle();
		expect(mocked.moveAdminDigest).toHaveBeenCalledWith(ID, 3, "submit");
		expect(text()).toContain("Waiting for an editor");
		expect(button("Take back")).toHaveLength(1);
		expect(button("Send to queue")).toHaveLength(0);
	});

	it("offers an Editor the way back and publishing, and says what publishing does", async () => {
		mocked.getAdminDigest.mockResolvedValue(digest({ state: "review" }));
		mocked.moveAdminDigest.mockResolvedValue(digest({ state: "published", revision: 4, published: words, publishedAt: "2026-10-12T15:00:00.000Z", checkedBy: { id: "user_editor", name: "Gugulethu Dube", photo: null, role: "editor" } }));
		await show(ID, "editor");
		expect(button("Send back")).toHaveLength(1);
		// Never published, so publishing emails it.
		await press(button("Publish and send")[0]);
		await settle();
		expect(mocked.moveAdminDigest).toHaveBeenCalledWith(ID, 3, "publish");
		expect(text()).toContain("Published on 12 October");
		expect(button(/Publish|Send/)).toHaveLength(0);
	});

	it("says a change to a published edition is not what readers see until it is published", async () => {
		mocked.getAdminDigest.mockResolvedValue(digest({ published: { ...words, title: "Heat" }, publishedAt: "2026-10-05T09:00:00.000Z" }));
		await show(ID, "editor");
		expect(text()).toContain("Readers see the version of 5 October");
		expect(button("Publish changes")).toHaveLength(1);
		// What a person changed is counted on the Changes view's tab and marked in it.
		expect(button(/^Changes/)[0]?.textContent).toMatch(/Changes\s*1$/);
		await press(button(/^Changes/)[0]);
		const marked = (tag: "ins" | "del") => [...container.querySelectorAll(tag)].map((element) => element.textContent?.trim());
		// The first of each is the legend.
		expect(marked("ins")).toEqual(["Added", "their", "surroundings."]);
		expect(marked("del")).toEqual(["Removed", "the", "streets."]);
	});

	it("saves what is typed and, when someone else got there first, keeps it on screen until the latest is loaded", async () => {
		const conflict = new api.AdminApiError({ code: "conflict", message: "This content changed while you were editing it. Refresh and try again." }, 409);
		mocked.saveAdminDigest.mockResolvedValueOnce(digest({ revision: 4 })).mockRejectedValueOnce(conflict);
		await show(ID, "creator");
		const title = container.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
		const type = (value: string) => act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, value);
			title.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await type("Heat, harvests and water");
		await vi.waitFor(() => expect(mocked.saveAdminDigest).toHaveBeenCalledWith(ID, 3, { ...words, title: "Heat, harvests and water" }), { timeout: 3000 });
		await type("Heat, harvests, water and work");
		await vi.waitFor(() => expect(mocked.saveAdminDigest).toHaveBeenCalledTimes(2), { timeout: 3000 });
		await settle();
		expect(mocked.saveAdminDigest).toHaveBeenLastCalledWith(ID, 4, { ...words, title: "Heat, harvests, water and work" });
		expect(container.querySelector('[role="alert"]')?.textContent).toContain("Someone else changed this digest");
		expect(title.value).toBe("Heat, harvests, water and work");
		mocked.getAdminDigest.mockResolvedValue(digest({ revision: 9, words: { ...words, title: "Their title" } }));
		await press(button("Load the latest")[0]);
		await settle();
		expect(container.querySelector<HTMLInputElement>('input[aria-label="Title"]')!.value).toBe("Their title");
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it("finds an edition as it was left when it is opened again after another", async () => {
		const OTHER = "0b0c2a55-55f3-4f0e-9d0e-4f0a3a2f8c11";
		mocked.getAdminDigests.mockResolvedValue(list([row(ID, "Heat and harvests", "draft"), row(OTHER, "September", "draft")]));
		// The library answers with the revision it had when the page was loaded, as a cached answer does.
		mocked.getAdminDigest.mockImplementation(async (id) => digest({ id, words: id === ID ? words : { ...words, title: "September" } }));
		mocked.saveAdminDigest.mockImplementation(async (_id, revision, saved) => digest({ revision: revision + 1, words: saved }));
		await show(ID, "creator");
		const title = () => container.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
		const type = (value: string) => act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title(), value);
			title().dispatchEvent(new Event("input", { bubbles: true }));
		});
		await type("Heat, harvests and water");
		await vi.waitFor(() => expect(mocked.saveAdminDigest).toHaveBeenCalledWith(ID, 3, { ...words, title: "Heat, harvests and water" }), { timeout: 3000 });
		await settle();
		await press(container.querySelector('button[aria-label="All digests"]') ?? undefined);
		await press(button(/September/)[0]);
		await settle();
		expect(title().value).toBe("September");
		await press(container.querySelector('button[aria-label="All digests"]') ?? undefined);
		await press(button(/Heat and harvests/)[0]);
		await settle();
		expect(title().value).toBe("Heat, harvests and water");
		await type("Heat, harvests, water and work");
		// The next save goes out from the revision the first one returned, not the one the page was loaded with.
		await vi.waitFor(() => expect(mocked.saveAdminDigest).toHaveBeenLastCalledWith(ID, 4, { ...words, title: "Heat, harvests, water and work" }), { timeout: 3000 });
	});

	it("previews the editor's note only when readers will see it", async () => {
		const noted = { ...words, note: "Start with the parks study." };
		mocked.getAdminDigest.mockResolvedValue(digest({ words: noted }));
		await show(ID, "editor");
		await press(button("Preview")[0]);
		expect(container.querySelector("main figure")?.textContent).toContain("Start with the parks study.");
		// Signed as readers will see it: the name and role of the person about to publish.
		expect(container.querySelector("main figcaption")?.textContent).toBe("Gugulethu DubeEditor");
		await act(async () => root.unmount());
		root = createRoot(container);
		// A library that does not name who checks its digests shows readers no note, and says so where it is written.
		mocked.getAdminDigest.mockResolvedValue(digest({ words: noted, attribution: false }));
		await show(ID, "editor");
		expect(container.querySelector<HTMLTextAreaElement>('aside textarea[placeholder^="Not shown to readers"]')).not.toBeNull();
		await press(button("Preview")[0]);
		expect(container.querySelector("main figure")).toBeNull();
	});

	it("shows an edition AI has not written yet, or could not write, with no text to act on", async () => {
		mocked.getAdminDigest.mockResolvedValue(digest({ state: "failed", words: null, ai: null, events: [], error: "OpenScholar digest generation returned 500" }));
		await show(ID, "editor");
		expect(text()).toContain("This digest could not be written");
		expect(text()).toContain("OpenScholar digest generation returned 500");
		expect(container.querySelector('input[aria-label="Title"]')).toBeNull();
		expect(button(/Publish|Send/)).toHaveLength(0);
	});
});
