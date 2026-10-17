// Builds the evidence map's data for AIED: one layout for the library's citation graph, with Björn's evidence map laid over it.
// Inputs: /tmp/evidence-data/aied-{nodes,edges,meta,topics}.csv and the citation map JSON. Output: binary columns and small JSON in OUT.
import fs from "node:fs";
import zlib from "node:zlib";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import louvain from "graphology-communities-louvain";

// Every run gives the same map: the same communities, the same layout, the same names.
let seed = 20261016;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const OUT = process.argv[2];
// The library the data is for, by its address: only that library shows the map.
const LIBRARY = process.argv[4] ?? "aied.openscholar.ai";
const MAP = process.argv[3];
const ITER = Number(process.argv[4] ?? 500);
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// A tiny CSV reader for the quoted exports.
function* csv(file) {
  const text = fs.readFileSync(file, "utf8");
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); yield row; row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

// Library records.
const keys = [], year = [], doiOf = [], indexOfKey = new Map(), indexOfDoi = new Map();
for (const [key, y, doi] of csv("/tmp/evidence-data/aied-nodes.csv")) {
  indexOfKey.set(key, keys.length);
  if (doi) indexOfDoi.set(doi, keys.length);
  keys.push(key); year.push(Number(y) || 0); doiOf.push(doi);
}
const L = keys.length;
const title = new Array(L).fill(""), author = new Array(L).fill(""), authors = new Uint16Array(L), topic = new Array(L).fill("");
for (const [key, t, a, n, tp] of csv("/tmp/evidence-data/aied-meta.csv")) {
  const i = indexOfKey.get(key); if (i === undefined) continue;
  title[i] = t; author[i] = a; authors[i] = Number(n) || 0; topic[i] = tp;
}
const topicName = new Map([...csv("/tmp/evidence-data/aied-topics.csv")].map(([id, name, field, subfield]) => [id, { name, field, subfield }]));

// Citations between library records: a cites b.
const citeA = [], citeB = [];
for (const [a, b] of csv("/tmp/evidence-data/aied-edges.csv")) {
  const i = indexOfKey.get(a), j = indexOfKey.get(b);
  if (i !== undefined && j !== undefined && i !== j) { citeA.push(i); citeB.push(j); }
}
const E = citeA.length;
const citedBy = new Uint32Array(L);
for (let e = 0; e < E; e++) citedBy[citeB[e]]++;
log("library", L, "records,", E, "citations");

// Undirected neighbours, as compressed rows, for the layout.
const deg = new Uint32Array(L + 1);
for (let e = 0; e < E; e++) { deg[citeA[e] + 1]++; deg[citeB[e] + 1]++; }
for (let i = 0; i < L; i++) deg[i + 1] += deg[i];
const nbr = new Uint32Array(2 * E), at = deg.slice(0, L);
for (let e = 0; e < E; e++) { nbr[at[citeA[e]]++] = citeB[e]; nbr[at[citeB[e]]++] = citeA[e]; }
const neighbours = (i) => nbr.subarray(deg[i], deg[i + 1]);

// The layout is a map: communities inside communities. A group too big to read as one blob is split into its own
// communities, those are laid out as a small weighted graph with room for each, and each is laid out the same way inside
// its place. A small group is laid out as one force-directed blob. Every group gets an area in proportion to its size.
const LEAF = 2000, UNIT = 1;
const level1 = new Int32Array(L).fill(-1), level2 = new Int32Array(L).fill(-1);
const groups = []; // named places: [level, members]
const px = new Float64Array(L), py = new Float64Array(L);
let leaves = 0;

function subgraph(members) {
  const g = new Graph({ type: "undirected" });
  const inside = new Set(members);
  for (const m of members) g.addNode(m);
  for (const m of members) for (const n of neighbours(m)) if (n > m && inside.has(n) && !g.hasEdge(m, n)) g.addEdge(m, n);
  return g;
}

