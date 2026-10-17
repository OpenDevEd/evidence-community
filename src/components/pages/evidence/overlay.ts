import type { More } from "./client";
import { FLAG, type Chain, type Place, type Points, type Theme } from "./data";
import { css, regionInk, STAGE } from "./palette";

/** Where things are on screen this frame. */
export type Camera = {
	x: (spaceX: number) => number;
	y: (spaceY: number) => number;
	/** Back from the screen into space. */
	toSpace: (screenX: number, screenY: number) => [number, number];
	/** Zoom relative to the whole map in view. */
	scale: number;
	/** A point's place in space this frame, part-way through a morph. */
	position: (index: number) => [number, number];
	chain: Chain | null;
	focus: number | null;
	/** The paper pointed at in a list: named first, in bold. */
	hovered: number | null;
	/** The few papers a search or check lights on the map: named next. */
	found: number[] | null;
	/** In a chain, what the search and checks light: the rest of the chain's names fade with their points. */
	lit: ReadonlySet<number> | null;
	more: More | null;
	width: number;
	height: number;
};

/** Collision cells, in screen pixels: a label takes every cell its box touches. */
const CELL = 8;
/** Label candidates are bucketed in squares this many space units wide. */
const CELL_SPACE = 64;
/** How long a label takes to fade in or out. */
const FADE_MS = 180;

type Box = { x: number; y: number; w: number; h: number };
/** How a label is drawn, kept so it can keep fading out after it has lost its place. A topic's name has a wider halo, to read over its own dense points. */
type Look = { value: string; at: (camera: Camera) => [number, number]; font: string; colour: string; align: CanvasTextAlign & ("center" | "left" | "right"); weight: number; halo?: number };

/**
 * The map's words, drawn like a map's: region names when the whole library is in view, area names closer in, then papers by
 * priority. Nothing overlaps: a label goes where no earlier one is. Labels fade in and out instead of popping, and the canvas
 * is redrawn only when the camera moves or a fade is running.
 */
export class LabelOverlay {
	private context: CanvasRenderingContext2D;
	private widths = new Map<string, number>();
	private alpha = new Map<string, number>();
	/** Each label's strength as drawn, moving towards the strength it asks for, so a label dimmed or lit again fades there. */
	private strength = new Map<string, number>();
	private easing = false;
	private looks = new Map<string, Look>();
	private last = 0;
	/** The page's own font family, read from the page: a canvas cannot read CSS variables, and ignores a font that uses one. */
	private family = typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily || "sans-serif";
	private regions: Place[];
	private areas: Place[];
	/** Each area's region, so its name takes the region's colour. */
	private regionOf = new Map<number, number>();
	private theme: Theme;
	private grid = new Uint8Array(0);
	private columns = 0;
	private rows = 0;
	/** Labelled papers by map cell, each cell in priority order, so a frame only looks at what is on screen. */
	private index: { from: More; cells: Map<number, number[]>; rank: Int32Array } | null = null;

	constructor(private canvas: HTMLCanvasElement, private points: Points, theme: Theme) {
		this.context = canvas.getContext("2d")!;
		this.theme = theme;
		this.regions = points.places.filter((place) => place.level === 1).sort((a, b) => b.size - a.size);
		this.areas = points.places.filter((place) => place.level === 2).sort((a, b) => b.size - a.size);
		// An area is laid out inside its region, so its centre lies in the region's circle.
		const edge = (area: Place, region: Place) => Math.hypot(region.x - area.x, region.y - area.y) - region.radius;
		for (const area of this.areas) this.regionOf.set(area.id, this.regions.reduce((best, region) => (edge(area, region) < edge(area, best) ? region : best)).id);
	}

	setTheme(theme: Theme) {
		this.theme = theme;
	}

	private width(font: string, text: string) {
		const key = `${font}|${text}`;
		let width = this.widths.get(key);
		if (width === undefined) {
			this.context.font = font;
			width = this.context.measureText(text).width;
			this.widths.set(key, width);
		}
		return width;
	}

