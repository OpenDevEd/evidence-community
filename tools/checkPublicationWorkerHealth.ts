import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	readPublicationWorkerInstance,
	resolvePublicationWorkerInstancePath,
} from "../src/lib/publication/worker-instance";
import {
	getPublicationWorkerRun,
	publicationWorkerIsReady,
} from "../src/lib/publication/worker-state";

async function main() {
	const instanceId = await readPublicationWorkerInstance(
		resolvePublicationWorkerInstancePath(),
	);
	const config = await loadLibraryConfig();
	const resource = createPostgresDatabaseResource(config.services.database.url);
	try {
		const run = await getPublicationWorkerRun(
			resource.database,
			`worker:${instanceId}`,
		);
		if (!run || !publicationWorkerIsReady(run)) {
			throw new Error("Publication worker is not ready");
		}
		console.log(
			JSON.stringify({
				heartbeatAt: run.heartbeatAt,
				runId: run.id,
				progress: run.result,
			}),
		);
	} finally {
		await resource.dispose();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