/** Splits members into communities, folding small ones into the neighbour they cite most. */
function communities(g, members, minSize) {
  const found = louvain(g, { resolution: 1, rng: Math.random });
  const by = new Map();
  for (const m of members) { const c = found[m]; if (!by.has(c)) by.set(c, []); by.get(c).push(m); }
  let list = [...by.values()].sort((a, b) => b.length - a.length);
  const big = list.filter((c) => c.length >= minSize);
  if (big.length < 2) return [members];
  const home = new Map(); big.forEach((c, k) => c.forEach((m) => home.set(m, k)));
  for (const small of list.filter((c) => c.length < minSize)) {
    const votes = new Map();
    for (const m of small) for (const n of neighbours(m)) { const k = home.get(n); if (k !== undefined) votes.set(k, (votes.get(k) ?? 0) + 1); }
    const k = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    for (const m of small) { big[k].push(m); home.set(m, k); }
  }
  return big;
}

/** Lays members out around (0, 0) within radius sqrt(n); returns that radius. */
function layoutGroup(members, depth) {
  const R = UNIT * Math.sqrt(members.length);
  if (members.length <= LEAF || depth >= 3) {
    leaves++;
    const g = subgraph(members);
    g.forEachNode((n) => g.mergeNodeAttributes(n, { x: (Math.random() - 0.5) * R, y: (Math.random() - 0.5) * R }));
    if (g.size) forceAtlas2.assign(g, { iterations: members.length > 500 ? 120 : 200, settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: members.length > 800, gravity: 1, scalingRatio: 2, slowDown: 1 } });
    let cx = 0, cy = 0; g.forEachNode((n, a) => { cx += a.x; cy += a.y; }); cx /= members.length; cy /= members.length;
    let far = 1e-9; g.forEachNode((n, a) => { far = Math.max(far, Math.hypot(a.x - cx, a.y - cy)); });
    // Squeeze the farthest outliers in: a blob's radius is set by its body, not its strays.
    const dist = []; g.forEachNode((n, a) => dist.push(Math.hypot(a.x - cx, a.y - cy))); dist.sort((a, b) => a - b);
    const body = Math.max(1e-9, dist[Math.floor(dist.length * 0.97)] ?? far);
    g.forEachNode((n, a) => { let dx = (a.x - cx) / body, dy = (a.y - cy) / body; const d = Math.hypot(dx, dy); if (d > 1) { const s = (1 + Math.tanh(d - 1) * 0.15) / d; dx *= s; dy *= s; } px[n] = dx * R; py[n] = dy * R; });
    return R;
  }
  const g = subgraph(members);
  const parts = communities(g, members, Math.max(40, Math.floor(members.length / 60)));
  if (parts.length < 2) { return layoutGroup(members, 3); }
  for (const part of parts) {
    if (depth === 0) { const id = groups.length; groups.push([1, part]); part.forEach((m) => (level1[m] = id)); }
    else if (depth === 1) { const id = groups.length; groups.push([2, part]); part.forEach((m) => (level2[m] = id)); }
  }
  const radii = parts.map((p) => layoutGroup(p, depth + 1));
  // The communities as one small weighted graph, each node as large as its community.
  const home = new Map(); parts.forEach((p, k) => p.forEach((m) => home.set(m, k)));
  const meta = new Graph({ type: "undirected" });
  parts.forEach((p, k) => meta.addNode(k, { size: radii[k], x: Math.cos(k * 2.4) * Math.sqrt(k + 1) * R * 0.3, y: Math.sin(k * 2.4) * Math.sqrt(k + 1) * R * 0.3 }));
  const w = new Map();
  for (const m of members) for (const n of neighbours(m)) { const a = home.get(m), b = home.get(n); if (b === undefined || a >= b) continue; const key = a * 100000 + b; w.set(key, (w.get(key) ?? 0) + 1); }
  for (const [key, weight] of w) meta.addEdge(Math.floor(key / 100000), key % 100000, { weight: Math.log1p(weight) });
  forceAtlas2.assign(meta, { iterations: 400, getEdgeWeight: "weight", settings: { ...forceAtlas2.inferSettings(meta), adjustSizes: true, gravity: 0.6, scalingRatio: 4, edgeWeightInfluence: 1 } });
  // Push apart any places that still overlap, keeping a gap between them.
  const cx = parts.map((_, k) => meta.getNodeAttribute(k, "x")), cy = parts.map((_, k) => meta.getNodeAttribute(k, "y"));
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a], d = Math.hypot(dx, dy) || 1e-6, need = (radii[a] + radii[b]) * (depth === 0 ? 1.06 : 1.03);
      if (d < need) { const push = (need - d) / 2, ux = dx / d, uy = dy / d; cx[a] -= ux * push; cy[a] -= uy * push; cx[b] += ux * push; cy[b] += uy * push; moved = true; }
    }
    // Pull everything gently towards the middle so the map stays round instead of drifting apart.
    for (let a = 0; a < parts.length; a++) { cx[a] *= 0.985; cy[a] *= 0.985; }
    if (!moved && pass > 50) break;
  }
  let mx = 0, my = 0, total = 0; parts.forEach((p, k) => { mx += cx[k] * p.length; my += cy[k] * p.length; total += p.length; }); mx /= total; my /= total;
  let far = 0;
  parts.forEach((p, k) => { const ox = cx[k] - mx, oy = cy[k] - my; far = Math.max(far, Math.hypot(ox, oy) + radii[k]); for (const m of p) { px[m] += ox; py[m] += oy; } });
  return far;
}
layoutGroup([...Array(L).keys()], 0);
// Renumber the linked records along a Hilbert curve through the layout: neighbours on the map get neighbouring numbers, so a
// paper's citations are small gaps apart (they compress) and the graphics card reads nearby points from nearby memory.
{
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < L; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]); }
  const side = 1 << 16, span = Math.max(maxX - minX, maxY - minY) || 1;
  const hilbert = (x, y) => { let d = 0; for (let s = side >> 1; s > 0; s >>= 1) { const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); if (ry === 0) { if (rx === 1) { x = side - 1 - x; y = side - 1 - y; } [x, y] = [y, x]; } } return d; };
  const order = [...Array(L).keys()].map((i) => [i, hilbert(Math.floor(((px[i] - minX) / span) * (side - 1)), Math.floor(((py[i] - minY) / span) * (side - 1)))]).sort((a, b) => a[1] - b[1]).map(([i]) => i);
  const newIndex = new Uint32Array(L); order.forEach((old, n) => (newIndex[old] = n));
  const permute = (arr) => { const out = arr.slice(); order.forEach((old, n) => (out[n] = arr[old])); return out; };
  for (const arr of [keys, year, doiOf, title, author, topic]) { const p = permute(arr); for (let i = 0; i < L; i++) arr[i] = p[i]; }
  authors.set(permute(authors)); citedBy.set(permute(citedBy)); px.set(permute(px)); py.set(permute(py)); level1.set(permute(level1)); level2.set(permute(level2));
  for (let e = 0; e < E; e++) { citeA[e] = newIndex[citeA[e]]; citeB[e] = newIndex[citeB[e]]; }
  for (const g of groups) for (let k = 0; k < g[1].length; k++) g[1][k] = newIndex[g[1][k]];
  indexOfKey.clear(); indexOfDoi.clear();
  for (let i = 0; i < L; i++) { indexOfKey.set(keys[i], i); if (doiOf[i]) indexOfDoi.set(doiOf[i], i); }
}
const graph = { getNodeAttributes: (i) => ({ x: px[i], y: py[i] }) };
const cluster = new Uint16Array(L).fill(65535);
for (let i = 0; i < L; i++) if (level1[i] >= 0) cluster[i] = level1[i];
log("layout:", groups.filter((g) => g[0] === 1).length, "regions,", groups.filter((g) => g[0] === 2).length, "areas inside them,", leaves, "blobs");

