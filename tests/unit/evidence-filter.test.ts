// The evidence map's filter: a type and a check, each any number of options, highlighting papers that match both.
import { describe, expect, it } from "vitest";

import { highlightedCount, highlightedNow, matchesChecks } from "@/components/pages/evidence/filter";

// Three primary studies (one broken, one validated, one not assessed) and a broken meta-analysis; kinds 1 and 3, checks 7 and 3.
const counts = { 1: { 0: 1, 3: 1, 7: 1 }, 3: { 7: 1 } };
const loaded = { points: { kind: Uint8Array.from([1, 1, 1, 3]), verdict: Uint8Array.from([7, 3, 0, 7]), flags: new Uint8Array(4) } } as never;
const lit = (types: number[], verdicts: number[]) => [0, 1, 2, 3].filter(matchesChecks(loaded, new Set(types), new Set(verdicts)));

describe("the evidence map's filter", () => {
	it("highlights papers of any chosen type that have any chosen check, and counts the same papers", () => {
		expect(lit([1], [])).toEqual([0, 1, 2]);
		expect(lit([1], [7])).toEqual([0]);
		expect(lit([], [7])).toEqual([0, 3]);
		expect(lit([1, 3], [7, 3])).toEqual([0, 1, 3]);
		expect(highlightedCount(counts, new Set([1]), new Set())).toBe(3);
		expect(highlightedCount(counts, new Set([1]), new Set([7]))).toBe(1);
		expect(highlightedCount(counts, new Set([1, 3]), new Set([7, 3]))).toBe(3);
		expect(highlightedCount(counts, new Set(), new Set())).toBeNull();
	});

	it("counts the papers lit on the map: narrowed by a search, and only those of the open chain or citations", () => {
		const broken = { checkCounts: counts, types: new Set<number>(), verdicts: new Set([7]) };
		// Before the map's data is in, the counts built with it.
		expect(highlightedNow({ ...broken, lit: undefined, shown: null })).toBe(2);
		// The filter lights 0 and 3; a search that keeps only 0 narrows the count with it.
		expect(highlightedNow({ ...broken, lit: [0, 3], shown: null })).toBe(2);
		expect(highlightedNow({ ...broken, lit: [0], shown: null })).toBe(1);
		// A chain of the meta-analysis (3) and two of its studies (0 and 2): only its own lit papers count.
		const shown = { index: 3, chain: { focus: 3, layers: [[0, 2], [3]], links: [], others: [] }, cites: [], citedBy: [] } as never;
		expect(highlightedNow({ ...broken, lit: [0, 3, 9], shown })).toBe(2);
		expect(highlightedNow({ ...broken, verdicts: new Set(), lit: [0, 3], shown })).toBeNull();
		// A paper with no chain (1) opened: only it and its citations (0, and 2, cited twice) count.
		const around = { index: 1, chain: null, cites: [0, 2], citedBy: [2] } as never;
		expect(highlightedNow({ ...broken, lit: [0, 3], shown: around })).toBe(1);
	});
});
