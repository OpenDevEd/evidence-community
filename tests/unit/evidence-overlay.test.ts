// @vitest-environment jsdom
// The map's names are placed like a map's: no two overlap, and the paper the reader is looking at always keeps its name.
import { describe, expect, it } from "vitest";

import type { More } from "@/components/pages/evidence/client";
import type { Chain, Points } from "@/components/pages/evidence/data";
import { LabelOverlay, type Camera } from "@/components/pages/evidence/overlay";

type Drawn = { text: string; x: number; y: number; align: string; font: string };

/** A canvas whose 2D context records the names it is asked to fill, each character 6 pixels wide. */
function recordingCanvas() {
	const drawn: Drawn[] = [];
	const context = {
		font: "", textAlign: "left", textBaseline: "middle", lineJoin: "round", lineWidth: 1, strokeStyle: "", fillStyle: "", globalAlpha: 1,
		setTransform() {}, clearRect() { drawn.length = 0; }, strokeText() {},
		measureText: (text: string) => ({ width: text.length * 6 }),
		fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, align: context.textAlign, font: context.font }); },
	};
	const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
	return { canvas, drawn };
}

/** Papers at these screen places, named as given. */
function setup(places: [number, number][], names: string[]) {
	const count = places.length;
	const points = { count, linked: count, library: count, space: 1000, positions: Float32Array.from(places.flat()), flags: new Uint8Array(count), places: [] } as unknown as Points;
	const more = { labels: new Map(names.map((who, i) => [i, { who, year: 2024 }])), keyOf: () => null, indexOf: () => undefined, doiOf: new Map() } as unknown as More;
	const { canvas, drawn } = recordingCanvas();
	const overlay = new LabelOverlay(canvas, points, "light");
	const camera = (over: Partial<Camera>): Camera => ({
		x: (v) => v, y: (v) => v, toSpace: (x, y) => [x, y], scale: 1, position: (i) => [places[i][0], places[i][1]],
		chain: null, focus: null, hovered: null, found: null, lit: null, more, width: 800, height: 600, ...over,
	});
	return { overlay, drawn, camera };
}

/** The screen box of a drawn name, as the overlay lays it out. */
const boxOf = (d: Drawn) => {
	const w = d.text.length * 6, h = Number(d.font.match(/(\d+(?:\.\d+)?)px/)![1]) * 1.25;
	const left = d.align === "center" ? d.x - w / 2 : d.align === "right" ? d.x - w : d.x;
	return { left, right: left + w, top: d.y - h / 2, bottom: d.y + h / 2 };
};
const overlaps = (a: Drawn, b: Drawn) => {
	const p = boxOf(a), q = boxOf(b);
	return p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
};

describe("the map's names", () => {
	// A chain's papers stacked closer than a line apart: not every name fits.
	const places: [number, number][] = Array.from({ length: 12 }, (_, i) => [300, 200 + i * 6]);
	const names = places.map((_, i) => `Author${i} et al.`);
	const chain: Chain = { focus: 0, layers: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0]], links: [], others: [] };

	it("never overlap", () => {
		const { overlay, drawn, camera } = setup(places, names);
		overlay.draw(camera({ chain, focus: 0 }));
		expect(drawn.length).toBeGreaterThan(1);
		for (const a of drawn) for (const b of drawn) if (a !== b) expect(overlaps(a, b)).toBe(false);
	});

	it("keep the opened paper's name, and the one pointed at in a list, among crowded ones", () => {
		const { overlay, drawn, camera } = setup(places, names);
		overlay.draw(camera({ chain, focus: 0, hovered: 7 }));
		const texts = drawn.map((d) => d.text);
		expect(texts).toContain("Author0 et al. 2024");
		expect(texts).toContain("Author7 et al. 2024");
	});
});
