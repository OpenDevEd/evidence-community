import { CHECKED, EVIDENCE_DATA, type Chain, type FromWorker, type Label, type Neighbourhood, type Points, type Theme, type ToWorker } from "./data";

/** The first frame's data. `theme` is the theme its colours were made for. */
export type Loaded = { points: Points; colours: Float32Array; sizes: Float32Array; theme: Theme };
/** What arrives after the first frame: each labelled paper's line, every library record's key, and DOIs for the rest. */
export type More = { labels: Map<number, Label>; keyOf: (index: number) => string | null; indexOf: (key: string) => number | undefined; doiOf: Map<number, string> };

/** An opened paper: its chain, if the evidence map has one, and its citations inside the library. */
export type Opened = { index: number; chain: Chain | null; cites: number[]; citedBy: number[] };

/** One worker for the page's lifetime: it holds the citations, so every later question is a message, not a download. */
class EvidenceClient {
	private worker: Worker;
	private next = 1;
	private waiting = new Map<number, (message: FromWorker) => void>();
	readonly loaded: Promise<Loaded>;
	private moreRequested: Promise<More> | null = null;
	private resolveMore: (more: More) => void = () => {};
	private rejectMore: (error: Error) => void = () => {};

	constructor(theme: Theme) {
		this.worker = new Worker(new URL("./evidence.worker.ts", import.meta.url), { type: "module" });
		let resolveLoaded!: (loaded: Loaded) => void, rejectLoaded!: (error: Error) => void;
		this.loaded = new Promise((resolve, reject) => { resolveLoaded = resolve; rejectLoaded = reject; });
		this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
			const message = event.data;
			if (message.type === "loaded") resolveLoaded({ points: message.points, colours: message.colours, sizes: message.sizes, theme });
			else if (message.type === "more") this.resolveMore(more(message));
			else if (message.type === "failed") this.failed(message.stage, new Error(message.message), rejectLoaded);
			else { this.waiting.get(message.id)?.(message); this.waiting.delete(message.id); }
		};
		// Fetched here, not in the worker: the page preloaded these, and a worker's fetch cannot use the page's preloads.
		const file = (name: string) => fetch(`${EVIDENCE_DATA}/${name}`).then((response) => { if (!response.ok) throw new Error(`${name} answered ${response.status}`); return response; });
		Promise.all([file("meta.json").then((r) => r.json()), file("places.json").then((r) => r.json()), file("points.bin.gz").then((r) => r.arrayBuffer())])
			.then(([meta, places, points]) => this.worker.postMessage({ type: "load", theme, meta, places, points } satisfies ToWorker, [points]))
			.catch((error: Error) => { console.error("Evidence map:", error.message); rejectLoaded(error); });
	}

	/** A failure goes to whatever was waiting for it. The rest of the data can be asked for again; a question is answered empty. */
	private failed(stage: "load" | "more" | number, error: Error, rejectLoaded: (error: Error) => void) {
		console.error("Evidence map:", error.message);
		if (stage === "load") rejectLoaded(error);
		else if (stage === "more") { this.moreRequested = null; this.rejectMore(error); }
		else { this.waiting.get(stage)?.({ type: "failed", message: error.message, stage }); this.waiting.delete(stage); }
	}

	private post(message: ToWorker) {
		this.worker.postMessage(message);
	}

	private ask<T>(message: ToWorker & { id: number }, read: (answer: FromWorker) => T) {
		return new Promise<T>((resolve) => {
			this.waiting.set(message.id, (answer) => resolve(read(answer)));
			this.post(message);
		});
	}

	/** Citations, labels and keys: asked for once the first frame is drawn. */
	more() {
		this.moreRequested ??= new Promise<More>((resolve, reject) => {
			this.resolveMore = resolve;
			this.rejectMore = reject;
			this.post({ type: "more" });
		});
		return this.moreRequested;
	}

	colours(theme: Theme) {
		return this.ask({ type: "colours", theme, id: this.next++ }, (a) => (a.type === "colours" ? a.colours : new Float32Array()));
	}

	chain(index: number) {
		return this.ask({ type: "chain", index, id: this.next++ }, (a): Chain | null => (a.type === "chain" ? a.chain : null));
	}

	neighbourhood(index: number) {
		return this.ask({ type: "neighbourhood", index, id: this.next++ }, (a): Neighbourhood => (a.type === "neighbourhood" ? a.neighbourhood : { cites: [], citedBy: [] }));
	}

	/**
	 * What opening a paper shows: its chain, if the evidence map has one, and its citations inside the library. A paper opened
	 * before the chains and citations have arrived waits for them; the whole graph of checked papers has no citations of its own.
	 */
	async opened(index: number): Promise<Opened> {
		await this.more().catch(() => null);
		const [chain, around] = await Promise.all([this.chain(index), index === CHECKED ? { cites: [], citedBy: [] } : this.neighbourhood(index)]);
		return { index, chain, cites: around.cites, citedBy: around.citedBy };
	}

	links(rect: [number, number, number, number], theme: Theme) {
		return this.ask({ type: "links", rect, theme, id: this.next++ }, (a) => (a.type === "links" ? { pairs: a.pairs, colours: a.colours } : { pairs: new Float32Array(), colours: new Float32Array() }));
	}
}

function more(message: Extract<FromWorker, { type: "more" }>): More {
	const labels = new Map<number, Label>();
	for (const [index, who, year] of message.labels) labels.set(index, { who, year });
	for (const [index, title] of message.titles) { const label = labels.get(index); if (label) label.title = title; }
	const keys = message.keys, count = keys.length / 8;
	// Built the first time a key is looked up (a search, an address with a paper in it), not while the page settles.
	let byKey: Map<string, number> | null = null;
	const indexOf = (key: string) => {
		if (!byKey) { byKey = new Map(); for (let i = 0; i < count; i++) byKey.set(keys.slice(i * 8, i * 8 + 8), i); }
		return byKey.get(key);
	};
	return { labels, keyOf: (index) => (index >= 0 && index < count ? keys.slice(index * 8, index * 8 + 8) : null), indexOf, doiOf: new Map(message.dois) };
}

let client: EvidenceClient | null = null;

/** The page's one client. The download starts the first time this runs in the browser, which is as soon as the page's script does. */
export function evidenceClient(theme: Theme = "light") {
	client ??= new EvidenceClient(theme);
	return client;
}
