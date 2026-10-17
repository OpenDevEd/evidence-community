import { Graph, LinkStyle, PointShape, TransitionEasing } from "@cosmos.gl/graph";
import type { Loaded, More, Opened } from "./client";
import { evidenceClient } from "./client";
import { aroundOf, CHECKED, FLAG, VERDICTS, type Chain, type Label, type Theme } from "./data";
import { LabelOverlay, type Camera } from "./overlay";
import { edgeColour, inkAt, STAGE, type RGBA } from "./palette";

/** An opened paper: its chain, if the evidence map has one, and its citations inside the library. */
export type Selection = Opened;

export type GraphEvents = {
	onHover: (index: number | null, screen: [number, number] | null) => void;
	onSelect: (index: number | null) => void;
	/** The part of the canvas the map shows through, between the page's panels: a focused chain is fitted into it. */
	visibleArea: (withPaper: boolean) => { left: number; right: number; top: number; bottom: number };
};

/** What the map shows: the whole library, the citations around where the reader is looking, or one paper's chain. */
type Mode = "overview" | "nearby" | "chain" | "neighbourhood";
type Links = [pairs: Float32Array, colours: Float32Array, widths: Float32Array, styles?: Float32Array];

const MORPH_MS = 900;
/** Lines fade out this fast before they change and back in this slowly after; a change of what is lit cross-fades in FADE_MS. */
const LINES_OUT_MS = 140, LINES_IN_MS = 320, FADE_MS = 280;
/** At most this many papers lit on the map grow to be found. */
const FEW_LIT = 600;
/** At most this many lit papers are also named. */
const NAMED_LIT = 40;
/** A paper pointed at in a list grows and lights this fast. */
const HOVER_MS = 160;
/** The zoom range, against the whole library in view. */
const MIN_ZOOM = 0.5, MAX_ZOOM = 200;
/** How far in, relative to the whole map, the citations among the papers in view replace the lines between regions. */
const NEARBY_FROM = 2.4;
/** Frames drawn after the pointer moves or the canvas resizes: cosmos.gl works out what is under the pointer a frame or two late. */
const SETTLE_FRAMES = 3;

/** How a chain link is drawn: in Björn's colour for the study it comes from, and dashed when that study is broken, so it reads without colour too. */
function linkLook(verdict: number): { colour: RGBA; style: LinkStyle } {
	return { colour: edgeColour(VERDICTS[verdict]), style: VERDICTS[verdict] === "broken" ? LinkStyle.Dashed : LinkStyle.Solid };
}

/** The margin a chain's fit leaves, as a share of the space beside the panels; and the room, in screen pixels, a paper's name takes beside its column. */
const CHAIN_PADDING = 0.06, NAME_ROOM = 150;

const eased = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The library's citation map on the graphics card. cosmos.gl draws and animates every point; this decides what it shows and
 * draws a frame only when something moved, so an idle map costs nothing.
 */
export class EvidenceGraph {
	private graph: Graph;
	private overlay: LabelOverlay;
	private theme: Theme;
	private reducedMotion: boolean;
	private hubs: number;
	/** Every point's home on the map, hubs included; a chain moves some points away and back. */
	private home: Float32Array;
	/** Where the points are going, and where they set off from while a morph runs. */
	private target: Float32Array;
	private from: Float32Array | null = null;
	private morphStart = 0;
	private mode: Mode = "overview";
	private fitZoom = 1;
	private measuringFit = false;
	private pointScale = 1;
	private frame = 0;
	private extraFrames = 0;
	/**
	 * When the running morph is over, by this page's own clock with a frame or two to spare. cosmos.gl's start and end callbacks
	 * also fire for a short colour fade, and the end of one replaced by a morph can come while the morph still runs: taken as
	 * the morph's end, the next redraw would cancel the morph and leave the points behind their names and lines.
	 */
	private morphEnd = 0;
	/** Frames are drawn until then, for a fade cosmos.gl is playing. */
	private drawUntil = 0;
	private get animating() {
		return performance.now() < this.morphEnd;
	}
	private destroyed = false;
	private more: More | null = null;
	private chain: Chain | null = null;
	private around: [index: number, cites: number[], citedBy: number[]] | null = null;
	private focus: number | null = null;
	private highlight: number[] | undefined;
	/** The same, as a set, for the labels to ask each frame. */
	private lit: ReadonlySet<number> | null = null;
	private linksRequest = 0;
	private linksTimer = 0;
	private sizes: Float32Array;
	private resizing: ResizeObserver;
	/** What the camera last fitted to for an open paper: fitted again when the canvas changes size (a phone turned on its side). */
	private placed: number[] | null = null;
	/** The margin that fit left around them. */
	private placedPadding = 0.15;
	/** Every point's own colour; what is not lit is drawn from it, dimmed. */
	private base: Float32Array;
	/** The lines' strength as drawn, a fade towards a new strength, and the lines waiting for the old ones to fade out. */
	private lineAlpha = 1;
	private lineTween: { from: number; to: number; start: number; ms: number; done?: () => void } | null = null;
	private nextLines: { links: Links; fadeLong: boolean; then?: () => void } | null = null;
	/** The paper pointed at in a list, and the sizes the points have without it. */
	private hovered: number | null = null;
	private sizesNow: Float32Array;
	/** A change of what is lit that came during a morph: it fades in once the morph ends. */
	private recolourAfter = false;
	/** For the test handle: what the camera last fitted. */
	private lastFit: { positions: number[]; withPaper: boolean } | null = null;
	private refitTimer = 0;
	readonly ready: Promise<void>;

