import { existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ItemLinks } from "@/app/api/item/types";
import { dataFiles, fileLines } from "./index-only-files";
import { indexOnlyKey } from "./index-only-document";

type Work = { id?: unknown; referenced_works?: unknown };

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

const bytesOf = (numbers: Float64Array | Uint32Array) => new Uint8Array(numbers.buffer, numbers.byteOffset, numbers.byteLength);
const linksFolder = (state: string) => join(state, "links");

/**
 * Finds which works of the files cite each other, once for every part of a load: a part sees only its own files, and a
 * work's citations are in the others. It keeps, for each work, the works in the library that cite it.
 */
export async function buildLinks(files: string, state: string) {
	const works = createNumbers();
	const ends = createNumbers();
	const references = createNumbers();
	for (const file of dataFiles(files)) {
		for await (const line of fileLines(join(files, file))) {
			const work = parsedWork(line);
			const id = workNumber(work?.id);
			if (!work || Number.isNaN(id)) continue;
			works.push(id);
			for (const reference of referencesOf(work)) references.push(workNumber(reference));
			ends.push(references.size());
		}
	}
	const [citing, lastReference, cited] = [works.all(), ends.all(), references.all()];
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
	for (let slot = 0; slot < ids.length; slot++) starts[slot + 1]! += starts[slot]!;
	const next = starts.slice();
	const citers = new Uint32Array(starts[ids.length]!);
	eachLink((citer, target) => {
		citers[next[target]!++] = citer;
	});
	mkdirSync(linksFolder(state), { recursive: true });
	writeFileSync(join(linksFolder(state), "ids.bin"), bytesOf(ids));
	writeFileSync(join(linksFolder(state), "starts.bin"), bytesOf(starts));
	writeFileSync(join(linksFolder(state), "citers.bin"), bytesOf(citers));
	return { works: ids.length, links: citers.length };
}

function readNumbers<T>(path: string, Numbers: new (buffer: ArrayBuffer) => T) {
	const bytes = readFileSync(path);
	return new Numbers(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** What `buildLinks` found, as a work's links to other records of the library. */
export function openLinks(state: string) {
	const folder = linksFolder(state);
	if (!existsSync(join(folder, "ids.bin"))) throw new Error("No links to load: run --links first");
	const ids = readNumbers(join(folder, "ids.bin"), Float64Array);
	const starts = readNumbers(join(folder, "starts.bin"), Uint32Array);
	const citers = openSync(join(folder, "citers.bin"), "r");
	const citedBy = (slot: number) => {
		const count = slot < 0 ? 0 : starts[slot + 1]! - starts[slot]!;
		if (count === 0) return [];
		const slots = new Uint32Array(count);
		readSync(citers, new Uint8Array(slots.buffer), 0, count * 4, starts[slot]! * 4);
		return [...new Set(slots)].map((citer) => indexOnlyKey(ids[citer]!));
	};
	return (work: Work): ItemLinks => {
		const held = referencesOf(work).map(workNumber).filter((id) => slotOf(ids, id) >= 0 && id !== workNumber(work.id));
		return { cites: [...new Set(held)].map(indexOnlyKey), citedBy: citedBy(slotOf(ids, workNumber(work.id))), related: [] };
	};
}