// Every library record with a DOI, so an evidence paper in the library but without citation links still counts as the library's.
const libraryByDoi = new Map();
for (const [key, doi, y, t, a, n] of csv("/tmp/evidence-data/aied-doi.csv")) if (doi && !libraryByDoi.has(doi)) libraryByDoi.set(doi, { key, year: Number(y) || 0, title: t, author: a, authors: Number(n) || 0 });

// Björn's evidence map. Points: linked library records [0, L), then library records without links, then papers outside the library.
// The file can carry a whole reference tree (`tree_depth`, `cited_by`, `references`); the map draws only the evidence map's own
// graph: the corpus, the papers that list what they analysed or cite, and the papers in those lists.
const LISTS = ["analyses_these_papers", "also_cites_reviews", "also_cites_other"];
const whole = JSON.parse(fs.readFileSync(MAP, "utf8"));
const inGraph = new Set();
for (const e of whole) {
  const listed = LISTS.flatMap((list) => e[list] ?? []);
  if (e.in_corpus || listed.length) inGraph.add(e.doi.toLowerCase());
  for (const d of listed) inGraph.add(d.toLowerCase());
}
const map = whole.filter((e) => inGraph.has(e.doi.toLowerCase()));
log("evidence map file:", whole.length, "papers, of which", map.length, "in its own graph");
const KIND = { PRIMARY: 1, RCT: 1, QUANT: 1, REVIEW: 2, SR: 2, MA: 3, "SECOND-ORDER": 4, COMMENTARY: 5, CRITIQUE: 7, METHODS: 8, UNCLASSIFIED: 0 };
const METHODS = /\b(prisma|statement|guideline|guidance|reporting|bias in meta|publication bias|heterogeneity|inconsistency|metafor|introduction to meta|practical meta|trim and fill|funnel|effect size|statistical power|r package|handbook|meta-analysis in r|robust variance|quality assessment|risk of bias)\b/i;
const unlinked = new Map(), outsideIdx = new Map(), evidence = new Map();
for (const entry of map) {
  const doi = entry.doi.toLowerCase();
  if (indexOfDoi.has(doi)) continue;
  if (libraryByDoi.has(doi)) { if (!unlinked.has(doi)) unlinked.set(doi, null); } else if (!outsideIdx.has(doi)) outsideIdx.set(doi, null);
}
let next = L;
for (const doi of unlinked.keys()) { const r = libraryByDoi.get(doi); unlinked.set(doi, next); indexOfKey.set(r.key, next); keys.push(r.key); year.push(r.year); title.push(r.title); author.push(r.author); next++; }
const L2 = next; // library records end here
for (const doi of outsideIdx.keys()) outsideIdx.set(doi, next++);
const N = next;
const authorsAll = new Uint16Array(L2); authorsAll.set(authors); for (const [doi, i] of unlinked) authorsAll[i] = libraryByDoi.get(doi).authors;
const pointOf = (doi) => { const d = doi.toLowerCase(); return indexOfDoi.get(d) ?? unlinked.get(d) ?? outsideIdx.get(d); };
for (const entry of map) { const i = pointOf(entry.doi); if (!evidence.has(i) || entry.in_corpus) evidence.set(i, entry); }
log("evidence", map.length, "papers:", map.length - unlinked.size - outsideIdx.size, "linked library records,", unlinked.size, "library records without links,", outsideIdx.size, "outside the library");

