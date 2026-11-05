import { Client, type estypes } from "@elastic/elasticsearch";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { SearchService } from "@/lib/elasticsearch-factory";
import { newSearchIndexName, searchIndexDefinition } from "./elasticsearch-index";
import { checkBulkItems, mergeSegments } from "./elasticsearch-writer";
import { isIndexOnly } from "./index-only";
import { documentFromWork } from "./index-only-document";
import { dataFiles, fileLines } from "./index-only-files";
import { buildLinks, openLinks } from "./index-only-links";
import { SearchIndexDocumentError } from "./writer";

const BATCH = 1_000;
const IN_FLIGHT = 3;
const REPORT_EVERY = 100_000;
const SOURCE = "server-files";
const MAX_CITERS = 2_000_000;

export type LoadSearch = SearchService;
export type LoadFiles = { files: string; state: string };
type FinishOptions = LoadFiles & { acceptRefused?: boolean };
export type LoadOptions = LoadFiles & { part: string; limit?: number; signal?: AbortSignal };
type LoadStep = FinishOptions & { prepare?: boolean; links?: boolean; finish?: boolean; shards: string; part: string; limit: string; signal: AbortSignal };

/** The library's login, for a load: a full bulk request may take longer than a reader's search is allowed. */
export function loadSearchFor(config: LibraryServerConfig): LoadSearch {
	const connection = config.services.search.elasticsearch;
	if (!isIndexOnly(config) || !connection) throw new Error("This library isn't index-only");
	const auth = { username: connection.index, password: connection.key };
	return { alias: connection.index, client: new Client({ node: connection.host, auth, requestTimeout: 300_000, maxRetries: 5 }) };
}

/** The index being loaded: the newest behind the login, whether or not the alias reaches it yet. */
async function target({ alias, client }: LoadSearch) {
	const newest = Object.keys(await client.indices.get({ index: `${alias}_*` })).sort().at(-1);
	if (!newest) throw new Error("No index to load: run --prepare first");
	return newest;
}

/**
 * Creates the index a load fills, with refresh off until it is full. It says it holds the only copy of the records,
 * so the search worker leaves it alone even for a configuration that has lost `indexOnly`.
 */
export async function prepareIndex({ alias, client }: LoadSearch, shards: number) {
	const { settings, mappings } = searchIndexDefinition();
	const index = newSearchIndexName(alias);
	await client.indices.create({
		index,
		// A record's citers are read in one query, and the most cited record of a large library can have far more than the
		// 65,536 Elasticsearch allows by default.
		settings: { ...settings, index: { ...settings.index, number_of_shards: shards, refresh_interval: "-1", max_terms_count: MAX_CITERS } } as estypes.IndicesIndexSettings,
		// Nothing searches a record's links, and a large library holds hundreds of millions of them.
		mappings: {
			...mappings,
			_meta: { ...mappings._meta, indexOnly: true },
			properties: { ...mappings.properties, links: { type: "object", enabled: false } },
		} as estypes.MappingTypeMapping,
	});
	return { prepared: index };
}

const markerOf = (markers: string, file: string) => join(markers, `${file}.done`);

/** What every file's load counted. It throws unless each of them finished loading into this index. */
function readLoadedFiles(files: string, markers: string) {
	const names = dataFiles(files);
	const missing = names.filter((name) => !existsSync(markerOf(markers, name)));
	if (names.length === 0 || missing.length > 0) {
		throw new Error(`${missing.length} of ${names.length} files aren't loaded into this index: ${missing.slice(0, 5).join(", ")}`);
	}
	const total = { works: 0, refused: 0, failed: 0 };
	for (const name of names) {
		const loaded = JSON.parse(readFileSync(markerOf(markers, name), "utf8")) as typeof total;
		total.works += loaded.works;
		total.refused += loaded.refused;
		total.failed += loaded.failed;
	}
	return total;
}

