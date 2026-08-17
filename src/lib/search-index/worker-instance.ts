import {
	readWorkerInstance,
	writeWorkerInstance,
} from "@/lib/worker-instance";

const DEFAULT_INSTANCE_PATH = "/tmp/evidence-library-search-indexer-instance";

export function resolveSearchIndexWorkerInstancePath() {
	return (
		process.env.SEARCH_INDEX_WORKER_INSTANCE_PATH?.trim() ||
		DEFAULT_INSTANCE_PATH
	);
}

export async function readSearchIndexWorkerInstance(instancePath: string) {
	return readWorkerInstance(instancePath);
}

export async function writeSearchIndexWorkerInstance(
	instancePath: string,
	instanceId: string,
) {
	await writeWorkerInstance(instancePath, instanceId);
}
