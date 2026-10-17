/** Where the map's data lives: AIED's citation graph and the evidence checks, built offline into binary columns (scripts/evidence-map). */
export const EVIDENCE_DATA = "/evidence-data/aied";

/** A library's address without its scheme: the map's data is one library's, and only that library shows it. */
export const libraryHost = (baseUrl: string) => baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

/** A region of the map, or an area inside one. */
export type Place = { id: number; level: 1 | 2; size: number; x: number; y: number; radius: number; name: string };

/** A paper's name on the map, and its title when the evidence map has it; a library record's title is looked up. */
export type Label = { who: string; year: number | null; title?: string };

/**
 * The points, as columns. Points [0, linked) are library records with citations inside the library, [linked, library) are
 * library records the evidence map names without any, and the rest are papers outside the library.
 */
export type Points = {
	count: number;
	linked: number;
	library: number;
	space: number;
	positions: Float32Array;
	years: Uint16Array;
	cites: Uint16Array;
	region: Uint16Array;
	area: Uint16Array;
	kind: Uint8Array;
	verdict: Uint8Array;
	flags: Uint8Array;
	places: Place[];
	/** Citations between regions: [region, region, citations]. */
	bundles: [number, number, number][];
};

export const FLAG = { library: 1, corpus: 2, chain: 4, outside: 8, methods: 16, stray: 32 } as const;

/** What a paper is, by the evidence map's reading; `unknown` for most of the library, which the map does not cover. */
export const KINDS = ["unknown", "primary", "review", "meta", "secondOrder", "commentary", "methods", "critique", "methodsPaper"] as const;
export type Kind = (typeof KINDS)[number];

/** Björn's integrity verdicts, in his order: 0 is not assessed. */
export const VERDICTS = ["notAssessed", "pending", "unverifiable", "validated", "caveats", "repairable", "questionable", "broken"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** How a paper is linked to another in the evidence map. */
export const LINK = { analyses: 1, citesReview: 2, cites: 3 } as const;

/**
 * A paper's place in a chain, in columns from the left as Björn draws them: what its studies analysed, its studies, the paper,
 * what analyses it, and what analyses those.
 */
export type Chain = { focus: number; layers: number[][]; links: [number, number][]; others: number[] };

/** The chain asked for in place of a paper: Björn's whole graph of checked papers. */
export const CHECKED = -1;

/** An opened paper and the citations to and from it, the most a neighbourhood lights. */
export const aroundOf = (index: number, cites: number[], citedBy: number[]) => [index, ...[...new Set([...cites, ...citedBy])].slice(0, 1500)];

/** A record's neighbourhood inside the library. */
export type Neighbourhood = { cites: number[]; citedBy: number[] };

export type ToWorker =
	| { type: "load"; theme: Theme; meta: unknown; places: Place[]; points: ArrayBuffer }
	| { type: "colours"; theme: Theme; id: number }
	| { type: "more" }
	| { type: "chain"; index: number; id: number }
	| { type: "neighbourhood"; index: number; id: number }
	| { type: "links"; rect: [number, number, number, number]; theme: Theme; id: number };

export type FromWorker =
	| { type: "loaded"; points: Points; colours: Float32Array; sizes: Float32Array }
	| { type: "colours"; id: number; colours: Float32Array }
	| { type: "more"; labels: [number, string, number | null][]; titles: [number, string][]; keys: string; dois: [number, string][] }
	| { type: "chain"; id: number; chain: Chain | null }
	| { type: "neighbourhood"; id: number; neighbourhood: Neighbourhood }
	| { type: "links"; id: number; pairs: Float32Array; colours: Float32Array }
	/** What failed: the first frame's data, the rest, or one question by its id (which is then answered empty). */
	| { type: "failed"; message: string; stage: "load" | "more" | number };

export type Theme = "light" | "dark";

/** A meta-analysis or review that names the studies it analysed, as the chains list shows it. */
export type ChainEntry = { index: number; paper: string; who: string; year: number | null; title: string; verdict: number; outside: boolean; analyses: number };

/** A paper's level in Björn's graph, by its kind: 1 a primary study, 2 a meta-analysis or review, 3 a review of reviews or a critique of meta-analyses. */
export function levelOf(kind: number) {
	const name = KINDS[kind];
	return name === "secondOrder" || name === "critique" ? 3 : name === "meta" || name === "review" ? 2 : 1;
}
