// What the evidence map knows, worked out from its decoded data: the points' colours and sizes, a paper's chain, the checked
// papers' graph, a record's citations, and the citations to draw for the part of the map in view. Plain functions over plain
// arrays, so the worker runs them off the page's thread and tests run them directly.
import { CHECKED, FLAG, levelOf, LINK, VERDICTS, type Chain, type Points, type Theme } from "./data";
import { inkAt, regionDot, STAGE, verdictDot, type RGBA } from "./palette";

export type Columns = Omit<Points, "places" | "bundles">;
/** Rows of targets, one row per linked record: row i is targets[offsets[i]] up to targets[offsets[i + 1]]. */
export type Rows = { offsets: Uint32Array; targets: Uint32Array };
/** Everything the map's questions are answered from. The citations and the evidence links arrive after the first frame. */
export type Atlas = {
	points: Columns;
	cites?: Rows;
	citedBy?: Rows;
	/** The evidence map's links, per point: what it analyses, what analyses it, and what else it cites. */
	analyses?: Map<number, number[]>;
	analysedBy?: Map<number, number[]>;
	citesOther?: Map<number, number[]>;
};

/** A point's own colour: its check when it has one, else its kind of paper, else its region's faded colour. */
function colourOf(p: Columns, i: number, theme: Theme): readonly number[] {
	const flags = p.flags[i], ink = STAGE[theme].ink, muted = STAGE[theme].muted;
	if (flags & (FLAG.methods | FLAG.stray)) return [0, 0, 0, 0];
	if (p.verdict[i]) return verdictDot(VERDICTS[p.verdict[i]]);
	if (flags & FLAG.corpus) return [ink[0], ink[1], ink[2], 0.5];
	if (flags & FLAG.outside) return [muted[0], muted[1], muted[2], 0.4];
	if (p.region[i] !== 65535) return regionDot(p.region[i], theme);
	return [muted[0], muted[1], muted[2], theme === "dark" ? 0.85 : 0.75];
}

/** The overview's look: every record in its region's faded colour and a check in its own strong one. */
export function colours(p: Columns, theme: Theme) {
	const out = new Float32Array(p.count * 4);
	for (let i = 0; i < p.count; i++) out.set(colourOf(p, i, theme), i * 4);
	return out;
}

/** A point's size: by how often the library cites it, with the evidence map's papers larger and its checked papers largest. */
function sizeOf(p: Columns, i: number) {
	const flags = p.flags[i];
	if (flags & (FLAG.methods | FLAG.stray)) return 0;
	if (p.verdict[i]) return 14;
	if (flags & FLAG.outside) return flags & FLAG.corpus ? 4.5 : 2.2;
	const size = Math.min(8, 1.5 + 1.1 * Math.log2(1 + p.cites[i]));
	return flags & FLAG.corpus ? Math.max(size, 4.5) : size;
}

export function sizes(p: Columns) {
	const out = new Float32Array(p.count);
	for (let i = 0; i < p.count; i++) out[i] = sizeOf(p, i);
	return out;
}

/**
 * The citations file: row lengths, then each row's sorted targets as gaps from the one before, all as variable-length numbers
 * (seven bits a byte, the high bit saying another byte follows). Returns who each record cites, and who cites it.
 */
