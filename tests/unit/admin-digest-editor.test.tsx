// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/admin-api", async (original) => ({
	...(await original<typeof import("@/components/admin/admin-api")>()),
	getAdminDigestPapers: vi.fn(), getAdminDigestCited: vi.fn(),
}));

import * as api from "@/components/admin/admin-api";
import { AdminDigestEditor } from "@/components/admin/AdminDigestEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, and the editor asks a range where the selection is before it scrolls to it.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const mocked = vi.mocked(api);
const ID = "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64";
const START = "## Heat\n\n**Kenya.** Parks cooled their surroundings [Mills, 2026](/lib/ABCD2345).";
const mills = { key: "ABCD2345", label: "Mills, 2026", title: "Parks and heat in Nairobi", date: "2026-10-01", review: false };
const drought = { key: "WXYZ6789", label: "Okoro and Adu, 2026", title: "Drought: a systematic review", date: "2026-10-03", review: true };
const page = (papers: (typeof mills)[]): Awaited<ReturnType<typeof api.getAdminDigestPapers>> => ({ papers, page: 1, pages: 4, total: 17, counts: { all: 17, reviews: 3, uncited: 16 } });

let root: Root;
let container: HTMLDivElement;
let saved: string[];
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = (element: Element | null | undefined) => { expect(element).toBeTruthy(); return act(async () => { (element as HTMLElement).click(); }); };
const byText = (selector: string, text: string) => [...document.querySelectorAll(selector)].find((element) => element.textContent?.includes(text));

function Host() {
	const [tools, setTools] = useState<HTMLElement | null>(null);
	const [markdown, setMarkdown] = useState(START);
	return <><div ref={setTools} /><AdminDigestEditor editionId={ID} markdown={markdown} tools={tools} onChange={(next) => { saved.push(next); setMarkdown(next); }} /></>;
}

beforeEach(async () => {
	saved = [];
	container = document.createElement("div"); document.body.append(container); root = createRoot(container);
	mocked.getAdminDigestPapers.mockResolvedValue(page([drought, mills]));
	mocked.getAdminDigestCited.mockResolvedValue([mills]);
	await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><NextUIProvider disableAnimation><Host /></NextUIProvider></SWRConfig>));
	await settle();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });

describe("the digest's text editor", () => {
	it("draws headings, bold and each citation as a chip, and reads the picker's first page before it is opened", () => {
		const editor = container.querySelector(".ProseMirror")!;
		expect(editor.querySelector("h2")?.textContent).toBe("Heat");
		expect(editor.querySelector("strong")?.textContent).toBe("Kenya.");
		expect(editor.querySelector('[aria-haspopup]')?.textContent).toBe("Mills, 2026");
		// What the text cites is known from the first frame, so the list and the chip's own publication are there on open.
		expect(mocked.getAdminDigestPapers).toHaveBeenCalledWith(ID, { query: "", show: "all", sort: "newest", page: 1, cited: ["ABCD2345"] });
		expect(mocked.getAdminDigestCited).toHaveBeenCalledWith(ID, ["ABCD2345"]);
	});

	it("cites a publication picked from the edition's list, and says which rows the text already has", async () => {
		await press(byText("button", "Cite"));
		await settle();
		const rows = [...document.querySelectorAll('[role="option"]')];
		expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Drought: a systematic review"), expect.stringContaining("In the text")]);
		expect(rows[0]!.textContent).toContain("Review");
		expect(document.body.textContent).toContain("1 to 5 of 17");
		// The button beside a row opens the publication instead of citing it.
		expect(document.querySelector('a[aria-label="Open Drought: a systematic review"]')?.getAttribute("href")).toBe("/lib/WXYZ6789");
		await press(rows[0]);
		await settle();
		expect(saved.at(-1)).toContain("[Okoro and Adu, 2026](/lib/WXYZ6789)");
		expect(saved.at(-1)).toContain("[Mills, 2026](/lib/ABCD2345)");
	});

	it("names a chip's publication and takes the citation out, with the space before it", async () => {
		await press(container.querySelector('.ProseMirror [aria-haspopup]'));
		await settle();
		expect(document.body.textContent).toContain("Parks and heat in Nairobi");
		expect(byText('[role="option"]', "Parks and heat in Nairobi")?.textContent).toContain("Cited here");
		await press(byText("button", "Remove citation"));
		await settle();
		expect(saved.at(-1)).toBe("## Heat\n\n**Kenya.** Parks cooled their surroundings.");
	});

	it("swaps a chip for another publication", async () => {
		await press(container.querySelector('.ProseMirror [aria-haspopup]'));
		await settle();
		await press(byText('[role="option"]', "Drought: a systematic review"));
		await settle();
		expect(saved.at(-1)).toBe("## Heat\n\n**Kenya.** Parks cooled their surroundings [Okoro and Adu, 2026](/lib/WXYZ6789).");
	});
	it("does not cite a row from the search before while a new search is on its way", async () => {
		await press(byText("button", "Cite"));
		await settle();
		// The next search is held open: the rows still on show answer the old one.
		let answer!: (value: Awaited<ReturnType<typeof api.getAdminDigestPapers>>) => void;
		mocked.getAdminDigestPapers.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
		const search = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		const enter = () => act(async () => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "parks");
			search.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await settle();
		const before = saved.length;
		await enter();
		await settle();
		expect(saved).toHaveLength(before);
		// Once the matching rows are there, Enter cites the first of them.
		await act(async () => { answer(page([mills])); });
		await settle();
		await enter();
		await settle();
		expect(saved.at(-1)!.split("[Mills, 2026](/lib/ABCD2345)")).toHaveLength(3);
	});

	it("reaches a chip with the keyboard, and opens it with Enter", async () => {
		const chip = container.querySelector<HTMLElement>(".ProseMirror [data-citation]")!;
		expect(chip.tabIndex).toBe(0);
		await act(async () => { chip.focus(); chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
		await settle();
		expect(document.querySelector('[aria-label="Change this citation"]')).not.toBeNull();
		// The key opened the chip; it was not typed into the text.
		expect(saved).toEqual([]);
	});

	it("takes a pasted link to anywhere else as its text alone", async () => {
		const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
		const paste = new Event("paste", { bubbles: true, cancelable: true });
		// A browser's clipboard writes a citation copied from this site with the site's own address in front.
		const html = `<p>See <a href="https://example.org/paper">the outside paper</a> and <a href="${window.location.origin}/lib/WXYZ6789">Okoro and Adu, 2026</a>.</p>`;
		Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/html" ? html : "See the outside paper and Okoro and Adu, 2026."), files: [], items: [], types: ["text/html", "text/plain"] } });
		await act(async () => { editor.focus(); editor.dispatchEvent(paste); });
		await settle();
		expect(saved.at(-1)).toContain("the outside paper");
		expect(saved.at(-1)).not.toContain("example.org");
		// A citation pasted with it stays a citation.
		expect(saved.at(-1)).toContain("[Okoro and Adu, 2026](/lib/WXYZ6789)");
	});
});