// Columns.
const x = new Float32Array(N), y = new Float32Array(N);
for (let i = 0; i < L; i++) { x[i] = px[i]; y[i] = py[i]; }
const kind = new Uint8Array(N), verdict = new Uint8Array(N), flags = new Uint8Array(N), years = new Uint16Array(N), cites = new Uint16Array(N), region = new Uint16Array(N).fill(65535), area = new Uint16Array(N).fill(65535);
for (let i = 0; i < L2; i++) { years[i] = year[i]; flags[i] |= 1; }
for (let i = 0; i < L; i++) { cites[i] = Math.min(65535, citedBy[i]); if (level1[i] >= 0) region[i] = level1[i]; if (level2[i] >= 0) area[i] = level2[i]; }
const bibYear = (bib) => Number((bib.match(/\((\d{4})[a-z]?\)/) ?? [])[1] ?? 0);
const evidenceLinks = []; // from, to, type: 1 analyses, 2 cites a review, 3 cites
for (const [i, entry] of evidence) {
  kind[i] = KIND[entry.study_type] ?? 0;
  // Level 0 is a commentary, unless the file says it is a methods paper: a paper on how to do the work, in the corpus.
  if (entry.study_level === 0 && entry.study_type !== "METHODS") kind[i] = 5;
  verdict[i] = entry.integrity_assessment?.cat ?? 0;
  if (entry.in_corpus) flags[i] |= 2;
  if (entry.analyses_these_papers?.length) flags[i] |= 4;
  if (i >= L2) { flags[i] |= 8; years[i] = bibYear(entry.bib); }
  if (!entry.in_corpus && (entry.cited_by?.length ?? 0) >= 12 && METHODS.test(entry.bib)) { flags[i] |= 16; kind[i] = 6; }
  for (const [list, type] of LISTS.map((list, k) => [list, k + 1]))
    for (const d of entry[list] ?? []) { const j = pointOf(d); if (j !== undefined && j !== i) evidenceLinks.push(i, j, type); }
}
// A point without a place of its own sits among the papers it is linked to, slightly apart: placed points pass their place on, a few times over.
const placed = new Uint8Array(N); for (let i = 0; i < L; i++) placed[i] = 1;
let spread = 0; for (let i = 0; i < L; i++) spread = Math.max(spread, Math.abs(x[i]), Math.abs(y[i]));
for (let pass = 0; pass < 6; pass++) {
  const sx = new Float64Array(N), sy = new Float64Array(N), n = new Uint32Array(N);
  for (let k = 0; k < evidenceLinks.length; k += 3) for (const [a, b] of [[evidenceLinks[k], evidenceLinks[k + 1]], [evidenceLinks[k + 1], evidenceLinks[k]]]) {
    if (placed[a] && !placed[b]) { sx[b] += x[a]; sy[b] += y[a]; n[b]++; }
  }
  for (let i = L; i < N; i++) if (!placed[i] && n[i]) {
    const a = Math.random() * Math.PI * 2, r = spread * 0.006 * (0.5 + Math.random());
    x[i] = sx[i] / n[i] + r * Math.cos(a); y[i] = sy[i] / n[i] + r * Math.sin(a); placed[i] = 2;
  }
}
let stray = 0; for (let i = L; i < N; i++) if (!placed[i]) { stray++; flags[i] |= 32; }
log("placed beside their links:", N - L - stray, "; with nothing to sit beside:", stray);

