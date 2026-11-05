import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import type { ItemLinks } from "@/app/api/item/types";
import { dataFiles, fileLines } from "./index-only-files";
import { indexOnlyKey } from "./index-only-document";

type Work = { id?: unknown; referenced_works?: unknown };

/** Node writes at most 2 GiB in one call. */
const WRITE_CHUNK = 1 << 30;

const workNumber = (id: unknown) => Number(/\/?W(\d+)$/u.exec(String(id))?.[1] ?? Number.NaN);
const referencesOf = ({ referenced_works: references }: Work): unknown[] => (Array.isArray(references) ? references : []);

/** A list of numbers too long for a plain array or Set: a library can hold tens of millions of works. */
function createNumbers() {
	let values = new Float64Array(1 << 16);
	let length = 0;
	return {
		push(value: number) {
			if (length === values.length) {
				const larger = new Float64Array(length * 2);
				larger.set(values);
				values = larger;
			}
			values[length++] = value;
		},
		size: () => length,
		all: () => values.subarray(0, length),
	};
}

function parsedWork(line: string): Work | null {
	try {
		return JSON.parse(line) as Work;
	} catch {
		return null;
	}
}

/** Where `id` sits in the sorted `ids`, or -1 for a work outside the library. */
function slotOf(ids: Float64Array, id: number) {
	let low = 0;
	let high = ids.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const value = ids[middle]!;
		if (value === id) return middle;
		if (value < id) low = middle + 1;
		else high = middle - 1;
	}
	return -1;
}

function uniqueSortedIds(works: Float64Array) {
	const sorted = works.slice().sort();
	let length = 0;
	for (const id of sorted) if (length === 0 || sorted[length - 1] !== id) sorted[length++] = id;
	return sorted.slice(0, length);
}

const linksFolder = (state: string) => join(state, "links");
const fingerprint = (files: string) => dataFiles(files).map((name) => `${name} ${statSync(join(files, name)).size}`).join("\n");

function writeNumbers(path: string, numbers: Float64Array | Uint32Array) {
	const bytes = new Uint8Array(numbers.buffer, numbers.byteOffset, numbers.byteLength);
	const file = openSync(path, "w");
	for (let written = 0; written < bytes.length; ) written += writeSync(file, bytes, written, Math.min(WRITE_CHUNK, bytes.length - written));
	closeSync(file);
}

/** Replaces the links in one step, so a stopped run leaves the last ones whole. */
function writeLinks(state: string, files: string, ids: Float64Array, starts: Uint32Array, citers: Uint32Array) {
	const folder = linksFolder(state);
	const fresh = `${folder}.new`;
	rmSync(fresh, { recursive: true, force: true });
	mkdirSync(fresh, { recursive: true });
	writeNumbers(join(fresh, "ids.bin"), ids);
	writeNumbers(join(fresh, "starts.bin"), starts);
	writeNumbers(join(fresh, "citers.bin"), citers);
	writeFileSync(join(fresh, "files.txt"), fingerprint(files));
	rmSync(folder, { recursive: true, force: true });
	renameSync(fresh, folder);
}

type Found = Record<"works" | "ends" | "references", ReturnType<typeof createNumbers>>;

async function readFile(path: string, { works, ends, references }: Found) {
	for await (const line of fileLines(path)) {
		const work = parsedWork(line);
		const id = workNumber(work?.id);
		if (!work || Number.isNaN(id)) continue;
		works.push(id);
		for (const reference of referencesOf(work)) references.push(workNumber(reference));
		ends.push(references.size());
	}
}

/**
 * Finds which works of the files cite each other, once for every part of a load: a part sees only its own files, and a
 * work's citations are in the others. It keeps, for each work, the works in the library that cite it. A damaged file
 * doesn't stop the others; it is named, and `complete` is false.
 */
export async function buildLinks(files: string, state: string, signal?: AbortSignal) {
	const found = { works: createNumbers(), ends: createNumbers(), references: createNumbers() };
	const damaged: string[] = [];
	for (const file of dataFiles(files)) {
		if (signal?.aborted) throw new Error("Stopped before the links were written");
		await readFile(join(files, file), found).catch((error: unknown) => damaged.push(`${file}: ${error instanceof Error ? error.message : String(error)}`));
		console.log(JSON.stringify({ read: file, works: found.works.size(), references: found.references.size() }));
	}
	const [citing, lastReference, cited] = [found.works.all(), found.ends.all(), found.references.all()];
	const ids = uniqueSortedIds(citing);
	const eachLink = (visit: (citer: number, target: number) => void) => {
		let position = 0;
		citing.forEach((id, work) => {
			const citer = slotOf(ids, id);
			for (const end = lastReference[work]!; position < end; position++) {
				const target = slotOf(ids, cited[position]!);
				if (target >= 0 && target !== citer) visit(citer, target);
			}
		});
	};
	const starts = new Uint32Array(ids.length + 1);
	eachLink((_, target) => starts[target + 1]!++);
	let mostCited = 0;
	for (let slot = 0; slot < ids.length; slot++) {
		mostCited = Math.max(mostCited, starts[slot + 1]!);
		starts[slot + 1]! += starts[slot]!;
	}
	const next = starts.slice();
	const citers = new Uint32Array(starts[ids.length]!);
	eachLink((citer, target) => {
		citers[next[target]!++] = citer;
	});
	writeLinks(state, files, ids, starts, citers);
	return { works: ids.length, links: citers.length, mostCited, damaged, complete: damaged.length === 0 };
}

function readNumbers<T>(path: string, Numbers: new (buffer: ArrayBuffer) => T) {
	const bytes = readFileSync(path);
	return new Numbers(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** What `buildLinks` found, as a work's links to other records of the library. */
export function openLinks(state: string, files: string) {
	const folder = linksFolder(state);
	if (!existsSync(join(folder, "files.txt"))) throw new Error("No links to load: run --links first");
	if (readFileSync(join(folder, "files.txt"), "utf8") !== fingerprint(files)) throw new Error("The files changed after their links were found: run --links again");
	const ids = readNumbers(join(folder, "ids.bin"), Float64Array);
	const starts = readNumbers(join(folder, "starts.bin"), Uint32Array);
	if (starts.length !== ids.length + 1 || statSync(join(folder, "citers.bin")).size !== starts[ids.length]! * 4) {
		throw new Error("The links are damaged: run --links again");
	}
	const citers = openSync(join(folder, "citers.bin"), "r");
	const citedBy = (slot: number) => {
		const count = slot < 0 ? 0 : starts[slot + 1]! - starts[slot]!;
		if (count === 0) return [];
		const slots = new Uint32Array(count);
		if (readSync(citers, new Uint8Array(slots.buffer), 0, count * 4, starts[slot]! * 4) !== count * 4) throw new Error("The links are damaged: run --links again");
		return [...new Set(slots)].map((citer) => indexOnlyKey(ids[citer]!));
	};
	return (work: Work): ItemLinks => {
		const held = referencesOf(work).map(workNumber).filter((id) => slotOf(ids, id) >= 0 && id !== workNumber(work.id));
		return { cites: [...new Set(held)].map(indexOnlyKey), citedBy: citedBy(slotOf(ids, workNumber(work.id))), related: [] };
	};
}
