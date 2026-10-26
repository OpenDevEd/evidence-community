/**
 * Switches a real library from one search engine to the other and back (OpenDevEd/new-el#722), checking what readers
 * see. While the search worker builds the new engine's index, a reader counts the library's public results every
 * 250 ms through the code readers use; the count must never drop below the public records PostgreSQL holds. Then
 * readers must search the new engine, and the old engine's index must be gone.
 *
 *   LIBRARY_CONFIG_PATH=<a library with both engines' connections> npm run test:search-switch
 *
 * The library starts on the engine its configuration names, which the worker builds first if it has to.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { libraryConfigSchema, type LibraryServerConfig, type SearchEngineName } from "../src/config/library-config/schema";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { readPublicLibraryStatus } from "../src/lib/library-export-records";
import { publicRecordFilters } from "../src/lib/search";
import { getSearchEngine } from "../src/lib/search-engines";
import { readSearchEngine } from "../src/lib/search-index/bootstrap-state";

/** Longer than readers trust the live engine they read (live-engine.ts). */
const READER_CACHE_MS = 6_000;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Runs the search worker once with `config`, rebuilding or switching as it finds. */
async function runWorker(directory: string, config: LibraryServerConfig) {
	const configPath = path.join(directory, `${config.services.search.engine}.json`);
	await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
	const worker = spawn("npx", ["tsx", "--conditions=react-server", "tools/runSearchIndexer.ts"], {
		env: { ...process.env, LIBRARY_CONFIG_PATH: configPath },
		stdio: ["ignore", "pipe", "inherit"],
	});
	let output = "";
	worker.stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const code = await new Promise<number | null>((resolve) => worker.on("close", resolve));
	assert(code === 0, `The search worker exited with ${code}: ${output.slice(-2_000)}`);
	return output;
}

async function publicResults(config: LibraryServerConfig) {
	const engine = await getSearchEngine(config);
	const { total } = await engine.search({ text: "", fields: [], filters: publicRecordFilters(config.content.tags.hidden), size: 0 });
	return { engine: engine.name, total };
}

/** Switches the library to `to` while a reader counts results; returns what the reader saw. */
async function switchTo(directory: string, base: LibraryServerConfig, to: SearchEngineName, records: number) {
	const config = { ...base, services: { ...base.services, search: { ...base.services.search, engine: to } } };
	const seen = { lowest: Number.POSITIVE_INFINITY, engines: new Set<string>(), reads: 0 };
	let switching = true;
	const reader = (async () => {
		while (switching) {
			const { engine, total } = await publicResults(config);
			seen.engines.add(engine);
			seen.lowest = Math.min(seen.lowest, total);
			seen.reads += 1;
			await delay(250);
		}
	})();
	const started = Date.now();
	let output = "";
	try {
		output = await runWorker(directory, config);
	} finally {
		switching = false;
		await reader;
	}
	const seconds = Math.round((Date.now() - started) / 1_000);
	await delay(READER_CACHE_MS);
	const after = await publicResults(config);
	assert(seen.lowest >= records, `Readers saw ${seen.lowest} results during the switch to ${to}; PostgreSQL holds ${records} public records`);
	assert(after.engine === to && after.total === records, `After the switch readers searched ${after.engine} and found ${after.total} of ${records}`);
	const switched = output
		.split("\n")
		.flatMap((line) => (line.startsWith("{") ? [JSON.parse(line) as { switchedFrom?: string; oldIndexRemoved?: boolean }] : []))
		.find((line) => line.switchedFrom);
	assert(switched?.oldIndexRemoved === true, `The worker did not delete the old engine's index: ${output.slice(-1_000)}`);
	return { to, seconds, readerChecks: seen.reads, enginesReadersSaw: [...seen.engines], lowestCount: seen.lowest };
}

/** The library to switch, which needs both engines' connections. */
async function libraryToSwitch() {
	const configPath = process.env.LIBRARY_CONFIG_PATH;
	assert(configPath, "LIBRARY_CONFIG_PATH is required");
	const config = libraryConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
	const { elasticsearch, meilisearch } = config.services.search;
	assert(elasticsearch && meilisearch, "The library needs both engines' connections");
	return config;
}

async function publicRecords(database: Parameters<typeof readPublicLibraryStatus>[0], config: LibraryServerConfig) {
	const records = Number((await readPublicLibraryStatus(database, config))?.totalItems ?? 0);
	assert(records > 0, "The library has no public records to search");
	return records;
}

async function verify() {
	const config = await libraryToSwitch();
	const from = config.services.search.engine;
	const to: SearchEngineName = from === "elasticsearch" ? "meilisearch" : "elasticsearch";
	const resource = createPostgresDatabaseResource(config.services.database.url, 2);
	const directory = await mkdtemp(path.join(tmpdir(), "search-switch-"));
	try {
		const records = await publicRecords(resource.database, config);
		// Start on the configured engine, built if it has to be.
		await runWorker(directory, config);
		assert((await readSearchEngine(resource.database)) === from, `The library did not start on ${from}`);
		const there = await switchTo(directory, config, to, records);
		const back = await switchTo(directory, config, from, records);
		console.log(JSON.stringify({ records, switches: [there, back] }));
	} finally {
		await rm(directory, { recursive: true, force: true });
		await resource.dispose();
	}
}

verify().then(
	() => process.exit(0),
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