	private take(box: Box) {
		const x0 = Math.max(0, Math.floor(box.x / CELL)), x1 = Math.min(this.columns - 1, Math.floor((box.x + box.w) / CELL));
		const y0 = Math.max(0, Math.floor(box.y / CELL)), y1 = Math.min(this.rows - 1, Math.floor((box.y + box.h) / CELL));
		if (x1 < x0 || y1 < y0) return false;
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.grid[y * this.columns + x]) return false;
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.grid[y * this.columns + x] = 1;
		return true;
	}

	/** The labelled papers in the cells the screen covers, best first. */
	private candidates(camera: Camera) {
		const index = this.indexFor(camera.more!);
		const [ax, ay] = camera.toSpace(0, 0), [bx, by] = camera.toSpace(camera.width, camera.height);
		const x0 = Math.floor(Math.min(ax, bx) / CELL_SPACE), x1 = Math.floor(Math.max(ax, bx) / CELL_SPACE);
		const y0 = Math.floor(Math.min(ay, by) / CELL_SPACE), y1 = Math.floor(Math.max(ay, by) / CELL_SPACE);
		const found: number[] = [];
		for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) found.push(...(index.cells.get(cy * 4096 + cx) ?? []));
		return found.sort((a, b) => index.rank[a] - index.rank[b]);
	}

	/** The labelled papers by map cell, made once for each labels file. */
	private indexFor(more: More) {
		if (this.index?.from === more) return this.index;
		const cells = new Map<number, number[]>(), rank = new Int32Array(this.points.count).fill(-1);
		let r = 0;
		for (const [index] of more.labels) {
			rank[index] = r++;
			const key = this.cellOf(this.points.positions[2 * index], this.points.positions[2 * index + 1]);
			cells.set(key, [...(cells.get(key) ?? []), index]);
		}
		this.index = { from: more, cells, rank };
		return this.index;
	}

	private cellOf(x: number, y: number) {
		return Math.floor(y / CELL_SPACE) * 4096 + Math.floor(x / CELL_SPACE);
	}

	// The frame being drawn: its camera, how far fades move in it, and the labels it keeps.
	private camera!: Camera;
	private step = 0;
	private wanted = new Set<string>();

	/** Draws a frame; true while a label is still fading, so the caller draws another. */
	draw(camera: Camera): boolean {
		this.camera = camera;
		this.wanted = new Set();
		this.prepare();
		this.nameOpened();
		this.nameRegions();
		this.nameAreas();
		this.namePapers();
		return this.fade();
	}

	/** Sizes the canvas and the collision grid to the screen, clears both, and works out this frame's fade step. */
	private prepare() {
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		const { width, height } = this.camera;
		if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
			this.canvas.width = Math.round(width * ratio);
			this.canvas.height = Math.round(height * ratio);
		}
		this.columns = Math.ceil(width / CELL);
		this.rows = Math.ceil(height / CELL);
		if (this.grid.length !== this.columns * this.rows) this.grid = new Uint8Array(this.columns * this.rows);
		else this.grid.fill(0);
		this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
		this.context.clearRect(0, 0, width, height);
		// A fade moves by the time since the last frame, but after an idle spell (no frames drawn) it starts from its first step:
		// a label appearing on the first frame after a pause still fades in.
		const now = performance.now();
		this.step = this.last ? Math.min(50, now - this.last) / FADE_MS : 16 / FADE_MS;
		this.last = now;
	}

	private inside(x: number, y: number, margin = 40) {
		return x > -margin && y > -margin && x < this.camera.width + margin && y < this.camera.height + margin;
	}

	private paint(look: Look, alpha: number) {
		const ctx = this.context, [x, y] = look.at(this.camera);
		ctx.globalAlpha = alpha * look.weight;
		ctx.font = look.font;
		ctx.textAlign = look.align;
		ctx.textBaseline = "middle";
		ctx.lineJoin = "round";
		ctx.lineWidth = look.halo ?? 4;
		ctx.strokeStyle = STAGE[this.theme].halo;
		ctx.strokeText(look.value, x, y);
		ctx.fillStyle = look.colour;
		ctx.fillText(look.value, x, y);
	}

	/** Places a label where no earlier one is, its strength easing towards the one it asks for, and paints it. */
	private text(key: string, asked: Look) {
		const was = this.strength.get(key) ?? asked.weight;
		const weight = was + Math.max(-this.step, Math.min(this.step, asked.weight - was));
		this.strength.set(key, weight);
		if (weight !== asked.weight) this.easing = true;
		const look = { ...asked, weight };
		if (!this.take(boxOf(look, look.at(this.camera), this.width(look.font, look.value)))) return;
		this.wanted.add(key);
		this.looks.set(key, look);
		this.paint(look, Math.min(1, (this.alpha.get(key) ?? 0) + this.step));
	}

	/** A paper's name beside its point, on the side given; the opened or hovered paper in bold, one a filter leaves out dimmed. */
	private paper(index: number, chainLabel: boolean, side: "left" | "right" = "right") {
		const camera = this.camera, label = camera.more?.labels.get(index);
		if (!label || !this.onScreen(index)) return;
		const strong = isStrong(camera, index, chainLabel), offset = (strong ? 10 : 7) * (side === "left" ? -1 : 1);
		this.text(`p${index}`, {
			value: nameOf(label),
			at: (c) => { const [px, py] = c.position(index); return [c.x(px) + offset, c.y(py)]; },
			font: `${strong ? "600 13px" : "400 11px"} ${this.family}`,
			colour: this.inkFor(index),
			align: side === "left" ? "right" : "left",
			weight: leftOut(camera, index) ? 0.55 : 1,
		});
	}

	private onScreen(index: number) {
		const [sx, sy] = this.camera.position(index);
		return this.inside(this.camera.x(sx), this.camera.y(sy), 0);
	}

	/** A paper's name in the page's ink, quieter than the topics' coloured names, fainter for a paper outside the library. */
	private inkFor(index: number) {
		const ink = STAGE[this.theme].ink;
		return css([ink[0], ink[1], ink[2], this.points.flags[index] & FLAG.outside ? 0.5 : 0.72]);
	}

	/**
	 * The papers that matter most are named first, so nothing takes their place: the one pointed at in a list, the few a filter
	 * lights, then an open chain's papers or the opened paper.
	 */
	private nameOpened() {
		const { hovered, found, chain, focus } = this.camera;
		if (hovered !== null) this.paper(hovered, true, chain ? sideIn(chain, hovered) : "right");
		for (const index of found ?? []) this.paper(index, true);
		if (chain) this.nameChain(chain);
		else if (focus !== null) this.paper(focus, true);
	}

	/** A chain names every paper in it, the opened one first; the map behind keeps only its region names, faintly. */
	private nameChain(chain: Chain) {
		this.paper(chain.focus, true);
		for (const index of chain.layers.flat()) if (index !== chain.focus) this.paper(index, true, sideIn(chain, index));
	}

	private nameRegions() {
		const camera = this.camera;
		const weight = camera.chain ? 0.35 : Math.max(0, Math.min(1, (3.2 - camera.scale) / 1.2));
		if (weight <= 0.02) return;
		const font = `700 17px ${this.family}`;
		for (const region of this.regions) {
			if (!this.inside(camera.x(region.x), camera.y(region.y))) continue;
			this.text(`r${region.id}`, { value: region.name, at: (c) => [c.x(region.x), c.y(region.y)], font, colour: css(regionInk(region.id, this.theme, 1)), align: "center", weight, halo: 6 });
		}
	}

	private nameAreas() {
		const camera = this.camera;
		if (camera.chain || camera.scale <= 1.6) return;
		// Once in, an area's name stays at full strength however close the reader comes: it says where they are.
		const weight = Math.max(0, Math.min(1, (camera.scale - 1.6) / 0.6));
		const font = `600 13px ${this.family}`;
		for (const area of this.areas) {
			if (!this.inside(camera.x(area.x), camera.y(area.y))) continue;
			this.text(`a${area.id}`, { value: area.name, at: (c) => [c.x(area.x), c.y(area.y)], font, colour: css(regionInk(this.regionOf.get(area.id) ?? 0, this.theme, 0.85)), align: "center", weight, halo: 5 });
		}
	}

	/** Papers by priority: the labels file is ranked, the evidence map's own papers first. Only the cells on screen are read. */
	private namePapers() {
		const camera = this.camera;
		if (camera.chain || !camera.more || camera.scale <= 2.2) return;
		const limit = namesAt(camera.scale);
		// Further out, only the evidence map's own papers are named.
		const named = this.candidates(camera).filter((index) => camera.scale >= 4.5 || this.points.flags[index] & FLAG.corpus);
		let shown = 0;
		for (const index of named) {
			if (shown >= limit) break;
			const before = this.wanted.size;
			this.paper(index, false);
			shown += this.wanted.size > before ? 1 : 0;
		}
	}

	/** A wanted label rises to full; one that lost its place fades out where it now is, over the others, then is forgotten. */
	private fade() {
		let fading = this.easing;
		this.easing = false;
		for (const key of this.wanted) {
			const alpha = Math.min(1, (this.alpha.get(key) ?? 0) + this.step);
			this.alpha.set(key, alpha);
			if (alpha < 1) fading = true;
		}
		for (const [key, alpha] of this.alpha) {
			if (this.wanted.has(key)) continue;
			const look = this.looks.get(key);
			if (alpha - this.step <= 0 || !look) { this.forget(key); continue; }
			this.alpha.set(key, alpha - this.step);
			this.paint(look, alpha - this.step);
			fading = true;
		}
		this.context.globalAlpha = 1;
		return fading;
	}

	private forget(key: string) {
		this.alpha.delete(key);
		this.looks.delete(key);
		this.strength.delete(key);
	}
}

