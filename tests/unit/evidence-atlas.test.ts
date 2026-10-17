import { describe, expect, it } from "vitest";

import { chainOf, checkedChain, decodeCitations, sortLinks, visibleLinks, type Atlas, type Columns } from "@/components/pages/evidence/atlas";
import { CHECKED, KINDS, LINK, VERDICTS } from "@/components/pages/evidence/data";

const kind = (name: (typeof KINDS)[number]) => KINDS.indexOf(name);
const verdict = (name: (typeof VERDICTS)[number]) => VERDICTS.indexOf(name);

/** A small map: papers given by kind, check and place; every one of them linked. */
function columns(papers: { kind: number; verdict?: number; x?: number; y?: number; cites?: number }[]): Columns {
	const count = papers.length;
	return {
		count, linked: count, library: count, space: 100,
		positions: Float32Array.from(papers.flatMap((p, i) => [p.x ?? i, p.y ?? 0])),
		years: new Uint16Array(count), cites: Uint16Array.from(papers.map((p) => p.cites ?? 0)), region: new Uint16Array(count),
		area: new Uint16Array(count), kind: Uint8Array.from(papers.map((p) => p.kind)), verdict: Uint8Array.from(papers.map((p) => p.verdict ?? 0)),
		flags: new Uint8Array(count),
	};
}

const analysed = (pairs: [number, number][]) => sortLinks(Uint32Array.from(pairs.flatMap(([from, to]) => [from, to, LINK.analyses])));

/** The citations file for these rows: row lengths, then each row's targets as gaps, as variable-length numbers. */
function encodeCitations(rows: number[][]) {
	const bytes: number[] = [];
	const varint = (value: number) => { while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; } bytes.push(value); };
	for (const row of rows) varint(row.length);
	for (const row of rows) [...row].sort((a, b) => a - b).forEach((target, k, sorted) => varint(k ? target - sorted[k - 1] : target));
	return Uint8Array.from(bytes);
}

describe("a paper's chain", () => {
	// 0, 1 primary studies; 2 a meta-analysis of both; 3 a review of reviews analysing 2.
	const points = columns([{ kind: kind("primary") }, { kind: kind("primary"), verdict: verdict("broken") }, { kind: kind("meta") }, { kind: kind("secondOrder") }]);
	const atlas: Atlas = { points, ...analysed([[2, 0], [2, 1], [3, 2]]) };

	it("reads left to right: the studies, the paper, what analyses it", () => {
		const chain = chainOf(atlas, 2);
		expect(chain?.layers).toEqual([[1, 0], [2], [3]]);
		expect(chain?.links).toEqual(expect.arrayContaining([[2, 0], [2, 1], [3, 2]]));
	});

	it("puts the most worrying check first in its column", () => {
		expect(chainOf(atlas, 2)?.layers[0][0]).toBe(1);
	});

	it("reaches two steps along the links, from a study up to the review of reviews", () => {
		expect(chainOf(atlas, 0)?.layers).toEqual([[0], [2], [3]]);
	});

	it("has nothing for a paper without such a link", () => {
		const alone: Atlas = { points: columns([{ kind: kind("primary") }, { kind: kind("primary") }]), ...analysed([]) };
		expect(chainOf(alone, 0)).toBeNull();
	});
});

describe("the checked papers' graph", () => {
	it("holds every checked paper joined to another checked one, in the three levels' columns", () => {
		const points = columns([
			{ kind: kind("primary"), verdict: verdict("broken") },
			{ kind: kind("meta"), verdict: verdict("validated") },
			{ kind: kind("primary"), verdict: verdict("questionable") }, // checked, but joined to nothing checked
			{ kind: kind("primary") }, // joined, but not checked
		]);
		const chain = checkedChain({ points, ...analysed([[1, 0], [1, 3]]) });
		expect(chain?.focus).toBe(CHECKED);
		expect(chain?.layers).toEqual([[0], [1]]);
		expect(chain?.links).toEqual([[1, 0]]);
	});

	it("brings in what a checked review of reviews analyses, checked or not", () => {
		const points = columns([{ kind: kind("meta") }, { kind: kind("secondOrder"), verdict: verdict("pending") }]);
		expect(checkedChain({ points, ...analysed([[1, 0]]) })?.layers).toEqual([[0], [1]]);
	});
});

describe("the citations drawn for the part of the map in view", () => {
	// 0 and 1 in view, 2 far off; 0 cites 1 and 2, 2 cites 1.
	const points = columns([{ kind: 0, x: 1, y: 1 }, { kind: 0, x: 2, y: 2 }, { kind: 0, x: 90, y: 90 }]);
	const atlas: Atlas = { points, ...decodeCitations(encodeCitations([[1, 2], [], [1]]), 3) };
	const pairs = (rect: [number, number, number, number]) => [...visibleLinks(atlas, rect, "light").pairs];

	it("decodes who cites whom, both ways", () => {
		expect([...atlas.citedBy!.targets.subarray(atlas.citedBy!.offsets[1], atlas.citedBy!.offsets[2])]).toEqual([0, 2]);
	});

	it("close in, also draws the citations that lead off screen", () => {
		expect(pairs([0, 0, 10, 10])).toEqual([0, 1, 0, 2, 2, 1]);
	});

	it("draws nothing before the citations have arrived", () => {
		expect(visibleLinks({ points }, [0, 0, 10, 10], "light").pairs).toHaveLength(0);
	});
});