	constructor(private container: HTMLDivElement, labels: HTMLCanvasElement, private data: Loaded, reducedMotion: boolean, private events: GraphEvents) {
		// The colours arrived made for one theme; the page switches to its own once the map is ready.
		const theme = data.theme;
		this.theme = theme;
		this.reducedMotion = reducedMotion;
		const { points } = data;
		const regions = points.places.filter((place) => place.level === 1);
		this.hubs = points.count;
		const total = points.count + regions.length;
		// The regions' centres as points nobody sees: the lines between regions run between them.
		this.home = new Float32Array(total * 2);
		this.home.set(points.positions);
		regions.forEach((region, k) => this.home.set([region.x, region.y], (this.hubs + k) * 2));
		this.target = this.home.slice();
		this.sizes = new Float32Array(total);
		this.sizes.set(data.sizes);
		this.sizesNow = this.sizes;
		const colours = new Float32Array(total * 4);
		colours.set(data.colours);
		this.base = colours.slice();
		const shapes = new Float32Array(total);
		shapes.fill(PointShape.None, this.hubs);

		this.graph = new Graph(container, {
			backgroundColor: STAGE[theme].background,
			spaceSize: points.space,
			enableSimulation: false,
			// Frames are drawn when something changes, not 60 times a second.
			enableRenderLoop: false,
			rescalePositions: false,
			fitViewOnInit: false,
			pixelRatio: Math.min(2, window.devicePixelRatio || 1),
			scalePointsOnZoom: false,
			pointSizeScale: 1,
			renderHoveredPointRing: true,
			hoveredPointRingColor: STAGE[theme].ink.slice(0, 3).concat(0.9) as RGBA,
			hoveredPointCursor: "pointer",
			curvedLinks: true,
			curvedLinkWeight: 0.7,
			curvedLinkControlPointDistance: 0.35,
			linkDefaultWidth: 1,
			linkVisibilityDistanceRange: [40, 900],
			linkVisibilityMinTransparency: 0.35,
			linkDashLength: 7,
			linkDashGap: 5,
			transitionDuration: reducedMotion ? 0 : MORPH_MS,
			transitionEasing: TransitionEasing.CubicInOut,
			onPointMouseOver: (index, position, event) => this.events.onHover(index, this.screenOf(event)),
			onPointMouseOut: () => this.events.onHover(null, null),
			onPointClick: (index) => this.events.onSelect(index),
			onBackgroundClick: () => this.events.onSelect(null),
			onZoom: () => { this.sizeForZoom(); this.request(); },
			onZoomEnd: () => {
				// The first fit lands a tick after it is asked for: its zoom is what "the whole library" means from then on.
				if (this.measuringFit) { this.measuringFit = false; this.fitZoom = this.graph.getZoomLevel(); this.limitZoom(); this.sizeForZoom(); }
				this.cameraSettled();
			},
			onTransitionStart: () => this.request(),
			onTransitionEnd: () => this.request(),
		});
		this.overlay = new LabelOverlay(labels, data.points, theme);
		this.ready = this.graph.ready.then(() => {
			if (this.destroyed) return;
			this.graph.setPointPositions(this.home, true);
			this.graph.setPointColors(colours);
			this.setSizes(this.sizes);
			this.graph.setPointShapes(shapes);
			this.mode = "overview";
			this.writeLinks(this.bundleLinks());
			this.graph.render();
			this.measuringFit = true;
			this.fitAll(0);
			this.request();
		});
		if (process.env.NODE_ENV !== "production") (window as unknown as { evidenceGraph?: EvidenceGraph }).evidenceGraph = this;
		container.addEventListener("pointermove", this.settle);
		// The canvas's size is an outside fact: a resize needs frames drawn at the new size.
		this.resizing = new ResizeObserver(() => {
			this.settle();
			clearTimeout(this.refitTimer);
			if (this.placed) this.refitTimer = window.setTimeout(() => this.placed && this.fitTo(this.placed, this.placedPadding, 0), 150);
		});
		this.resizing.observe(container);
	}

	/** Where the pointer is in the window, for the hover card, which is placed against the window. */
	private screenOf(event: MouseEvent | unknown): [number, number] | null {
		return event instanceof MouseEvent ? [event.clientX, event.clientY] : null;
	}