/** The opened paper in its chain, and the one pointed at in a list, are named in bold. */
const isStrong = (camera: Camera, index: number, chainLabel: boolean) => (chainLabel && index === camera.focus) || index === camera.hovered;

/** A paper's name on the map: who and when. */
const nameOf = (label: { who: string; year: number | null }) => (label.year ? `${label.who} ${label.year}` : label.who);

/** Few enough names that the map still reads as a map: more as the reader comes closer. */
const namesAt = (scale: number) => (scale > 12 ? 90 : scale > 6 ? 60 : 36);

/** The screen box a label takes, by how it is anchored. */
function boxOf(look: Look, [x, y]: [number, number], w: number): Box {
	const h = parseFloat(look.font.match(/(\d+(?:\.\d+)?)px/)![1]) * 1.25;
	const left = look.align === "center" ? x - w / 2 - 3 : look.align === "right" ? x - w - 4 : x - 2;
	return { x: left, y: y - h / 2 - 1, w: w + 6, h: h + 2 };
}

/** Whether the search and checks leave this paper out of the open chain: its name dims with its point. */
function leftOut(camera: Camera, index: number) {
	return Boolean(camera.lit && index !== camera.focus && index !== camera.hovered && !camera.lit.has(index));
}

/**
 * The side a chain paper is named on: the outer side of its column, as Björn's boxes send their lines from the inner side.
 * Columns left of the opened paper (or of his middle column) are named on their left, so the lines leave them clear.
 */
function sideIn(chain: Chain, index: number): "left" | "right" {
	const middle = Math.max(1, chain.layers.findIndex((layer) => layer[0] === chain.focus));
	const at = chain.layers.findIndex((layer) => layer.includes(index));
	return at >= 0 && at < middle && index !== chain.focus ? "left" : "right";
}
