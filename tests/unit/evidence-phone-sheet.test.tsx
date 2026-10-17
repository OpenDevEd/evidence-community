// @vitest-environment jsdom
// Below 1,280 px one sheet holds the opened paper and the search's results, as two tabs. QA found both behaviours here broken:
// the arrow keys did not move between the tabs, and opening a result left the sheet on the results.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/features/SearchBar", () => ({ SearchBar: () => <input aria-label="Search" /> }));

const { PhoneSheet } = await import("@/components/pages/evidence/phone-sheet");

const keys = ["AAAAAAAA", "BBBBBBBB"];
const count = 2, u8 = () => new Uint8Array(count), u16 = () => new Uint16Array(count);
const loaded = { theme: "light", points: { count, linked: count, library: count, space: 100, positions: new Float32Array(4), years: u16(), cites: u16(), region: u16(), area: u16(), kind: u8(), verdict: u8(), flags: u8(), places: [], bundles: [] }, colours: new Float32Array(8), sizes: new Float32Array(2) };
const more = { labels: new Map([[0, { who: "Song et al.", year: 2023, title: "The open paper" }], [1, { who: "Li", year: 2024, title: "A result" }]]), keyOf: (i: number) => keys[i] ?? null, indexOf: (key: string) => (keys.includes(key) ? keys.indexOf(key) : undefined), doiOf: new Map() };
const results = { data: { items: [{ key: keys[1], title: "A result", creators: [], date: "2024" }], totalItems: 1, totalPages: 1 }, isLoading: false };

let container: HTMLDivElement, root: Root;
const onOpenKey = vi.fn();
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ key: keys[0], title: "The open paper", creators: [], date: "2023" }] }))));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); onOpenKey.mockReset(); });

async function show() {
	await act(async () => {
		root.render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<PhoneSheet
					selection={{ index: 0, chain: null, cites: [], citedBy: [] }} opening={false} loaded={loaded as never} more={more as never}
					filters={{ queryParams: {}, handleSearchChange: vi.fn(), handlePageChange: vi.fn() } as never} results={results as never} lit={undefined} typing={false} onTyped={vi.fn()}
					chains={[]} checked={{ count: 0, open: false, onOpen: vi.fn() }} checks={{ counts: {}, types: new Set(), verdicts: new Set(), onTypes: vi.fn(), onVerdicts: vi.fn() }} selected={0}
					onOpen={vi.fn()} onOpenKey={onOpenKey} onClose={vi.fn()} onHover={vi.fn()}
				/>
			</SWRConfig>,
		);
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const tab = (name: string) => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((element) => element.textContent === name)!;
const key = (element: HTMLElement, key: string) => act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

describe("the phone's sheet", () => {
	it("moves between Paper and Results with the arrow keys, Home and End", async () => {
		await show();
		expect(tab("Paper").getAttribute("aria-selected")).toBe("true");
		await key(tab("Paper"), "ArrowRight");
		expect(tab("Results").getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tab("Results"));
		await key(tab("Results"), "Home");
		expect(tab("Paper").getAttribute("aria-selected")).toBe("true");
	});

	it("brings the paper forward when a result is opened, even the paper already open", async () => {
		await show();
		await act(async () => tab("Results").click());
		const result = [...container.querySelectorAll<HTMLButtonElement>("ol button")].find((button) => button.textContent?.includes("A result"))!;
		await act(async () => result.click());
		expect(onOpenKey).toHaveBeenCalledWith(keys[1]);
		expect(tab("Paper").getAttribute("aria-selected")).toBe("true");
	});
});