	private settle = () => this.request(SETTLE_FRAMES);

	/** Asks for a frame, and `extra` more after it; while a morph or a label fade runs, each frame asks for the next. */
	private request = (extra = 0) => {
		this.extraFrames = Math.max(this.extraFrames, extra);
		if (this.frame || this.destroyed) return;
		this.frame = requestAnimationFrame(this.draw);
	};

	private draw = () => {
		this.frame = 0;
		if (this.destroyed) return;
		this.landMorph();
		this.stepLines();
		this.graph.renderOneFrame();
		const fading = this.overlay.draw(this.camera());
		this.extraFrames = Math.max(0, this.extraFrames - 1);
		if (fading || this.moving()) this.request();
	};

	/** A morph that has just landed: what came to light meanwhile fades in now. */
	private landMorph() {
		if (!this.from || this.animating) return;
		this.from = null;
		if (!this.recolourAfter) return;
		this.recolourAfter = false;
		this.renderOver(FADE_MS);
	}

	/** Whether anything on the map is still changing, so another frame is needed. */
	private moving() {
		return this.animating || this.lineTween !== null || this.extraFrames > 0 || performance.now() < this.drawUntil;
	}

	/**
	 * Applies what changed, played over `ms`, and keeps frames coming until it is over. Every change on the map goes through
	 * here: frames are drawn only on demand, so a fade cosmos.gl plays needs frames for as long as it runs, or it stops partway.
	 */
	private renderOver(ms: number) {
		this.graph.render(undefined, ms);
		this.drawUntil = Math.max(this.drawUntil, performance.now() + ms + 50);
		this.request();
	}

	/** Fades the lines towards `to` over `ms`, then runs `done`. */
	private fadeLines(to: number, ms: number, done?: () => void) {
		if (ms <= 0) {
			this.lineAlpha = to;
			this.graph.setConfigPartial({ linkOpacity: to });
			this.lineTween = null;
			done?.();
			this.request();
			return;
		}
		this.lineTween = { from: this.lineAlpha, to, start: performance.now(), ms, done };
		this.request();
	}

	private stepLines() {
		const tween = this.lineTween;
		if (!tween) return;
		const t = Math.min(1, (performance.now() - tween.start) / tween.ms);
		this.lineAlpha = tween.from + (tween.to - tween.from) * eased(t);
		this.graph.setConfigPartial({ linkOpacity: this.lineAlpha });
		if (t < 1) return;
		this.lineTween = null;
		tween.done?.();
	}

	/** How far the running morph has gone, eased as cosmos.gl eases it. */
	private morphProgress() {
		return this.from && !this.reducedMotion ? eased(Math.min(1, (performance.now() - this.morphStart) / MORPH_MS)) : 1;
	}

	/** The current camera, and where the points a chain moves are this frame. */
	private camera(): Camera {
		const [ox, oy] = this.graph.spaceToScreenPosition([0, 0]);
		const [ux, uy] = this.graph.spaceToScreenPosition([1000, 1000]);
		const t = this.morphProgress(), from = this.from, target = this.target;
		return {
			x: (sx) => ox + (sx * (ux - ox)) / 1000,
			y: (sy) => oy + (sy * (uy - oy)) / 1000,
			toSpace: (x, y) => [((x - ox) * 1000) / (ux - ox), ((y - oy) * 1000) / (uy - oy)],
			scale: this.graph.getZoomLevel() / this.fitZoom,
			position: (i) => (from ? [from[2 * i] + (target[2 * i] - from[2 * i]) * t, from[2 * i + 1] + (target[2 * i + 1] - from[2 * i + 1]) * t] : [target[2 * i], target[2 * i + 1]]),
			chain: this.chain,
			focus: this.focus,
			hovered: this.hovered,
			found: this.fewLit(NAMED_LIT),
			lit: this.mode === "chain" ? this.lit : null,
			more: this.more,
			width: this.container.clientWidth,
			height: this.container.clientHeight,
		};
	}

	/**
	 * How far the reader can zoom: from half the whole library out, to far enough in that a dense cluster opens up into
	 * separate papers, and no further, past which there is only empty space. cosmos.gl 3.5 has no setting for it, so its d3 zoom is told directly.
	 */
	private limitZoom(least = Infinity) {
		const zoom = (this.graph as unknown as { zoomInstance?: { behavior?: { scaleExtent(extent: [number, number]): unknown } } }).zoomInstance;
		zoom?.behavior?.scaleExtent([Math.min(least, this.fitZoom * MIN_ZOOM), this.fitZoom * MAX_ZOOM]);
	}

	/** Points grow as the reader zooms in, from specks across the whole library to dots that can be pointed at. */
	private sizeForZoom() {
		const scale = Math.max(0.5, Math.min(5, 0.55 + 0.45 * Math.log2(Math.max(1, this.graph.getZoomLevel() / this.fitZoom))));
		if (Math.abs(scale - this.pointScale) < 0.02) return;
		this.pointScale = scale;
		this.graph.setConfigPartial({ pointSizeScale: scale });
	}

