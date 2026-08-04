import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	getSearchIndexWorker,
	searchIndexWorkerIsActive,
} from "../src/lib/search-index/worker-state";
import {
	readSearchIndexWorkerInstance,
	resolveSearchIndexWorkerInstancePath,
} from "../src/lib/search-index/worker-instance";

const maximumHeartbeatAgeMs = 20_000;

async function main() {
	const workerId = process.env.SEARCH_INDEX_WORKER_ID?.trim();
	if (!workerId) {
		throw new Error("SEARCH_INDEX_WORKER_ID is required");
	}
	const instanceId = await readSearchIndexWorkerInstance(
		resolveSearchIndexWorkerInstancePath(),
	);
	const config = await loadLibraryConfig();
	const resource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	try {
		const worker = await getSearchIndexWorker(resource.database, workerId);
		if (
			!worker ||
			worker.instanceId !== instanceId ||
			!searchIndexWorkerIsActive(
				worker,
				new Date(),
				maximumHeartbeatAgeMs,
			)
		) {
			throw new Error("Search index worker heartbeat is stale");
		}
		console.log(
			JSON.stringify({
				heartbeatAt: worker.heartbeatAt,
				instanceId: worker.instanceId,
				stage: worker.stage,
				workerId: worker.workerId,
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
