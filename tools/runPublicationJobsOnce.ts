import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { runCrossrefPublicationJobsOnce } from "../src/lib/publication/crossref-adapter";

async function main() {
	const config = await loadLibraryConfig();
	const resource = createPostgresDatabaseResource(config.services.database.url);
	try {
		const outcomes = await runCrossrefPublicationJobsOnce(
			resource.database,
			config,
		);
		console.log(
			outcomes.length === 0
				? "No Crossref publication jobs were ready."
				: `Handled ${outcomes.length} Crossref publication job${outcomes.length === 1 ? "" : "s"}.`,
		);
	} finally {
		await resource.dispose();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
