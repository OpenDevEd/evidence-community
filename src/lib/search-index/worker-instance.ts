import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_INSTANCE_PATH = "/tmp/evidence-library-search-indexer-instance";

export function resolveSearchIndexWorkerInstancePath() {
	return (
		process.env.SEARCH_INDEX_WORKER_INSTANCE_PATH?.trim() ||
		DEFAULT_INSTANCE_PATH
	);
}

export async function readSearchIndexWorkerInstance(instancePath: string) {
	const instanceId = (await readFile(instancePath, "utf8")).trim();
	if (!instanceId)
		throw new Error("Search index worker instance file is empty");
	return instanceId;
}

export async function writeSearchIndexWorkerInstance(
	instancePath: string,
	instanceId: string,
) {
	await mkdir(dirname(instancePath), { recursive: true });
	const temporaryPath = `${instancePath}.${process.pid}`;
	await writeFile(temporaryPath, `${instanceId}\n`, { mode: 0o600 });
	await rename(temporaryPath, instancePath);
}