	/** For checking the map from a test script (scripts/evidence-map), in development only: read through window.evidenceGraph. */
	// fallow-ignore-next-line unused-class-member
	debug() {
		const focus = this.chain?.layers.at(-1)?.[0] ?? this.focus ?? 0;
		// What the camera last fitted, on screen, beside the space it was fitted into.
		const fitted = this.lastFit && { ...this.lastFit, positions: Array.from({ length: this.lastFit.positions.length / 2 }, (_, k) => this.graph.spaceToScreenPosition([this.lastFit!.positions[2 * k], this.lastFit!.positions[2 * k + 1]])), area: this.events.visibleArea(this.lastFit.withPaper) };
		// How far the drawn points are from where the names and lines expect them: a cancelled morph leaves them apart.
		const drawn = this.graph.getPointPositions();
		let apart = 0;
		for (let k = 0; k < this.hubs * 2; k++) apart = Math.max(apart, Math.abs(drawn[k] - this.target[k]));
		return { apart, zoom: this.graph.getZoomLevel(), fitZoom: this.fitZoom, mode: this.mode, more: Boolean(this.more), animating: this.animating, focus, target: [this.target[2 * focus], this.target[2 * focus + 1]], fitted };
	}

	/** Names a paper the labels file leaves unnamed, once its record is in: the opened paper is always named on the map. */
	name(index: number, label: Label) {
		if (!this.more || this.more.labels.has(index)) return;
		this.more.labels.set(index, label);
		this.request();
	}

	setMore(more: More) {
		this.more = more;
		this.request();
	}

	/** After a zoom or pan settles: the lines between regions, or the citations among what is in view. */
	private cameraSettled() {
		this.request();
		if (this.mode === "chain" || this.mode === "neighbourhood") return;
		clearTimeout(this.linksTimer);
		if (this.graph.getZoomLevel() / this.fitZoom < NEARBY_FROM) {
			// Any answer still on its way is for a view the reader has left.
			this.linksRequest++;
			if (this.mode !== "overview") this.showBundles();
			return;
		}
		this.linksTimer = window.setTimeout(() => void this.showNearby(), 120);
	}

	private showBundles() {
		this.mode = "overview";
		this.swapLinks(this.bundleLinks());
	}

	private bundleLinks(): Links {
		const bundles = this.data.points.bundles, max = Math.max(1, ...bundles.map((b) => b[2]));
		const pairs = new Float32Array(bundles.length * 2), widths = new Float32Array(bundles.length), colours = new Float32Array(bundles.length * 4);
		const ink = STAGE[this.theme].ink;
		bundles.forEach(([a, b, w], k) => {
			pairs.set([this.hubs + a, this.hubs + b], k * 2);
			widths[k] = 0.4 + 5 * (Math.log(w) / Math.log(max)) ** 3;
			colours.set([ink[0], ink[1], ink[2], 0.05 + (0.13 * Math.log(w)) / Math.log(max)], k * 4);
		});
		return [pairs, colours, widths];
	}

	private async showNearby() {
		const id = ++this.linksRequest;
		const [x0, y0] = this.graph.screenToSpacePosition([0, 0]);
		const [x1, y1] = this.graph.screenToSpacePosition([this.container.clientWidth, this.container.clientHeight]);
		// The citations arrive after the first frame; a reader who zooms in before them waits for them here.
		const client = evidenceClient();
		await client.more().catch(() => null);
		const { pairs, colours } = await client.links([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], this.theme);
		if (id !== this.linksRequest || this.mode === "chain" || this.mode === "neighbourhood" || this.destroyed) return;
		this.mode = "nearby";
		// Close in, every citation is long on screen: these keep their strength rather than fade as the overview's lines do.
		this.swapLinks([pairs, colours, new Float32Array(pairs.length / 2).fill(0.8)], false);
	}

	/**
	 * Changes the lines drawn: the old ones fade out, then the new ones go in, `then` runs (a morph starts with them), and they
	 * fade in. A change asked for while the old lines are still fading out replaces the one waiting.
	 */
	private swapLinks(links: Links, fadeLong = true, then?: () => void) {
		if (this.reducedMotion) {
			this.writeLinks(links, fadeLong);
			if (then) then();
			else this.applyLinks();
			return;
		}
		const waiting = this.nextLines !== null;
		this.nextLines = { links, fadeLong, then };
		if (waiting) return;
		this.fadeLines(0, LINES_OUT_MS * this.lineAlpha, () => {
			const next = this.nextLines!;
			this.nextLines = null;
			this.writeLinks(next.links, next.fadeLong);
			if (next.then) next.then();
			else this.applyLinks();
			this.fadeLines(1, LINES_IN_MS);
		});
	}

