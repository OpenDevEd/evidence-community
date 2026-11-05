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
import { parseArgs } from "node:util";

import { Client } from "@elastic/elasticsearch";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { isIndexOnly } from "../src/lib/search-index/index-only";
import { finishIndex, loadPart, type LoadSearch, prepareIndex } from "../src/lib/search-index/index-only-load";

const { values } = parseArgs({
	options: {
		prepare: { type: "boolean" },
		finish: { type: "boolean" },
		part: { type: "string", default: "" },
		files: { type: "string", default: "" },
		state: { type: "string", default: "" },
		shards: { type: "string", default: "1" },
		limit: { type: "string", default: "Infinity" },
	},
});

function step(search: LoadSearch) {
	if (values.prepare) return prepareIndex(search, Number(values.shards));
	if (values.finish) return finishIndex(search);
	return loadPart(search, { part: values.part, files: values.files, state: values.state, limit: Number(values.limit) });
}

async function main() {
	const { config, close } = await openLibraryConfigProcess();
	const connection = config.services.search.elasticsearch;
	if (!isIndexOnly(config) || !connection) throw new Error("This library isn't index-only");
	const client = new Client({
		node: connection.host,
		auth: { username: connection.index, password: connection.key },
		requestTimeout: 300_000,
		maxRetries: 5,
	});
	console.log(JSON.stringify(await step({ alias: connection.index, client: client as unknown as LoadSearch["client"] })));
	await client.close();
	close();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