// Into cosmos.gl's space, with a margin.
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < N; i++) { if (flags[i] & 32) continue; minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]); }
const SPACE = 4096, MARGIN = 192, scale = (SPACE - 2 * MARGIN) / Math.max(maxX - minX, maxY - minY);
const ox = (SPACE - (maxX - minX) * scale) / 2, oy = (SPACE - (maxY - minY) * scale) / 2;
const positions = new Float32Array(N * 2);
for (let i = 0; i < N; i++) { positions[2 * i] = ox + (x[i] - minX) * scale; positions[2 * i + 1] = oy + (y[i] - minY) * scale; }
// Papers with nothing to sit beside line the bottom edge in rows of their own, outside the map.
let row = 0; for (let i = 0; i < N; i++) if (flags[i] & 32) { positions[2 * i] = SPACE / 2 + ((row % 85) - 42) * 9; positions[2 * i + 1] = SPACE - MARGIN / 2 + Math.floor(row / 85) * 9; row++; }

// Places: the regions and the areas inside them, with what they are about. Naming happens in name.mjs from these.
const STOP = new Set("a an the of and or in on for to with by from at as is are was were be been its their this that these those using use based via into through toward towards among between within without study studies analysis effect effects impact role case new approach evidence review systematic research learning education educational students student teachers teacher school schools higher university".split(" "));
const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const df = new Map();
for (let i = 0; i < L; i++) for (const w of new Set(words(title[i]))) df.set(w, (df.get(w) ?? 0) + 1);
const places = groups.map(([level, members], id) => {
  let sx = 0, sy = 0, rr = 0; const tf = new Map(), tps = new Map();
  for (const m of members) { sx += positions[2 * m]; sy += positions[2 * m + 1]; for (const w of new Set(words(title[m]))) tf.set(w, (tf.get(w) ?? 0) + 1); const tp = topicName.get(topic[m]); if (tp) tps.set(tp.name, (tps.get(tp.name) ?? 0) + 1); }
  const cx = sx / members.length, cy = sy / members.length;
  for (const m of members) rr = Math.max(rr, Math.hypot(positions[2 * m] - cx, positions[2 * m + 1] - cy));
  const terms = [...tf].map(([w, n]) => [w, (n / members.length) * Math.log(L / (df.get(w) ?? 1))]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  const top = [...members].sort((a, b) => citedBy[b] - citedBy[a]).slice(0, 14).map((m) => title[m]);
  return { id, level, size: members.length, x: cx, y: cy, radius: rr, terms, topics: [...tps].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t), examples: top, name: null };
});
// Citations between regions, for the zoomed-out view.
const pair = new Map();
for (let e = 0; e < E; e++) {
  const a = level1[citeA[e]], b = level1[citeB[e]];
  if (a < 0 || b < 0 || a === b) continue;
  const k = a < b ? a * 65536 + b : b * 65536 + a;
  pair.set(k, (pair.get(k) ?? 0) + 1);
}
const bundles = [...pair].sort((p, q) => q[1] - p[1]).slice(0, 300).map(([k, w]) => [Math.floor(k / 65536), k % 65536, w]);

