/**
 * Builds an index-only library's Elasticsearch index from gzipped JSON lines of OpenAlex works, with no API and no
 * database (docs/search-indexing.md). Run in the library's network, with its LIBRARY_CONFIG_PATH:
 *
 *   npm run search:load-index-only -- --prepare --shards 4
 *   npm run search:load-index-only -- --part 0/8 --files <folder> --state <folder>   (one process per part)
 *   npm run search:load-index-only -- --finish
 *
 * A part prints its progress, skips the files --state marks done, and reports works it couldn't use. `--limit` stops a
 * part after that many works, to measure a load.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";

import { Client } from "@elastic/elasticsearch";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { newSearchIndexName, searchIndexDefinition } from "../src/lib/search-index/elasticsearch-index";
import { isIndexOnly } from "../src/lib/search-index/index-only";
import { documentFromWork } from "../src/lib/search-index/index-only-document";

const BATCH = 1_000;
const IN_FLIGHT = 3;
const SOURCE = "server-files";

const { values } = parseArgs({
	options: {
		prepare: { type: "boolean" },
		finish: { type: "boolean" },
		part: { type: "string" },
		files: { type: "string" },
		state: { type: "string" },
		shards: { type: "string", default: "1" },
		limit: { type: "string" },
	},
});

function connect(configuration: { host: string; index: string; key: string }) {
	const client = new Client({
		node: configuration.host,
		auth: { username: configuration.index, password: configuration.key },
		requestTimeout: 300_000,
		maxRetries: 5,
	});
	return { alias: configuration.index, client };
}
type Search = ReturnType<typeof connect>;

/** The index being loaded: the newest behind the login, whether or not the alias reaches it yet. */
async function target({ alias, client }: Search) {
	const indexes = Object.keys(await client.indices.get({ index: `${alias}_*` })).sort();
	const newest = indexes.at(-1);
	if (!newest) throw new Error("No index to load: run --prepare first");
	return newest;
}

async function prepare({ alias, client }: Search) {
	const { settings, mappings } = searchIndexDefinition();
	const index = newSearchIndexName(alias);
	await client.indices.create({
		index,
		settings: {
			...settings,
			index: { ...(settings as { index?: object }).index, number_of_shards: Number(values.shards), refresh_interval: "-1" },
		},
		mappings,
	} as Parameters<typeof client.indices.create>[0]);
	console.log(JSON.stringify({ prepared: index }));
}

async function finish({ alias, client }: Search) {
	const index = await target({ alias, client });
	await client.indices.putSettings({ index, settings: { index: { refresh_interval: "1s" } } });
	await client.indices.refresh({ index });
	const live = (await client.indices.exists({ index: alias }))
		? Object.keys(await client.indices.get({ index: alias }))
		: [];
	await client.indices.updateAliases({
		actions: [
			...live.filter((name) => name !== index).map((name) => ({ remove: { index: name, alias } })),
			{ add: { index, alias, is_write_index: true } },
		],
	});
	const { count } = await client.count({ index: alias });
	console.log(JSON.stringify({ finished: index, records: count }));
}

/** A file's lines. Node's readline also ends a line at U+2028 and U+2029, which a record's text can hold. */
async function* linesOf(stream: AsyncIterable<Buffer>) {
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
function createWriter(search: Search, index: string, tally: Tally) {
	const writes = new Set<Promise<void>>();
	const noteProblems = (items: { index?: { error?: { type: string } } }[]) => {
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

async function load(search: Search) {
	const [part, parts] = (values.part ?? "").split("/").map(Number);
	const { files: folder, state } = values;
	if (!folder || !state || part === undefined || !parts) throw new Error("A load needs --part <i>/<n>, --files and --state");
	mkdirSync(state, { recursive: true });
	const limit = values.limit ? Number(values.limit) : Infinity;
	const index = await target(search);
	const mine = readdirSync(folder)
		.filter((name) => name.endsWith(".jsonl.gz"))
		.sort()
		.filter((_, position) => position % parts === part);
	const loadedAt = new Date();
	const started = Date.now();
	const tally: Tally = { works: 0, refused: 0, failed: 0, reasons: new Map() };
	const writer = createWriter(search, index, tally);
	const report = () => {
		const seconds = (Date.now() - started) / 1000;
		const { works, refused, failed } = tally;
		console.log(JSON.stringify({ part, works, refused, failed, perSecond: Math.round(works / seconds), minutes: Math.round(seconds / 6) / 10 }));
	};
	for (const file of mine) {
		const done = join(state, `${file}.done`);
		if (existsSync(done)) continue;
		if (!(await loadFile(join(folder, file), limit, loadedAt, tally, writer, report))) break;
		writeFileSync(done, new Date().toISOString());
	}
	report();
	console.log(JSON.stringify({ part, reasons: Object.fromEntries([...tally.reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) }));
}

async function main() {
	const { config, close } = await openLibraryConfigProcess();
	try {
		const connection = config.services.search.elasticsearch;
		if (!isIndexOnly(config) || !connection) throw new Error("This library isn't index-only");
		const search = connect(connection);
		if (values.prepare) await prepare(search);
		else if (values.finish) await finish(search);
		else await load(search);
		await search.client.close();
	} finally {
		close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