	/** Puts these lines in at once; long ones fade, as the overview's lines between regions should, unless `fadeLong` is false. */
	private writeLinks([pairs, colours, widths, styles]: Links, fadeLong = true) {
		this.graph.setConfigPartial(fadeLong ? { linkVisibilityDistanceRange: [40, 900], linkVisibilityMinTransparency: 0.35 } : { linkVisibilityDistanceRange: [40, 100_000], linkVisibilityMinTransparency: 1 });
		this.graph.setLinks(pairs);
		this.graph.setLinkColors(colours);
		this.graph.setLinkWidths(widths);
		this.graph.setLinkStyles(styles ?? new Float32Array(widths.length));
	}

	/**
	 * Applies what changed at once. cosmos.gl cancels a running morph when it redraws and leaves the points where the morph began,
	 * so a morph still running is finished first, at its end positions.
	 */
	private redrawNow() {
		if (this.animating) {
			this.graph.setPointPositions(this.target, true);
			this.morphEnd = 0;
			this.from = null;
		}
		this.renderOver(0);
		this.request();
	}

	/** Applies new links, unless a morph is running: it applies them as it goes. A waiting change of what is lit fades in with them. */
	private applyLinks() {
		if (!this.animating) {
			this.recolourAfter = false;
			this.renderOver(this.reducedMotion ? 0 : FADE_MS);
		}
		this.request();
	}

	/** What is lit now: the open chain or paper narrowed by the search and checks, or else what they light on the map. */
	private litNow(): number[] | undefined {
		if (this.mode === "chain" && this.chain) return this.litWithin(this.chain.layers.flat(), this.chain.focus);
		if (this.mode === "neighbourhood" && this.around) return this.litWithin(this.aroundMembers(), this.around[0]);
		return this.highlight;
	}

	/**
	 * Gives every point its colour, what is not lit dimmed. Lighting by colour rather than cosmos.gl's highlight lets its
	 * transitions cross-fade a change instead of switching it on one frame. Takes effect at the next render.
	 */
	private paintPoints() {
		const lit = this.litNow(), colours = this.base.slice();
		if (lit) {
			// Three steps: lit; part of the open chain or citations but left out by the search and checks, dimmed only partly so
			// the tree keeps its shape and its lines end on something; and the map behind, dimmed far enough that what is lit
			// stands out while the map's shape still shows.
			const dim = [this.theme === "dark" ? 0.07 : 0.08, 0.4, 1], step = this.stepsOf(lit);
			for (let i = 0; i < this.hubs; i++) colours[i * 4 + 3] *= dim[step[i]];
		}
		this.graph.setPointColors(colours);
	}

	/** Each point's step: 2 lit, 1 part of what is open, 0 the map behind. */
	private stepsOf(lit: number[]) {
		const step = new Uint8Array(this.base.length / 4);
		for (const i of this.openMembers()) step[i] = 1;
		for (const i of lit) step[i] = 2;
		if (this.hovered !== null) step[this.hovered] = 2;
		return step;
	}

	/** The papers of what is open: a chain's, or a paper and its citations; nothing on the plain map. */
	private openMembers(): number[] {
		if (this.mode === "chain" && this.chain) return this.chain.layers.flat();
		if (this.mode === "neighbourhood" && this.around) return this.aroundMembers();
		return [];
	}

	/** Shows a change of what is lit: cross-faded now, or once a running morph or line change has landed. */
	private recolour() {
		this.paintPoints();
		this.applyLater(FADE_MS);
	}

	/** Points the reader asked for (a search, a verdict) stay lit; the rest fade back. `undefined` lights everything. */
	setHighlight(indices: number[] | undefined) {
		this.highlight = indices;
		this.lit = indices ? new Set(indices) : null;
		// With a chain or a paper's citations open, the search and checks narrow what is open; elsewhere they light the map.
		this.graph.setPointSizes(this.withHover(this.sizesNow));
		this.recolour();
	}

	/** What is open, narrowed to what the search and checks light; the opened paper stays lit whatever they are. */
	private litWithin(members: number[], keep: number) {
		const lit = this.lit;
		return lit ? members.filter((i) => i === keep || lit.has(i)) : members;
	}

	/** A paper and the citations to and from it that light up when it is opened. */
	private aroundMembers() {
		return aroundOf(...this.around!);
	}

	/** Opens a paper: its chain moves into layers in front of the map, or its citations light up where they are. */
	async select(index: number | null): Promise<Selection | null> {
		if (index === null) { this.release(); return null; }
		this.focus = index;
		const opened = await evidenceClient().opened(index);
		if (this.focus !== index || this.destroyed) return null;
		if (opened.chain) this.showChain(opened.chain);
		else this.showNeighbourhood(index, opened.cites, opened.citedBy);
		return opened;
	}

