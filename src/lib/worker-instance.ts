import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readWorkerInstance(instancePath: string) {
	const instanceId = (await readFile(instancePath, "utf8")).trim();
	if (!instanceId) throw new Error("Worker instance file is empty");
	return instanceId;
}

export async function writeWorkerInstance(
	instancePath: string,
	instanceId: string,
) {
	await mkdir(dirname(instancePath), { recursive: true });
	const temporaryPath = `${instancePath}.${process.pid}`;
	await writeFile(temporaryPath, `${instanceId}\n`, { mode: 0o600 });
	await rename(temporaryPath, instancePath);
}