/**
 * Turns refresh on and moves the library's alias to the loaded index, once every file has loaded into it. Records that
 * didn't load hold it back until a person accepts them: running a part again skips their file, so it can't bring them
 * back. The index readers leave stays, and its name comes back, for a person to delete after checking the new one.
 */
export async function finishIndex(search: LoadSearch, { files, state, acceptRefused }: FinishOptions) {
	const { alias, client } = search;
	const index = await target(search);
	const loaded = readLoadedFiles(files, join(state, index));
	const lost = loaded.refused + loaded.failed;
	if (lost > 0 && !acceptRefused) throw new Error(`${lost} records didn't load: check the parts' reports, then finish with --accept-refused`);
	await client.indices.putSettings({ index, settings: { index: { refresh_interval: "1s" } } });
	await client.indices.refresh({ index });
	const { count: records } = await client.count({ index });
	if (records === 0) throw new Error(`${index} holds no records`);
	const live = (await client.indices.exists({ index: alias })) ? Object.keys(await client.indices.get({ index: alias })) : [];
	const replaced = live.filter((name) => name !== index);
	await client.indices.updateAliases({
		actions: [...replaced.map((name) => ({ remove: { index: name, alias } })), { add: { index, alias, is_write_index: true } }],
	});
	await mergeSegments(search, index);
	return { finished: index, records, ...loaded, repeated: loaded.works - loaded.failed - records, replaced };
}

type Tally = { works: number; refused: number; failed: number; damaged: string[]; reasons: Map<string, { records: number; first: string }> };

