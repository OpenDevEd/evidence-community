/**
 * Copies this library's old-key redirects from Meilisearch into PostgreSQL (OpenDevEd/new-el#716). Run it once on
 * each library before its Meilisearch is removed; running it again changes nothing. It prints how many redirect
 * documents it read, copied, and left alone.
 *
 *   npm run search:copy-redirects
 */
import { Meilisearch } from "meilisearch";

import { openLibraryDatabaseProcess } from "../src/config/library-config/process";
import { copyMeilisearchRedirects } from "../src/lib/item-redirect-copy";

async function main() {
	const { config, databaseResource, close } = await openLibraryDatabaseProcess({ maxConnections: 2 });
	try {
		const { host, index, key } = config.services.search;
		const client = new Meilisearch({ host, apiKey: key });
		console.log(JSON.stringify(await copyMeilisearchRedirects(client, databaseResource.database, index)));
	} finally {
		await close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
