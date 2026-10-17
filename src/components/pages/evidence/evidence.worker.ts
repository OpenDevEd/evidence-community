/// <reference lib="webworker" />
// Everything heavy about the evidence map happens here, off the page's thread: downloading and decoding the binary columns,
// and answering what a paper's chain, neighbourhood or visible links are (worked out in atlas.ts).
import { checkedChain, chainOf, colours, decodeCitations, neighbourhoodOf, sizes, sortLinks, visibleLinks, type Atlas, type Columns } from "./atlas";
import { CHECKED, EVIDENCE_DATA, type FromWorker, type Place, type Theme, type ToWorker } from "./data";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

let atlas: Atlas | null = null;

async function load(file: string) {
	const response = await fetch(`${EVIDENCE_DATA}/${file}`);
	if (!response.ok) throw new Error(`${file} answered ${response.status}`);
	return response;
}

function column<T extends Float32Array | Uint16Array | Uint8Array | Uint32Array>(buffer: ArrayBuffer, spec: { offset: number; type: string; length: number }): T {
	const Type = { Float32Array, Uint16Array, Uint8Array, Uint32Array }[spec.type as "Float32Array"];
	return new Type(buffer, spec.offset, spec.length) as T;
}

/** A gzipped file's bytes, unpacked: binary files travel gzipped because servers rarely compress them. */
function gunzip(buffer: ArrayBuffer) {
	return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

type Meta = { points: number; linked: number; library: number; space: number; quant: number; layout: Record<string, { offset: number; type: string; length: number }>; bundles: [number, number, number][] };

/** The page downloads the first frame's files itself, so its preloads are used; this unpacks and colours them. */
async function loadPoints(theme: Theme, meta: Meta, places: Place[], packed: ArrayBuffer) {
	const buffer = await gunzip(packed);
	const l = meta.layout;
	// Positions travel as 16-bit fixed point; the graphics card wants floats.
	const fixed = column<Uint16Array>(buffer, l.x_y), positions = new Float32Array(fixed.length);
	for (let k = 0; k < fixed.length; k++) positions[k] = fixed[k] / meta.quant;
	const columns: Columns = {
		count: meta.points, linked: meta.linked, library: meta.library, space: meta.space,
		positions, years: column(buffer, l.year), cites: column(buffer, l.cites), region: column(buffer, l.region),
		area: column(buffer, l.area), kind: column(buffer, l.kind), verdict: column(buffer, l.verdict), flags: column(buffer, l.flags),
	};
	// The page gets the buffers themselves; this thread keeps copies for the questions it answers later.
	const copy = buffer.slice(0);
	const kept = { ...columns, positions: positions.slice(), cites: column(copy, l.cites), region: column(copy, l.region), verdict: column(copy, l.verdict), flags: column(copy, l.flags), kind: column(copy, l.kind) } as Columns;
	atlas = { points: kept };
	const c = colours(kept, theme), s = sizes(kept);
	post({ type: "loaded", points: { ...columns, places, bundles: meta.bundles }, colours: c, sizes: s }, [buffer, positions.buffer, c.buffer, s.buffer]);
}

/** The rest: citations, the evidence map's links, labels and keys. None of it is needed for the first frame. */
async function loadMore() {
	const [citations, links, labels, titles, keys, dois] = await Promise.all([
		load("citations.bin.gz").then((r) => r.arrayBuffer()).then(gunzip),
		load("evidence-links.bin.gz").then((r) => r.arrayBuffer()).then(gunzip),
		load("labels.json").then((r) => r.json()),
		load("titles.json").then((r) => r.json()),
		load("keys.txt").then((r) => r.text()),
		load("dois.json").then((r) => r.json()),
	]);
	const known = atlas!;
	atlas = { ...known, ...decodeCitations(new Uint8Array(citations), known.points.linked), ...sortLinks(new Uint32Array(links)) };
	post({ type: "more", labels, titles, keys, dois });
}

/** What answers each question the page asks. */
const answer: { [K in ToWorker["type"]]: (message: Extract<ToWorker, { type: K }>) => void | Promise<void> } = {
	load: (message) => loadPoints(message.theme, message.meta as Meta, message.places, message.points),
	more: () => loadMore(),
	colours: (message) => { const c = colours(atlas!.points, message.theme); post({ type: "colours", id: message.id, colours: c }, [c.buffer]); },
	chain: (message) => post({ type: "chain", id: message.id, chain: message.index === CHECKED ? checkedChain(atlas!) : chainOf(atlas!, message.index) }),
	neighbourhood: (message) => post({ type: "neighbourhood", id: message.id, neighbourhood: neighbourhoodOf(atlas!, message.index) }),
	links: (message) => { const { pairs, colours: c } = visibleLinks(atlas!, message.rect, message.theme); post({ type: "links", id: message.id, pairs, colours: c }, [pairs.buffer, c.buffer]); },
};

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	try {
		await (answer[message.type] as (m: ToWorker) => void | Promise<void>)(message);
	} catch (error) {
		const stage = message.type === "load" || message.type === "more" ? message.type : message.id;
		post({ type: "failed", message: error instanceof Error ? error.message : String(error), stage });
	}
};