function note(tally: Tally, reason: string, record: string) {
	const seen = tally.reasons.get(reason);
	if (seen) seen.records++;
	else tally.reasons.set(reason, { records: 1, first: record });
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Counts the records Elasticsearch refused. An overload or server error throws: the part has to stop and run again. */
function noteRefused(items: Parameters<typeof checkBulkItems>[0], tally: Tally) {
	try {
		checkBulkItems(items);
	} catch (error) {
		if (!(error instanceof SearchIndexDocumentError)) throw error;
		tally.failed += error.failures.length;
		for (const { key, reason } of error.failures) note(tally, `index: ${reason.slice(0, 80)}`, key);
	}
}

/** Bulk writes, a few at a time; a write waits only when as many as that are running. The first failure stops the part. */
function createWriter({ client }: LoadSearch, index: string, tally: Tally) {
	const writes = new Set<Promise<void>>();
	let failure: Error | undefined;
	const throwFailure = () => {
		if (failure) throw failure;
	};
	return {
		throwFailure,
		async write(operations: object[]) {
			throwFailure();
			const task = client
				.bulk({ index, operations, refresh: false })
				.then(({ items }) => noteRefused(items as Parameters<typeof checkBulkItems>[0], tally))
				.catch((error: unknown) => {
					failure ??= error instanceof Error ? error : new Error(String(error));
				});
			const held = task.finally(() => writes.delete(held));
			writes.add(held);
			if (writes.size >= IN_FLIGHT) await Promise.race(writes);
			throwFailure();
		},
		async drain() {
			await Promise.all(writes);
			throwFailure();
		},
	};
}

function createProgress(part: string, tally: Tally) {
	const started = Date.now();
	let next = REPORT_EVERY;
	const print = () => {
		const seconds = (Date.now() - started) / 1000;
		const { works, refused, failed } = tally;
		console.log(JSON.stringify({ part, works, refused, failed, perSecond: Math.round(works / seconds), minutes: Math.round(seconds / 6) / 10 }));
	};
	return {
		print,
		tick() {
			if (tally.works < next) return;
			next += REPORT_EVERY;
			print();
		},
	};
}

type Run = {
	limit: number;
	loadedAt: Date;
	linksOf: ReturnType<typeof openLinks>;
	tally: Tally;
	writer: ReturnType<typeof createWriter>;
	progress: ReturnType<typeof createProgress>;
	signal?: AbortSignal;
};

type FileWork = { id?: unknown; referenced_works?: unknown[] | null; referenced_works_count?: number | null };

/** Some files list a work's references without counting them. */
function withReferenceCount(work: FileWork) {
	const count = work.referenced_works_count ?? work.referenced_works?.length;
	return count === undefined ? work : { ...work, referenced_works_count: count };
}

function operationsFor(line: string, file: string, { linksOf, loadedAt, tally }: Run) {
	let record = "a line that isn't JSON";
	try {
		const work = JSON.parse(line) as FileWork;
		record = String(work.id);
		const document = documentFromWork(withReferenceCount(work), { sourceConnectionKey: SOURCE, loadedAt, links: linksOf(work) });
		tally.works++;
		return [{ index: { _id: document.key } }, document];
	} catch (error) {
		tally.refused++;
		note(tally, messageOf(error).slice(0, 80), `${file}: ${record}`);
		return [];
	}
}

/** Loads one file and says whether it reached the file's end, not a limit or a stop. */
async function loadFile(folder: string, file: string, run: Run) {
	const { limit, signal, tally, writer, progress } = run;
	const stopped = () => tally.works >= limit || signal?.aborted === true;
	let batch: object[] = [];
	for await (const line of fileLines(join(folder, file))) {
		if (stopped()) break;
		batch.push(...operationsFor(line, file, run));
		if (batch.length < BATCH * 2) continue;
		await writer.write(batch);
		batch = [];
		progress.tick();
	}
	if (batch.length) await writer.write(batch);
	await writer.drain();
	return !stopped();
}

function myFiles(folder: string, part: string) {
	const [mine = 0, parts = 0] = part.split("/").map(Number);
	if (!/^\d+\/\d+$/.test(part) || mine >= parts) throw new Error("A part is written <i>/<n>, with i from 0 to n-1");
	return dataFiles(folder).filter((_, position) => position % parts === mine);
}

/**
 * Loads one part's files into the index being loaded, skipping those it has already finished. A damaged file doesn't
 * stop the others, and a failed write stops the part; neither file counts as finished, so running the part again
 * tries it again.
 */
export async function loadPart(search: LoadSearch, { part, files, state, limit = Infinity, signal }: LoadOptions) {
	const mine = myFiles(files, part);
	const index = await target(search);
	const markers = join(state, index);
	mkdirSync(markers, { recursive: true });
	const tally: Tally = { works: 0, refused: 0, failed: 0, damaged: [], reasons: new Map() };
	const writer = createWriter(search, index, tally);
	const progress = createProgress(part, tally);
	const run = { limit, linksOf: openLinks(state, files), loadedAt: new Date(), tally, writer, progress, signal };
	for (const file of mine.filter((name) => !existsSync(markerOf(markers, name)))) {
		const { works, refused, failed } = tally;
		try {
			if (!(await loadFile(files, file, run))) break;
			writeFileSync(markerOf(markers, file), JSON.stringify({ works: tally.works - works, refused: tally.refused - refused, failed: tally.failed - failed }));
		} catch (error) {
			writer.throwFailure();
			tally.damaged.push(`${file}: ${messageOf(error)}`);
		}
	}
	progress.print();
	const reasons = [...tally.reasons].sort((a, b) => b[1].records - a[1].records).slice(0, 10);
	const complete = tally.failed === 0 && tally.damaged.length === 0 && !signal?.aborted;
	return { ...tally, reasons: Object.fromEntries(reasons), complete };
}

/** Runs the step the command line named; `complete` is false when a person has to look at the result. */
export async function runLoadStep(search: LoadSearch, step: LoadStep) {
	const { acceptRefused, files, part, state, signal } = step;
	if (step.prepare) return { ...(await prepareIndex(search, Number(step.shards))), complete: true };
	if (!files || !state) throw new Error("--links, --part and --finish need --files and --state");
	if (step.links) return buildLinks(files, state, signal);
	if (step.finish) return { ...(await finishIndex(search, { files, state, acceptRefused })), complete: true };
	return loadPart(search, { part, files, state, limit: Number(step.limit), signal });
}
