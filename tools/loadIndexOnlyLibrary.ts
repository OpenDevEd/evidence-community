/**
 * Builds an index-only library's Elasticsearch index from gzipped JSON lines of OpenAlex works, with no API and no
 * database (docs/search-indexing.md). Run in the library's network, with its LIBRARY_CONFIG_PATH:
 *
 *   npm run search:load-index-only -- --prepare --shards 4
 *   npm run search:load-index-only -- --links --files <folder> --state <folder>
 *   npm run search:load-index-only -- --part 0/8 --files <folder> --state <folder>   (one process per part)
 *   npm run search:load-index-only -- --finish --files <folder> --state <folder>
 *
 * Links finds which works cite each other across all the files, once. A part prints its progress, skips the files it has finished, reports works it couldn't use, and exits non-zero when
 * a file or record didn't load: run it again. `--limit` stops a part after that many works, to measure a load. Finish
 * refuses until every file has loaded, and names the index readers left, which stays until a person deletes it.
 */
import { parseArgs } from "node:util";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { loadSearchFor, runLoadStep } from "../src/lib/search-index/index-only-load";

const { values } = parseArgs({
	options: {
		prepare: { type: "boolean" },
		links: { type: "boolean" },
		finish: { type: "boolean" },
		part: { type: "string", default: "" },
		files: { type: "string", default: "" },
		state: { type: "string", default: "" },
		shards: { type: "string", default: "1" },
		limit: { type: "string", default: "Infinity" },
	},
});

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.abort());

async function main() {
	const { config, close } = await openLibraryConfigProcess();
	const search = loadSearchFor(config);
	const result = await runLoadStep(search, { ...values, signal: stop.signal });
	console.log(JSON.stringify(result));
	process.exitCode = result.complete ? 0 : 1;
	await search.client.close();
	close();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
