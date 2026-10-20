// @vitest-environment jsdom
// The evidence map's page, with the map itself (cosmos.gl on the graphics card) and its data worker stood in for.
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chain } from "@/components/pages/evidence/data";
import { stubPanelLayout } from "./panel-layout";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryConfig: () => ({ theme: { layout: "normal" }, identity: { baseUrl: "https://aied.openscholar.ai" } }) }));
vi.mock("@/context/FiltersProvider", () => ({ useFiltersContext: () => ({ queryParams: {}, handleSearchChange: vi.fn(), handlePageChange: vi.fn() }) }));
vi.mock("@/components/features/SearchBar", () => ({ SearchBar: () => <input aria-label="Search" /> }));

// Four papers: 0 and 1 studies of 2, a meta-analysis; 3 a record the search no longer returns.
const keys = ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC", "DDDDDDDD"];
const checked: Chain = { focus: -1, layers: [[0, 1], [2]], links: [[2, 0], [2, 1]], others: [] };
const client = vi.hoisted(() => ({ more: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("@/components/pages/evidence/client", () => {
	const count = 4, u8 = () => new Uint8Array(count), u16 = () => new Uint16Array(count);
	const loaded = { theme: "light", points: { count, linked: count, library: count, space: 100, positions: new Float32Array(count * 2), years: u16(), cites: u16(), region: u16(), area: u16(), kind: Uint8Array.from([1, 1, 3, 0]), verdict: Uint8Array.from([7, 0, 3, 0]), flags: u8(), places: [], bundles: [] }, colours: new Float32Array(count * 4), sizes: new Float32Array(count) };
	const more = { labels: new Map([[0, { who: "Song et al.", year: 2023, title: "A broken study" }], [1, { who: "Li", year: 2023, title: "A study" }], [2, { who: "Suo et al.", year: 2026, title: "A meta-analysis" }]]), keyOf: (i: number) => keys[i] ?? null, indexOf: (key: string) => (keys.includes(key) ? keys.indexOf(key) : undefined), doiOf: new Map() };
	client.more = vi.fn(() => Promise.resolve(more));
	return { evidenceClient: () => ({ loaded: Promise.resolve(loaded), more: client.more }) };
});
vi.mock("@/components/pages/evidence/graph", () => ({
	EvidenceGraph: class {
		ready = Promise.resolve();
		select(index: number | null) { return Promise.resolve(index === null ? null : { index, chain: index === -1 ? checked : null, cites: [], citedBy: [] }); }
		setMore() {} setTheme() {} setHighlight() {} hoverHost() {} name() {} destroy() {} zoomBy() {} fitAll() {} refit() {}
	},
}));

const { default: EvidenceMap } = await import("@/components/pages/evidence/EvidenceMap");

let container: HTMLDivElement, root: Root, updates: URLSearchParams[];
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	updates = [];
	vi.stubGlobal("requestIdleCallback", (run: () => void) => setTimeout(run, 0));
	stubPanelLayout();
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	// The library's search answers for every record but the fourth.
	vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
		const asked: string[] = JSON.parse(init?.body ?? "{}").keys ?? [];
		return new Response(JSON.stringify({ items: asked.filter((key) => key !== keys[3]).map((key) => ({ key, title: `Record ${key}`, creators: [], date: "2024" })) }));
	}));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function open(address: string, wait = 20) {
	// The testing adapter reads its address when it is first rendered: each address is a fresh page.
	act(() => root.unmount());
	root = createRoot(container);
	await act(async () => {
		root.render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<NuqsTestingAdapter searchParams={address} onUrlUpdate={(event: UrlUpdateEvent) => updates.push(event.searchParams)}>
					<EvidenceMap chains={[]} checkCounts={{ 1: { 0: 1, 7: 1 }, 3: { 3: 1 } }} papers={4} />
				</NuqsTestingAdapter>
			</SWRConfig>,
		);
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, wait)); });
}

const panel = () => container.querySelector<HTMLElement>('[role="region"][aria-label="Paper"]');
// An opened paper's back arrow, named for where it goes.
const back = (to: string) => act(async () => [...panel()!.querySelectorAll("button")].find((button) => button.textContent === to)!.click());

describe("the evidence map's page", () => {
	it("goes back one step: from a paper opened from the appraised papers to them, then to the starting points", async () => {
		await open("?view=checked&paper=CCCCCCCC");
		expect(panel()?.textContent).toContain("Record CCCCCCCC");
		await back("Appraised papers");
		expect(updates.at(-1)?.get("paper")).toBeNull();
		expect(updates.at(-1)?.get("view")).toBe("checked");

		await open("?view=checked");
		expect(panel()?.querySelector("h2")?.textContent).toBe("Appraised papers");
		await back("Starting points");
		expect(updates.at(-1)?.get("view")).toBeNull();
	});

	it("says a record couldn't be loaded when the search does not return it, rather than showing an empty paper", async () => {
		await open("?paper=DDDDDDDD");
		expect(panel()?.querySelector('[role="status"]')?.textContent).toMatch(/couldn.t be loaded/);
	});

	it("asks again for the labels and keys when they fail to load, so a paper still opens", async () => {
		client.more.mockRejectedValueOnce(new Error("network"));
		await open("?paper=CCCCCCCC", 1200);
		expect(panel()?.textContent).toContain("Record CCCCCCCC");
	});
});
