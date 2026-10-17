// @vitest-environment jsdom
// The evidence map draws frames only on demand and plays its moves and fades through cosmos.gl. These pin two bugs readers
// saw: a redraw cancelled a chain's move and left its points behind their names and lines, and a check switch's fade stopped
// partway until a hover drew more frames.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chain } from "@/components/pages/evidence/data";

type Call = { name: string; args: unknown[]; at: number };
const cosmos = vi.hoisted(() => ({ calls: [] as Call[], config: {} as Record<string, (...args: unknown[]) => void> }));

vi.mock("@cosmos.gl/graph", () => {
	class Graph {
		ready = Promise.resolve();
		constructor(_container: unknown, config: Record<string, (...args: unknown[]) => void>) { cosmos.config = config; }
		private record(name: string, args: unknown[]) { cosmos.calls.push({ name, args, at: performance.now() }); }
		render(...args: unknown[]) { this.record("render", args); }
		renderOneFrame() { this.record("frame", []); }
		setPointColors(...args: unknown[]) { this.record("colours", args); }
		setPointPositions(...args: unknown[]) { this.record("positions", args); }
		setPointSizes() {}
		setPointShapes() {}
		setLinks() {}
		setLinkColors() {}
		setLinkWidths() {}
		setLinkStyles() {}
		setConfigPartial() {}
		setHostHoveredPoint() {}
		fitViewByPointPositions() {}
		setZoomLevel() {}
		getZoomLevel() { return 1; }
		getPointPositions() { return new Float32Array(); }
		spaceToScreenPosition([x, y]: [number, number]) { return [x, y]; }
		screenToSpacePosition([x, y]: [number, number]) { return [x, y]; }
		destroy() {}
	}
	return { Graph, LinkStyle: { Solid: 0, Dashed: 1, Dotted: 2 }, PointShape: { None: 0 }, TransitionEasing: { CubicInOut: "cubicInOut" } };
});

vi.mock("@/components/pages/evidence/overlay", () => ({
	LabelOverlay: class { draw() { return false; } setTheme() {} },
}));

// 0, 1 studies of 2, a meta-analysis; 3 a paper on the map with no chain.
const chain: Chain = { focus: 2, layers: [[0, 1], [2]], links: [[2, 0], [2, 1]], others: [] };
vi.mock("@/components/pages/evidence/client", () => ({
	evidenceClient: () => ({
		more: () => Promise.resolve(),
		chain: (index: number) => Promise.resolve(index === 2 ? chain : null),
		neighbourhood: () => Promise.resolve({ cites: [], citedBy: [] }),
		colours: () => Promise.resolve(new Float32Array(16).fill(1)),
		links: () => Promise.resolve({ pairs: new Float32Array(), colours: new Float32Array() }),
	}),
}));

const { EvidenceGraph } = await import("@/components/pages/evidence/graph");

function loaded() {
	const count = 4, u8 = () => new Uint8Array(count), u16 = () => new Uint16Array(count);
	return {
		theme: "light" as const,
		points: { count, linked: count, library: count, space: 100, positions: Float32Array.from([10, 10, 20, 20, 30, 30, 40, 40]), years: u16(), cites: u16(), region: u16(), area: u16(), kind: u8(), verdict: u8(), flags: u8(), places: [], bundles: [] },
		colours: new Float32Array(count * 4).fill(1),
		sizes: new Float32Array(count).fill(4),
	};
}

async function makeGraph() {
	const graph = new EvidenceGraph(document.createElement("div"), document.createElement("canvas"), loaded() as never, false, {
		onHover: () => {},
		onSelect: () => {},
		visibleArea: () => ({ left: 0, right: 800, top: 0, bottom: 600 }),
	});
	await graph.ready;
	return graph;
}

/** Lets time pass a frame at a time, as a browser would. */
async function play(ms: number) {
	for (let t = 0; t < ms; t += 16) { await vi.advanceTimersByTimeAsync(16); }
}

const renders = () => cosmos.calls.filter((call) => call.name === "render");
const lastColours = () => cosmos.calls.filter((call) => call.name === "colours").at(-1)!.args[0] as Float32Array;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
	vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
	cosmos.calls = [];
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("the evidence map's moves and fades", () => {
	it("keeps a chain's move going when a fade ends and a hover asks for a redraw on the way", async () => {
		const graph = await makeGraph();
		const opening = graph.select(2);
		await play(400);
		await opening;
		const move = renders().find((call) => call.args[1] === 900);
		expect(move).toBeDefined();
		// cosmos.gl reports the end of an earlier colour fade while the move runs, then the pointer leaves a list row.
		cosmos.config.onTransitionEnd(false);
		graph.hoverHost(undefined, undefined);
		graph.hoverHost(0, { who: "Ma et al.", year: 2025 });
		await play(300);
		const during = renders().filter((call) => call.at > move!.at && call.at < move!.at + 900);
		expect(during).toEqual([]);
	});

	it("draws frames until a check switch's fade has finished, with nothing else moving", async () => {
		const graph = await makeGraph();
		await play(1500);
		const before = cosmos.calls.filter((call) => call.name === "frame").length;
		graph.setHighlight([1]);
		await play(600);
		const frames = cosmos.calls.filter((call) => call.name === "frame").length - before;
		expect(frames).toBeGreaterThanOrEqual(280 / 16);
	});

	it("lands a chain's papers in their columns when the theme changes while they move", async () => {
		const graph = await makeGraph();
		const opening = graph.select(2);
		await play(400);
		await opening;
		const columns = cosmos.calls.filter((call) => call.name === "positions").at(-1)!.args[0] as Float32Array;
		await graph.setTheme("dark");
		// cosmos.gl cancels a running move when it redraws, and leaves the points where they set off: they are put in place first.
		const move = cosmos.calls.indexOf(renders().find((call) => call.args[1] === 900)!), redraw = cosmos.calls.indexOf(renders().at(-1)!);
		const between = cosmos.calls.slice(move + 1, redraw).filter((call) => call.name === "positions");
		expect(between.map((call) => [...(call.args[0] as Float32Array)])).toEqual([[...columns]]);
	});

	it("keeps an open chain's papers that a switch leaves out half visible, and the map behind faint", async () => {
		const graph = await makeGraph();
		const opening = graph.select(2);
		await play(400);
		await opening;
		graph.setHighlight([0]);
		const alpha = (i: number) => lastColours()[i * 4 + 3];
		expect(alpha(0)).toBe(1);
		expect(alpha(2)).toBe(1);
		expect(alpha(1)).toBeCloseTo(0.4);
		expect(alpha(3)).toBeLessThan(0.1);
	});
});