	private chainLinks(chain: Chain): Links {
		const verdicts = this.data.points.verdict;
		const pairs = new Float32Array(chain.links.length * 2), colours = new Float32Array(chain.links.length * 4), widths = new Float32Array(chain.links.length), styles = new Float32Array(chain.links.length);
		chain.links.forEach(([from, to], k) => {
			const look = linkLook(verdicts[to]);
			pairs.set([from, to], k * 2);
			// A paper pointed at in a list brings its own lines forward and sends the rest back.
			const touches = this.hovered !== null && (from === this.hovered || to === this.hovered);
			colours.set(this.hovered === null || touches ? look.colour : [look.colour[0], look.colour[1], look.colour[2], look.colour[3] * 0.3], k * 4);
			widths[k] = touches ? 2.4 : from === chain.focus || to === chain.focus ? 1.8 : 1.1;
			styles[k] = look.style;
		});
		return [pairs, colours, widths, styles];
	}

	private showChain(chain: Chain) {
		this.mode = "chain";
		this.chain = chain;
		this.around = null;
		this.linksRequest++;
		// Columns from the left, as Björn draws them: studies, then what analyses them, then what analyses those, one column a level
		// however long. The opened paper's column sits where the paper sits on the map; his whole graph sits in the middle of it.
		const middle = this.data.points.space / 2;
		const [hx, hy] = chain.focus === CHECKED ? [middle, middle] : [this.home[2 * chain.focus], this.home[2 * chain.focus + 1]];
		const screenOf = (x: number, y: number) => this.graph.spaceToScreenPosition([x, y]);
		const down = screenOf(0, 1)[1] > screenOf(0, 0)[1] ? 1 : -1, right = screenOf(1, 0)[0] > screenOf(0, 0)[0] ? 1 : -1;
		const ROW = 20, COLUMN = 200;
		const focusLayer = chain.layers.findIndex((layer) => layer[0] === chain.focus);
		const shift = (focusLayer >= 0 ? focusLayer : (chain.layers.length - 1) / 2) * COLUMN;
		const next = this.home.slice();
		const placed: number[] = [];
		chain.layers.forEach((layer, l) => {
			layer.forEach((index, k) => {
				const x = hx + right * (l * COLUMN - shift), y = hy + down * (k - (layer.length - 1) / 2) * ROW;
				next.set([x, y], index * 2);
				placed.push(x, y);
			});
		});
		// The whole graph fits beside the panels, the names running out beside the first and last columns included: the zoom
		// leaves them their screen width, and the fit is given where they end. A graph too tall to name every row at that zoom
		// names what fits and the rest as the reader zooms in.
		const area = this.events.visibleArea(true);
		const usableW = Math.max(160, area.right - area.left) * (1 - 2 * CHAIN_PADDING), usableH = Math.max(160, area.bottom - area.top) * (1 - 2 * CHAIN_PADDING);
		const width = (chain.layers.length - 1) * COLUMN, height = (Math.max(...chain.layers.map((layer) => layer.length)) - 1) * ROW;
		const k = Math.max(0.02, Math.min(width ? (usableW - 2 * NAME_ROOM) / width : Infinity, height ? usableH / height : Infinity, 4));
		const xs = placed.filter((_, at) => at % 2 === 0);
		placed.push(Math.min(...xs) - NAME_ROOM / k, hy, Math.max(...xs) + NAME_ROOM / k, hy);
		this.placed = placed;
		const members = chain.layers.flat();
		// The chain's papers all take one size, whatever their size on the map, so rows stay apart.
		const sizes = this.sizes.slice();
		for (const i of members) sizes[i] = i === chain.focus ? 11 : 8;
		// The old lines fade first; then the papers move, grow and light together, and the chain's lines fade in on the way.
		this.swapLinks(this.chainLinks(chain), true, () => {
			this.setSizes(sizes);
			this.paintPoints();
			this.graph.setConfigPartial({ focusedPointIndex: chain.focus === CHECKED ? undefined : chain.focus });
			this.morphTo(next);
			this.startMorph();
		});
		this.placedPadding = CHAIN_PADDING;
		this.fitTo(placed, CHAIN_PADDING);
	}

	private neighbourhoodLinks(index: number, cites: number[], citedBy: number[]): Links {
		const around = [...new Set([...cites, ...citedBy])].slice(0, 1500);
		const pairs = new Float32Array(around.length * 2), colours = new Float32Array(around.length * 4);
		const citesSet = new Set(cites);
		around.forEach((other, k) => {
			pairs.set(citesSet.has(other) ? [index, other] : [other, index], k * 2);
			colours.set(inkAt(this.theme, 0.35), k * 4);
		});
		return [pairs, colours, new Float32Array(around.length).fill(0.9)];
	}