// Citations as compressed rows (who each linked record cites), for neighbourhoods and the links drawn closer in.
const offsets = new Uint32Array(L + 1);
for (let e = 0; e < E; e++) offsets[citeA[e] + 1]++;
for (let i = 0; i < L; i++) offsets[i + 1] += offsets[i];
const targets = new Uint32Array(E), fill = offsets.slice(0, L);
for (let e = 0; e < E; e++) targets[fill[citeA[e]]++] = citeB[e];

// Labels, by priority: every corpus paper, then the most cited library records and outside papers.
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
function labelOf(i) {
  const entry = evidence.get(i);
  if (i < L2) {
    const n = authorsAll[i], who = author[i] ? `${author[i]}${n > 1 ? " et al." : ""}` : "Unknown author";
    return [who, year[i] || null, short(title[i] || "Untitled", 160)];
  }
  const m = entry.bib.match(/^(.*?)\((\d{4})[a-z]?\)\.\s*(.*?)(?:\.\s|$)/);
  const first = m ? m[1].split(",")[0].trim() : "";
  const many = m ? (m[1].match(/,/g) ?? []).length > 1 : false;
  return [first ? `${first}${many ? " et al." : ""}` : "Unknown author", m ? Number(m[2]) : null, short(m ? m[3] : entry.bib, 160)];
}
const weight = (i) => (evidence.get(i)?.in_corpus ? 1e6 : 0) + (i < L ? citedBy[i] : 0) + (evidence.get(i)?.cited_by?.length ?? 0) * 40;
const ranked = [...Array(N).keys()].filter((i) => evidence.has(i) || (i < L && citedBy[i] >= 6)).sort((a, b) => weight(b) - weight(a));
// Names for the map's labels; titles only for the evidence map's papers. A library record's title is looked up when it is needed.
const labels = ranked.map((i) => { const [who, y] = labelOf(i); return [i, who, y]; });
const titles = [...evidence.keys()].map((i) => [i, labelOf(i)[2]]);
const dois = [...unlinked, ...outsideIdx].map(([doi, i]) => [i, doi]);
// The chains list and the verdict counts, small enough for the server to put in the page itself.
const severityRank = (v) => (v === 7 ? 9 : v === 6 ? 8 : v === 5 ? 7 : v === 4 ? 6 : v === 3 ? 5 : v ? 1 : 0);
// Every meta-analysis and review in Björn's corpus: the ones he analysed first, by their checks, then the ones not analysed yet.
const analysedCount = (e) => e.analyses_these_papers?.length ?? 0;
const chains = [...evidence].filter(([, e]) => e.in_corpus && e.study_level >= 2)
  .sort(([a, ea], [b, eb]) => Number(analysedCount(eb) > 0) - Number(analysedCount(ea) > 0) || severityRank(verdict[b]) - severityRank(verdict[a]) || cites[b] - cites[a])
  .map(([i, e]) => { const [who, y, t] = labelOf(i); return { index: i, paper: i < L2 ? keys[i] : e.doi.toLowerCase(), who, year: y, title: t, verdict: verdict[i], outside: i >= L2, analyses: analysedCount(e) }; });
// What a library record's page says about it: its check, whether it has a chain to show, and for a meta-analysis Björn
// analysed, how its reference list splits into the studies it analysed (and how many of those the library holds) and the rest.
const inChain = new Set(); for (let k = 0; k < evidenceLinks.length; k += 3) if (evidenceLinks[k + 2] === 1) { inChain.add(evidenceLinks[k]); inChain.add(evidenceLinks[k + 1]); }
const records = {};
for (const [i, e] of evidence) {
  if (i >= L2 || !(e.in_corpus || inChain.has(i))) continue;
  const analysed = (e.analyses_these_papers ?? []).map(pointOf);
  records[keys[i]] = {
    verdict: verdict[i], chain: inChain.has(i),
    ...(analysed.length && { analysed: analysed.length, analysedHere: analysed.filter((j) => j !== undefined && j < L2).length, reviews: e.also_cites_reviews?.length ?? 0, other: e.also_cites_other?.length ?? 0 }),
  };
}
// Only papers drawn on the map are counted, so a switch lights as many as it says: a methods reference or a paper joined to
// nothing on the map has no place there.
// The evidence map's papers by type and check, for the switches' counts: methods references and strays are left out.
const checks = {};
for (let i = 0; i < N; i++) if ((kind[i] || verdict[i]) && !(flags[i] & 48)) { const byVerdict = (checks[kind[i]] ??= {}); byVerdict[verdict[i]] = (byVerdict[verdict[i]] ?? 0) + 1; }

