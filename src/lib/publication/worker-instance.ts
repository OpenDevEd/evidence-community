import {
	readWorkerInstance,
	writeWorkerInstance,
} from "@/lib/worker-instance";

const DEFAULT_INSTANCE_PATH = "/tmp/evidence-library-publication-worker-instance";

export function resolvePublicationWorkerInstancePath() {
	return (
		process.env.PUBLICATION_WORKER_INSTANCE_PATH?.trim() ||
		DEFAULT_INSTANCE_PATH
	);
}

export function readPublicationWorkerInstance(instancePath: string) {
	return readWorkerInstance(instancePath);
}

export function writePublicationWorkerInstance(
	instancePath: string,
	instanceId: string,
) {
	return writeWorkerInstance(instancePath, instanceId);
}