	private showNeighbourhood(index: number, cites: number[], citedBy: number[]) {
		this.mode = "neighbourhood";
		this.chain = null;
		this.around = [index, cites, citedBy];
		this.linksRequest++;
		const links = this.neighbourhoodLinks(index, cites, citedBy);
		const lit = [...new Set([...cites, ...citedBy])].slice(0, 1500);
		const sizes = this.sizes.slice();
		sizes[index] = Math.max(sizes[index], 11);
		this.swapLinks(links, true, () => {
			this.setSizes(sizes);
			this.paintPoints();
			this.graph.setConfigPartial({ focusedPointIndex: index });
			this.morphTo(this.home.slice());
			this.startMorph();
		});
		// Fit the paper and the middle of its neighbourhood: a few citations from the far side of the map would shrink it to a dot.
		const xs = lit.map((i) => this.home[2 * i]).sort((a, b) => a - b), ys = lit.map((i) => this.home[2 * i + 1]).sort((a, b) => a - b);
		const q = (list: number[], f: number, fallback: number) => list[Math.floor((list.length - 1) * f)] ?? fallback;
		const [px, py] = [this.home[2 * index], this.home[2 * index + 1]];
		this.placed = [px, py, q(xs, 0.15, px), q(ys, 0.15, py), q(xs, 0.85, px), q(ys, 0.85, py)];
		this.placedPadding = 0.15;
		this.fitTo(this.placed, 0.15);
	}

	/** Fits what is in front again, as it moves: the space beside the panels changed (a notice over the map came or went). */
	refit() {
		if (this.placed) this.fitTo(this.placed, this.placedPadding);
	}

	private release() {
		if (this.focus === null) return;
		this.focus = null;
		this.placed = null;
		this.chain = null;
		this.around = null;
		// Back to the lines between regions while the points fly home; closer in, the citations in view follow once they land.
		this.mode = "overview";
		this.linksRequest++;
		this.swapLinks(this.bundleLinks(), true, () => {
			this.setSizes(this.sizes);
			this.paintPoints();
			this.graph.setConfigPartial({ focusedPointIndex: undefined });
			this.morphTo(this.home.slice());
			this.startMorph();
		});
		clearTimeout(this.linksTimer);
		if (this.graph.getZoomLevel() / this.fitZoom >= NEARBY_FROM) this.linksTimer = window.setTimeout(() => void this.showNearby(), this.reducedMotion ? 0 : MORPH_MS + 50);
	}

	/**
	 * Plays the morph set up by `morphTo`. It counts as running from this moment, not from cosmos.gl's start callback a frame
	 * later: a redraw in between (a list row's hover ending as it is clicked) would cancel it and leave the points behind while
	 * their names and lines go on to where they were going.
	 */
	private startMorph() {
		if (this.reducedMotion) {
			this.renderOver(0);
			this.morphEnd = 0;
			this.from = null;
		} else {
			this.morphEnd = performance.now() + MORPH_MS + 120;
			this.renderOver(MORPH_MS);
		}
		this.request();
	}

	/** Starts a morph to `next`. One already running hands over from wherever its points are now. */
	private morphTo(next: Float32Array) {
		if (this.from && this.animating) {
			const t = this.morphProgress(), from = this.from, target = this.target, now = new Float32Array(target.length);
			for (let k = 0; k < now.length; k++) now[k] = from[k] + (target[k] - from[k]) * t;
			this.from = now;
		} else this.from = this.target;
		this.target = next;
		this.morphStart = performance.now();
		this.graph.setPointPositions(next, true);
	}

	/** Fits these space positions into the part of the canvas the panels leave free. */
	/** Fits the positions into the space the panels leave, with `padding` of that space as a margin on each side. */
	private fitTo(positions: number[], padding: number, duration = this.reducedMotion ? 0 : MORPH_MS, withPaper = true) {
		if (process.env.NODE_ENV !== "production") this.lastFit = { positions, withPaper };
		const area = this.events.visibleArea(withPaper);
		const width = this.container.clientWidth, height = this.container.clientHeight;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (let k = 0; k < positions.length; k += 2) { x0 = Math.min(x0, positions[k]); x1 = Math.max(x1, positions[k]); y0 = Math.min(y0, positions[k + 1]); y1 = Math.max(y1, positions[k + 1]); }
		// Work out the zoom that fits the positions into the gap between the panels, and where their middle must sit for it to
		// land in the gap's middle; then hand cosmos.gl a box with the canvas's own proportions, which it fits exactly.
		const gapW = Math.max(160, area.right - area.left), gapH = Math.max(160, area.bottom - area.top);
		const w = Math.max(x1 - x0, 40), h = Math.max(y1 - y0, 40);
		const k = Math.min((gapW * (1 - 2 * padding)) / w, (gapH * (1 - 2 * padding)) / h);
		// Space and screen may run opposite ways on either axis.
		const [ox, oy] = this.graph.spaceToScreenPosition([0, 0]), [ux, uy] = this.graph.spaceToScreenPosition([1, 1]);
		const dx = ux >= ox ? 1 : -1, dy = uy >= oy ? 1 : -1;
		const bx = (x0 + x1) / 2 - ((area.left + area.right) / 2 - width / 2) / (k * dx);
		const by = (y0 + y1) / 2 - ((area.top + area.bottom) / 2 - height / 2) / (k * dy);
		const hw = width / (2 * k), hh = height / (2 * k);
		// cosmos.gl clamps a fit to the zoom range, and a long chain can stand taller than the whole library: let it zoom out that far.
		this.limitZoom((k * this.graph.getZoomLevel()) / Math.abs(ux - ox));
		this.graph.fitViewByPointPositions([bx - hw, by - hh, bx + hw, by + hh], duration, 0);
	}