// Write: one binary file of columns, all little-endian, each 4-byte aligned.
// Positions to 1/16 of a space unit, in 16 bits: half the bytes of floats, and far below what a screen can show.
const QUANT = 16;
const fixed = new Uint16Array(positions.length);
for (let k = 0; k < positions.length; k++) fixed[k] = Math.max(0, Math.min(65535, Math.round(positions[k] * QUANT)));
const columns = [["x_y", fixed], ["year", years], ["cites", cites], ["region", region], ["area", area], ["kind", kind], ["verdict", verdict], ["flags", flags]];
const parts = [], layout = {}; let offset = 0;
for (const [name, arr] of columns) { const pad = (4 - (offset % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; } layout[name] = { offset, type: arr.constructor.name, length: arr.length }; parts.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); offset += arr.byteLength; }
// Binary files go out gzipped and are unpacked in the browser: servers rarely compress a binary type on their own.
const gz = (buffer) => zlib.gzipSync(buffer, { level: 9 });
for (const f of ["points.bin", "citations.bin", "evidence-links.bin"]) fs.rmSync(`${OUT}/${f}`, { force: true });
fs.writeFileSync(`${OUT}/points.bin.gz`, gz(Buffer.concat(parts)));
// Each row sorted and stored as gaps from the one before: small numbers that compress far better than raw indices.
const gaps = new Uint32Array(E);
for (let i = 0; i < L; i++) {
  const row = targets.subarray(offsets[i], offsets[i + 1]).sort();
  for (let k = 0; k < row.length; k++) gaps[offsets[i] + k] = k ? row[k] - row[k - 1] : row[k];
}
// Row lengths, then the gaps, each as a variable-length number: seven bits a byte, the high bit saying another byte follows.
const bytes = [];
const varint = (v) => { while (v >= 128) { bytes.push((v & 127) | 128); v >>>= 7; } bytes.push(v); };
for (let i = 0; i < L; i++) varint(offsets[i + 1] - offsets[i]);
for (let k = 0; k < E; k++) varint(gaps[k]);
fs.writeFileSync(`${OUT}/citations.bin.gz`, gz(Buffer.from(Uint8Array.from(bytes))));
fs.writeFileSync(`${OUT}/evidence-links.bin.gz`, gz(Buffer.from(new Uint32Array(evidenceLinks).buffer)));
fs.writeFileSync(`${OUT}/keys.txt`, keys.join(""));
fs.writeFileSync(`${OUT}/labels.json`, JSON.stringify(labels));
fs.writeFileSync(`${OUT}/titles.json`, JSON.stringify(titles));
fs.writeFileSync(`${OUT}/dois.json`, JSON.stringify(dois));
fs.writeFileSync(`${OUT}/chains.json`, JSON.stringify(chains));
// The record page reads this at build time, so its counts are there in the first paint: next to the app, not in public/.
fs.writeFileSync(new URL("../../src/components/pages/evidence/records.json", import.meta.url), JSON.stringify({ host: LIBRARY, records }));
fs.writeFileSync(`${OUT}/places-raw.json`, JSON.stringify(places));
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ host: LIBRARY, linked: L, library: L2, points: N, citations: E, space: SPACE, quant: QUANT, checks, layout, bundles, evidenceLinks: evidenceLinks.length / 3, built: new Date().toISOString() }));
for (const f of fs.readdirSync(OUT)) log(f, (fs.statSync(`${OUT}/${f}`).size / 1e6).toFixed(2), "MB");
log("regions", places.filter((p) => p.level === 1).slice(0, 10).map((p) => `${p.terms.slice(0, 3).join("/")} (${p.size})`).join(" | "));
