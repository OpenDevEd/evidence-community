import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";

/** The gzipped JSON lines files of a load, always in the same order. */
export function dataFiles(folder: string) {
	return readdirSync(folder)
		.filter((name) => name.endsWith(".jsonl.gz"))
		.sort();
}

/** A file's lines. Node's readline also ends a line at U+2028 and U+2029, which a record's text can hold. */
export async function* linesOf(stream: AsyncIterable<Buffer>) {
	let rest = "";
	const decoder = new TextDecoder();
	for await (const chunk of stream) {
		const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
		rest = lines.pop() ?? "";
		yield* lines;
	}
	if (rest) yield rest;
}

export function fileLines(path: string) {
	return linesOf(pipeline(createReadStream(path), createGunzip(), () => {}));
}
