// @vitest-environment jsdom
// Below 1,280 px one sheet holds the starting points or the results, with an opened paper slid over them. Standing up it folds
// down to its bar so the map has the screen: a paper opened then must open it, and the map must be fitted to the sheet's new
// height, not the one it had.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/features/SearchBar", () => ({ SearchBar: () => <input aria-label="Search" /> }));

const { PhoneSheet } = await import("@/components/pages/evidence/phone-sheet");

const keys = ["AAAAAAAA"];
const count = 1, u8 = () => new Uint8Array(count), u16 = () => new Uint16Array(count);
const loaded = { theme: "light", points: { count, linked: count, library: count, space: 100, positions: new Float32Array(2), years: u16(), cites: u16(), region: u16(), area: u16(), kind: u8(), verdict: u8(), flags: u8(), places: [], bundles: [] }, colours: new Float32Array(4), sizes: new Float32Array(1) };
const more = { labels: new Map([[0, { who: "Song et al.", year: 2023, title: "The open paper" }]]), keyOf: (i: number) => keys[i] ?? null, indexOf: (key: string) => (keys.includes(key) ? keys.indexOf(key) : undefined), doiOf: new Map() };

let container: HTMLDivElement, root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ key: keys[0], title: "The open paper", creators: [], date: "2023" }] }))));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

/** The sheet with a paper open (`target` 0) or none. */
async function show(target: number | null, onRefit = vi.fn()) {
	const selection = target === null ? null : { index: target, chain: null, cites: [], citedBy: [] };
	await act(async () => {
		root.render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<PhoneSheet
					filters={{ queryParams: { search: "" }, handleSearchChange: vi.fn(), handlePageChange: vi.fn() } as never} onSearch={vi.fn()} onTyped={vi.fn()} found={undefined} typing={false}
					loaded={loaded as never} more={more as never} chains={[]} papers={1} checked={{ count: 0, open: false, onOpen: vi.fn() }}
					checks={{ counts: {}, types: new Set(), verdicts: new Set(), onTypes: vi.fn(), onVerdicts: vi.fn() }} selected={target} onOpenKey={vi.fn()} onHover={vi.fn()}
					opened={{ selection, opening: false, deep: false, back: "Starting points", onOpen: vi.fn(), onClose: vi.fn() }} target={target} focus={null} onRefit={onRefit}
				/>
			</SWRConfig>,
		);
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const bar = () => container.querySelector<HTMLButtonElement>("[data-evidence-sheet] button[aria-expanded]")!;

describe("the phone's sheet", () => {
	it("opens when a paper is opened, though the reader had folded it", async () => {
		await show(null);
		expect(bar().getAttribute("aria-expanded")).toBe("false");
		await show(0);
		expect(bar().getAttribute("aria-expanded")).toBe("true");
	});

	it("fits the map again once folding has changed the sheet's height, not before", async () => {
		const sheet = () => container.querySelector("[data-evidence-sheet]")!;
		const foldedWhenFitted: boolean[] = [];
		const onRefit = vi.fn(() => foldedWhenFitted.push(sheet().hasAttribute("data-folded")));
		await show(0, onRefit);
		expect(bar().getAttribute("aria-expanded")).toBe("true");
		foldedWhenFitted.length = 0;
		await act(async () => bar().click());
		expect(foldedWhenFitted).toEqual([true]);
	});
});