export function decodeCitations(bytes: Uint8Array, linked: number): { cites: Rows; citedBy: Rows } {
	let at = 0;
	const read = () => {
		let value = 0, shift = 0, byte = 0;
		do { byte = bytes[at++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
		return value;
	};
	const offsets = new Uint32Array(linked + 1);
	for (let i = 0; i < linked; i++) offsets[i + 1] = offsets[i] + read();
	const targets = new Uint32Array(offsets[linked]);
	for (let i = 0; i < linked; i++) {
		let previous = 0;
		for (let k = offsets[i]; k < offsets[i + 1]; k++) { previous += read(); targets[k] = previous; }
	}
	return { cites: { offsets, targets }, citedBy: invert({ offsets, targets }, linked) };
}

/** The same rows turned around: who cites each record. */
function invert({ offsets, targets }: Rows, linked: number): Rows {
	const inOffsets = new Uint32Array(linked + 1);
	for (let k = 0; k < targets.length; k++) inOffsets[targets[k] + 1]++;
	for (let i = 0; i < linked; i++) inOffsets[i + 1] += inOffsets[i];
	const inTargets = new Uint32Array(targets.length), fill = inOffsets.slice(0, linked);
	for (let i = 0; i < linked; i++) for (let k = offsets[i]; k < offsets[i + 1]; k++) inTargets[fill[targets[k]]++] = i;
	return { offsets: inOffsets, targets: inTargets };
}

/** The evidence links file, triples of from, to and kind, sorted into what each paper analyses, is analysed by, and cites. */
export function sortLinks(triples: Uint32Array) {
	const analyses = new Map<number, number[]>(), analysedBy = new Map<number, number[]>(), citesOther = new Map<number, number[]>();
	const push = (map: Map<number, number[]>, key: number, value: number) => {
		const list = map.get(key);
		if (list) list.push(value);
		else map.set(key, [value]);
	};
	for (let k = 0; k < triples.length; k += 3) {
		const [from, to, type] = [triples[k], triples[k + 1], triples[k + 2]];
		if (type === LINK.analyses) { push(analyses, from, to); push(analysedBy, to, from); }
		else push(citesOther, from, to);
	}
	return { analyses, analysedBy, citesOther };
}

/** Most papers a column of a chain shows; the most severe verdicts come first, then the most cited. */
const LAYER_MAX = 90;
const severity = (p: Columns, i: number) => {
	const v = p.verdict[i];
	if (v === 0) return 0;
	return v >= 5 ? 20 + v : 10 + v;
};
const byConcern = (p: Columns) => (a: number, b: number) => severity(p, b) - severity(p, a) || p.cites[b] - p.cites[a];

/** Every "analyses" link between two of these papers, from the one analysing. */
function linksAmong(members: Set<number>, analyses: Map<number, number[]>): [number, number][] {
	const links: [number, number][] = [];
	for (const from of members) for (const to of analyses.get(from) ?? []) if (members.has(to)) links.push([from, to]);
	return links;
}

/**
 * A paper's chain: up to two steps along "analyses" each way, in columns from the left as Björn draws them: what its studies
 * analysed, its studies, the paper, what analyses it, and what analyses those. Nothing for a paper with no such link.
 */
export function chainOf({ points: p, analyses, analysedBy, citesOther }: Atlas, index: number): Chain | null {
	if (!analyses || !analysedBy) return null;
	const seen = new Set([index]);
	const take = (list: number[]) => [...new Set(list)].sort(byConcern(p)).filter((i) => !seen.has(i) && seen.add(i)).slice(0, LAYER_MAX);
	const up1 = take(analysedBy.get(index) ?? []);
	const up2 = take(up1.flatMap((i) => analysedBy.get(i) ?? []));
	const down1 = take(analyses.get(index) ?? []);
	const down2 = take(down1.flatMap((i) => analyses.get(i) ?? []));
	if (!up1.length && !down1.length) return null;
	const members = new Set([index, ...up1, ...up2, ...down1, ...down2]);
	const others = (citesOther?.get(index) ?? []).filter((i) => !members.has(i)).slice(0, 400);
	return { focus: index, layers: [down2, down1, [index], up1, up2].filter((layer) => layer.length), links: linksAmong(members, analyses), others };
}

/**
 * Björn's whole graph: every checked paper an "analyses" link joins to another checked one, and what the checked reviews of
 * reviews analyse, in his three columns: primary studies, meta-analyses and reviews, reviews of reviews.
 */
export function checkedChain({ points: p, analyses, analysedBy }: Atlas): Chain | null {
	if (!analyses || !analysedBy) return null;
	const rated = (i: number) => p.verdict[i] > 0;
	const members = new Set<number>();
	for (let i = 0; i < p.count; i++) {
		if (!rated(i)) continue;
		if ([...(analyses.get(i) ?? []), ...(analysedBy.get(i) ?? [])].some(rated)) members.add(i);
		if (levelOf(p.kind[i]) !== 3) continue;
		for (const j of analyses.get(i) ?? []) { members.add(i); members.add(j); }
	}
	const layers = [1, 2, 3].map((level) => [...members].filter((i) => levelOf(p.kind[i]) === level).sort(byConcern(p))).filter((layer) => layer.length);
	return { focus: CHECKED, layers, links: linksAmong(members, analyses), others: [] };
}

/** A record's citations in the library, both ways. Asked before the citations have arrived: nothing to say yet. */
export function neighbourhoodOf({ points: p, cites, citedBy }: Atlas, index: number) {
	if (!cites || !citedBy || index >= p.linked) return { cites: [], citedBy: [] };
	const row = (rows: Rows) => Array.from(rows.targets.subarray(rows.offsets[index], rows.offsets[index + 1]));
	return { cites: row(cites), citedBy: row(citedBy) };
}

/** Most records in view whose citations are drawn, and most lines. */
const VIEW_MAX = 2500, LINES_MAX = 14_000;
/** How few papers in view before their citations leading off screen are drawn as well. */
const OFF_SCREEN_FROM = 150;

/** The linked records inside a box of space, the most cited first. */
function inViewOf(p: Columns, [x0, y0, x1, y1]: [number, number, number, number]) {
	const inView: number[] = [];
	for (let i = 0; i < p.linked; i++) {
		const x = p.positions[2 * i], y = p.positions[2 * i + 1];
		if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inView.push(i);
	}
	return inView.sort((a, b) => p.cites[b] - p.cites[a]);
}

/** A record's citations into the pairs to draw: the ones it makes, and with `offScreen` the ones it receives from out of view. */
function addRow(pairs: number[], i: number, { cites, citedBy }: { cites: Rows; citedBy: Rows }, chosen: Uint8Array, offScreen: boolean) {
	for (let k = cites.offsets[i]; k < cites.offsets[i + 1] && pairs.length < LINES_MAX * 2; k++) {
		const j = cites.targets[k];
		if (offScreen || chosen[j]) pairs.push(i, j);
	}
	if (!offScreen) return;
	for (let k = citedBy.offsets[i]; k < citedBy.offsets[i + 1] && pairs.length < LINES_MAX * 2; k++) {
		const j = citedBy.targets[k];
		if (!chosen[j]) pairs.push(j, i);
	}
}

/** The more lines in view, the fainter each: thousands overlapping read as a haze, not a dark mesh; a few hundred as lines. */
function lineColour(count: number, theme: Theme): RGBA {
	return inkAt(theme, Math.max(0.05, Math.min(0.28, 4 / Math.sqrt(Math.max(1, count)))) * (theme === "dark" ? 1.3 : 1));
}

/**
 * The citations to draw for the part of the map in view: among the 2,500 most cited records in view, every citation from one
 * to another. Close in, with few papers in view, their citations off screen too: most of them lead there, and still say where
 * each paper connects. Further out those would bundle into dark streaks towards the few papers everyone cites.
 */
export function visibleLinks({ points: p, cites, citedBy }: Atlas, rect: [number, number, number, number], theme: Theme) {
	if (!cites || !citedBy) return { pairs: new Float32Array(), colours: new Float32Array() };
	const inView = inViewOf(p, rect), drawn = inView.slice(0, VIEW_MAX);
	const chosen = new Uint8Array(p.linked);
	for (const i of drawn) chosen[i] = 1;
	const pairs: number[] = [], offScreen = inView.length <= OFF_SCREEN_FROM;
	for (const i of drawn) addRow(pairs, i, { cites, citedBy }, chosen, offScreen);
	const count = pairs.length / 2, colours = new Float32Array(count * 4), colour = lineColour(count, theme);
	for (let k = 0; k < count; k++) colours.set(colour, k * 4);
	return { pairs: new Float32Array(pairs), colours };
}