	/** The whole library, fitted into the space beside the search panel. */
	fitAll(duration = this.reducedMotion ? 0 : 600) {
		const p = this.data.points.positions;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (let i = 0; i < this.data.points.count; i++) {
			if (this.data.points.flags[i] & FLAG.stray) continue;
			x0 = Math.min(x0, p[2 * i]); x1 = Math.max(x1, p[2 * i]); y0 = Math.min(y0, p[2 * i + 1]); y1 = Math.max(y1, p[2 * i + 1]);
		}
		this.fitTo([x0, y0, x1, y1], 0.04, duration, this.focus !== null);
	}

	zoomBy(factor: number) {
		this.graph.setZoomLevel(this.graph.getZoomLevel() * factor, this.reducedMotion ? 0 : 280);
	}

	/**
	 * Picks out the paper pointed at in a list: its ring, a larger point lit whatever the filters dim, its name in bold, and in a
	 * chain its lines brought forward. A row knows its paper's name, which the labels file may leave out.
	 */
	hoverHost(index: number | undefined, label?: Label) {
		if (index !== undefined && label) this.name(index, label);
		if ((index ?? null) === this.hovered) return;
		this.hovered = index ?? null;
		this.graph.setHostHoveredPoint(index);
		this.graph.setPointSizes(this.withHover(this.sizesNow));
		this.paintPoints();
		if (this.mode === "chain" && this.chain) this.writeLinks(this.chainLinks(this.chain));
		this.applyLater(HOVER_MS);
		this.request(SETTLE_FRAMES);
	}

	/** Plays a change over `ms`, or once a running morph or line change has landed: playing it now would cut that short. */
	private applyLater(ms: number) {
		if (this.animating || this.nextLines) this.recolourAfter = true;
		else this.renderOver(this.reducedMotion ? 0 : ms);
	}

	/** Sets the points' sizes, the one pointed at in a list grown. */
	private setSizes(sizes: Float32Array) {
		this.sizesNow = sizes;
		this.graph.setPointSizes(this.withHover(sizes));
	}

	/**
	 * The sizes drawn: a few papers a search or check lights on the map grow so they can be found among the rest, and the one
	 * pointed at in a list grows most. Many lit papers keep their size: grown, they would cover the map.
	 */
	private withHover(sizes: Float32Array) {
		const few = this.fewLit(FEW_LIT);
		if (this.hovered === null && !few) return sizes;
		const grown = sizes.slice();
		for (const i of few ?? []) grown[i] = Math.max(sizes[i], 14) * 2.2;
		if (this.hovered !== null) grown[this.hovered] = Math.max(sizes[this.hovered], 6) * 1.8;
		return grown;
	}

	/** What a search or check lights on the plain map, when it is at most `most` papers; nothing while a paper is open. */
	private fewLit(most: number) {
		const onMap = this.mode === "overview" || this.mode === "nearby";
		return onMap && this.highlight && this.highlight.length <= most ? this.highlight : null;
	}

	/** Recolours everything for a theme: the points, the background, the labels, and whichever links are drawn. */
	async setTheme(theme: Theme) {
		if (theme === this.theme) return;
		this.theme = theme;
		const colours = await evidenceClient().colours(theme);
		if (this.destroyed || theme !== this.theme) return;
		const all = new Float32Array(this.home.length * 2);
		all.set(colours);
		this.graph.setConfigPartial({ backgroundColor: STAGE[theme].background, hoveredPointRingColor: STAGE[theme].ink.slice(0, 3).concat(0.9) as RGBA });
		this.base = all;
		this.paintPoints();
		this.overlay.setTheme(theme);
		this.relinkForTheme();
		this.redrawNow();
	}

	/** The lines drawn now, in the new theme's colours; the nearby citations are asked for again. */
	private relinkForTheme() {
		if (this.mode === "nearby") return void this.showNearby();
		const links = this.mode === "chain" && this.chain ? this.chainLinks(this.chain) : this.mode === "neighbourhood" && this.around ? this.neighbourhoodLinks(...this.around) : this.bundleLinks();
		this.writeLinks(links);
	}

	destroy() {
		this.destroyed = true;
		cancelAnimationFrame(this.frame);
		clearTimeout(this.linksTimer);
		clearTimeout(this.refitTimer);
		this.resizing.disconnect();
		this.container.removeEventListener("pointermove", this.settle);
		this.graph.destroy();
	}
}

