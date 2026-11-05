import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

import { newSearchIndexName, searchIndexDefinition } from "./elasticsearch-index";
import { documentFromWork } from "./index-only-document";

const BATCH = 1_000;
const IN_FLIGHT = 3;
const SOURCE = "server-files";

type BulkItem = { index?: { error?: { type: string } } };
type IndexClient = {
	bulk(request: { index: string; operations: object[]; refresh: boolean }): Promise<{ items: BulkItem[] }>;
	count(request: { index: string }): Promise<{ count: number }>;
	indices: {
		create(request: object): Promise<unknown>;
		exists(request: { index: string }): Promise<boolean>;
		get(request: { index: string }): Promise<Record<string, unknown>>;
		putSettings(request: object): Promise<unknown>;
		refresh(request: { index: string }): Promise<unknown>;
		updateAliases(request: object): Promise<unknown>;
	};
};
export type LoadSearch = { alias: string; client: IndexClient };
export type LoadOptions = { part: string; files: string; state: string; limit?: number };

/** The index being loaded: the newest behind the login, whether or not the alias reaches it yet. */
async function target({ alias, client }: LoadSearch) {
	const newest = Object.keys(await client.indices.get({ index: `${alias}_*` })).sort().at(-1);
	if (!newest) throw new Error("No index to load: run --prepare first");
	return newest;
}

/** Creates the index a load fills, with refresh off until it is full. */
export async function prepareIndex({ alias, client }: LoadSearch, shards: number) {
	const { settings, mappings } = searchIndexDefinition();
	const index = newSearchIndexName(alias);
	await client.indices.create({
		index,
		settings: { ...settings, index: { ...(settings as { index?: object }).index, number_of_shards: shards, refresh_interval: "-1" } },
		mappings,
	});
	return { prepared: index };
}

/** Turns refresh on and moves the library's alias to the loaded index. */
export async function finishIndex({ alias, client }: LoadSearch) {
	const index = await target({ alias, client });
	await client.indices.putSettings({ index, settings: { index: { refresh_interval: "1s" } } });
	await client.indices.refresh({ index });
	const live = (await client.indices.exists({ index: alias })) ? Object.keys(await client.indices.get({ index: alias })) : [];
	await client.indices.updateAliases({
		actions: [
			...live.filter((name) => name !== index).map((name) => ({ remove: { index: name, alias } })),
			{ add: { index, alias, is_write_index: true } },
		],
	});
	return { finished: index, records: (await client.count({ index: alias })).count };
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

type Tally = { works: number; refused: number; failed: number; reasons: Map<string, number> };

function count(tally: Tally, reason: string) {
	tally.reasons.set(reason, (tally.reasons.get(reason) ?? 0) + 1);
}

/** Bulk writes, a few at a time; a write waits only when as many as that are running. */
function createWriter(search: LoadSearch, index: string, tally: Tally) {
	const writes = new Set<Promise<void>>();
	const noteProblems = (items: BulkItem[]) => {
		for (const problem of items.flatMap((entry) => entry.index?.error ?? [])) {
			tally.failed++;
			count(tally, `index: ${problem.type}`);
		}
	};
	return {
		async write(operations: object[]) {
			const task = search.client.bulk({ index, operations, refresh: false }).then(({ items }) => noteProblems(items));
			const held = task.finally(() => writes.delete(held));
			writes.add(held);
			if (writes.size >= IN_FLIGHT) await Promise.race(writes);
		},
		drain: () => Promise.all(writes),
	};
}

function operationsFor(line: string, loadedAt: Date, tally: Tally) {
	try {
		const document = documentFromWork(JSON.parse(line), { sourceConnectionKey: SOURCE, loadedAt });
		tally.works++;
		return [{ index: { _id: document.key } }, document];
	} catch (error) {
		tally.refused++;
		count(tally, (error instanceof Error ? error.message : String(error)).slice(0, 80));
		return [];
	}
}

/** Loads one file, up to the part's limit, and says whether it reached the file's end. */
async function loadFile(path: string, limit: number, loadedAt: Date, tally: Tally, writer: ReturnType<typeof createWriter>, report: () => void) {
	let batch: object[] = [];
	for await (const line of linesOf(createReadStream(path).pipe(createGunzip()))) {
		if (tally.works >= limit) break;
		batch.push(...operationsFor(line, loadedAt, tally));
		if (batch.length < BATCH * 2) continue;
		await writer.write(batch);
		batch = [];
		if ((tally.works / BATCH) % 100 === 0) report();
	}
	if (batch.length) await writer.write(batch);
	await writer.drain();
	return tally.works < limit;
}

function myFiles(folder: string, part: string) {
	const [mine, parts] = part.split("/").map(Number);
	if (mine === undefined || !parts) throw new Error("A part is written <i>/<n>");
	return readdirSync(folder)
		.filter((name) => name.endsWith(".jsonl.gz"))
		.sort()
		.filter((_, position) => position % parts === mine);
}

/** Loads one part's files. It skips the files `state` marks done, and prints its progress. */
export async function loadPart(search: LoadSearch, { part, files, state, limit = Infinity }: LoadOptions) {
	const mine = myFiles(files, part);
	mkdirSync(state, { recursive: true });
	const loadedAt = new Date();
	const started = Date.now();
	const tally: Tally = { works: 0, refused: 0, failed: 0, reasons: new Map() };
	const writer = createWriter(search, await target(search), tally);
	const report = () => {
		const seconds = (Date.now() - started) / 1000;
		const { works, refused, failed } = tally;
		console.log(JSON.stringify({ part, works, refused, failed, perSecond: Math.round(works / seconds), minutes: Math.round(seconds / 6) / 10 }));
	};
	for (const file of mine.filter((name) => !existsSync(join(state, `${name}.done`)))) {
		if (!(await loadFile(join(files, file), limit, loadedAt, tally, writer, report))) break;
		writeFileSync(join(state, `${file}.done`), new Date().toISOString());
	}
	report();
	return { ...tally, reasons: Object.fromEntries([...tally.reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) };
}
