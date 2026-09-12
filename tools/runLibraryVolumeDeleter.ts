import { request as sendHttpRequest } from "node:http";

import { isCoolifyApplicationUuid } from "../src/lib/deployment/coolify-application";
import {
	createLibraryVolumeDeleterServer,
	LibraryVolumeDeletionError,
	type LibraryVolumeHttpDeleter,
} from "../src/lib/deployment/library-volume-deleter-http";
import {
	listenForFixedHttpService,
	runFixedHttpServiceMain,
} from "./runFixedHttpService";

const dockerSocketPath = "/var/run/docker.sock";
const dockerRequestTimeoutMs = 2_000;
const maximumDockerResponseBytes = 64 * 1_024;
const maximumVolumeContainers = 24;

type DockerMethod = "DELETE" | "GET" | "POST";

export type DockerVolumeResponse = {
	body: string;
	contentType: string | null;
	status: number;
};

export type DockerVolumeRequest = (request: {
	method: DockerMethod;
	path: string;
	body?: string;
}) => Promise<DockerVolumeResponse>;

function deletionFailed(step = "docker_response", status?: number): never {
	console.error("Library runtime cleanup failed", { step, status });
	throw new LibraryVolumeDeletionError("volume_deletion_failed");
}

export function parseDockerJsonResponse(
	response: DockerVolumeResponse,
): unknown {
	if (
		response.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
		"application/json"
	) {
		return deletionFailed();
	}
	if (Buffer.byteLength(response.body, "utf8") > maximumDockerResponseBytes) {
		return deletionFailed();
	}
	try {
		return JSON.parse(response.body);
	} catch {
		return deletionFailed();
	}
}

function requireContainerList(response: DockerVolumeResponse) {
	if (response.status !== 200) return deletionFailed();
	const body = parseDockerJsonResponse(response);
	if (!Array.isArray(body) || body.length > maximumVolumeContainers) {
		return deletionFailed();
	}
	body.forEach(requireContainerSummary);
	return body;
}

function requireDockerObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return deletionFailed();
	return value as Record<string, unknown>;
}

function requireContainerSummary(candidate: unknown) {
	const id = requireDockerObject(candidate).Id;
	if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id)) {
		return deletionFailed();
	}
}

function requireNamedResource(
	response: DockerVolumeResponse,
	volumeName: string,
) {
	if (response.status !== 200) return deletionFailed();
	const body = requireDockerObject(parseDockerJsonResponse(response));
	if (body.Name !== volumeName) {
		return deletionFailed();
	}
	return body;
}

function containerListPath(filter: "volume" | "network", resourceName: string) {
	const query = new URLSearchParams({
		all: "true",
		filters: JSON.stringify({ [filter]: [resourceName] }),
	});
	return `/containers/json?${query}`;
}

async function deleteDockerResource(requestDocker: DockerVolumeRequest, path: string) {
	const removal = await requestDocker({ method: "DELETE", path });
	if ([403, 409].includes(removal.status)) throw new LibraryVolumeDeletionError("volume_in_use");
	if (removal.status === 404) return false;
	if (removal.status !== 204) return deletionFailed(`delete ${path}`, removal.status);
	const verification = await requestDocker({ method: "GET", path });
	if (verification.status !== 404) return deletionFailed(`verify ${path}`, verification.status);
	return true;
}

async function deleteNamedVolume(
	requestDocker: DockerVolumeRequest,
	volumeName: string,
): Promise<boolean> {
	const volumePath = `/volumes/${volumeName}`;

	const containers = requireContainerList(
		await requestDocker({
			method: "GET",
			path: containerListPath("volume", volumeName),
		}),
	);
	if (containers.length > 0) {
		throw new LibraryVolumeDeletionError("volume_in_use");
	}

	const inspection = await requestDocker({ method: "GET", path: volumePath });
	if (inspection.status === 404) return false;
	requireNamedResource(inspection, volumeName);

	return deleteDockerResource(requestDocker, volumePath);
}

function requireUnusedNetwork(body: Record<string, unknown>, applicationUuid: string) {
	const labels = requireDockerObject(body.Labels);
	if (labels["com.docker.compose.project"] !== applicationUuid) return deletionFailed("network_ownership");
	const containers = requireDockerObject(body.Containers);
	const entries = Object.entries(containers);
	if (entries.length > maximumVolumeContainers) return deletionFailed();
	for (const [id, container] of entries) {
		requireContainerSummary({ Id: id });
		if (requireDockerObject(container).Name !== "coolify-proxy") {
			throw new LibraryVolumeDeletionError("volume_in_use");
		}
	}
	return entries.map(([id]) => id);
}

async function deletePrivateNetwork(requestDocker: DockerVolumeRequest, applicationUuid: string) {
	const networkName = `${applicationUuid}_private`;
	const path = `/networks/${networkName}`;
	const inspection = await requestDocker({ method: "GET", path });
	if (inspection.status === 404) return false;
	const body = requireNamedResource(inspection, networkName);
	const proxyIds = requireUnusedNetwork(body, applicationUuid);
	// Network inspection omits stopped containers. They still need this network.
	const containers = requireContainerList(await requestDocker({
		method: "GET", path: containerListPath("network", networkName),
	}));
	if (containers.some(({ Id }) => !proxyIds.includes(Id))) {
		throw new LibraryVolumeDeletionError("volume_in_use");
	}
	for (const id of proxyIds) {
		const detached = await requestDocker({
			method: "POST", path: `${path}/disconnect`,
			body: JSON.stringify({ Container: id, Force: false }),
		});
		if (detached.status !== 200 && detached.status !== 404) return deletionFailed("network_disconnect", detached.status);
	}
	return deleteDockerResource(requestDocker, path);
}

export function createDockerLibraryVolumeDeleter(
	requestDocker: DockerVolumeRequest,
): LibraryVolumeHttpDeleter {
	return async (applicationUuid) => {
		if (!isCoolifyApplicationUuid(applicationUuid)) return deletionFailed();
		let deleted = false;
		for (const suffix of ["meilisearch-data", "library-config-data"]) {
			const removed = await deleteNamedVolume(requestDocker, `${applicationUuid}_${suffix}`);
			deleted ||= removed;
		}
		const removedNetwork = await deletePrivateNetwork(requestDocker, applicationUuid);
		return { outcome: deleted || removedNetwork ? "deleted" : "absent" };
	};
}

export function requestDockerSocket(input: {
	method: DockerMethod;
	path: string;
	body?: string;
}, socketPath = dockerSocketPath): Promise<DockerVolumeResponse> {
	return new Promise((resolveRequest, rejectRequest) => {
		const request = sendHttpRequest(
			{
				headers: { Accept: "application/json", ...(input.body ? { "Content-Type": "application/json" } : {}) },
				method: input.method,
				path: input.path,
				socketPath,
			},
			(response) => {
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk: Buffer | string) => {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					bytes += buffer.byteLength;
					if (bytes > maximumDockerResponseBytes) {
						request.destroy(
							new LibraryVolumeDeletionError("volume_deletion_failed"),
						);
						return;
					}
					chunks.push(buffer);
				});
				response.once("end", () => {
					if (bytes > maximumDockerResponseBytes) {
						rejectRequest(
							new LibraryVolumeDeletionError("volume_deletion_failed"),
						);
						return;
					}
					const contentType = Array.isArray(response.headers["content-type"])
						? response.headers["content-type"][0] ?? null
						: response.headers["content-type"] ?? null;
					resolveRequest({
						body: Buffer.concat(chunks, bytes).toString("utf8"),
						contentType,
						status: response.statusCode ?? 0,
					});
				});
			},
		);
		request.setTimeout(dockerRequestTimeoutMs, () =>
			request.destroy(
				new LibraryVolumeDeletionError("volume_deletion_failed"),
			),
		);
		request.once("error", () => {
			rejectRequest(
				new LibraryVolumeDeletionError("volume_deletion_failed"),
			);
		});
		request.end(input.body);
	});
}

function readRequiredEnvironment(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function readPort(value = "3000") {
	if (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65_535) {
		throw new Error("PORT must be an integer between 1 and 65535.");
	}
	return Number(value);
}

async function main() {
	const token = readRequiredEnvironment(
		"EVIDENCE_LIBRARY_VOLUME_DELETER_TOKEN",
	);
	const server = createLibraryVolumeDeleterServer({
		onError: () => console.error("Library volume deletion failed."),
		remove: createDockerLibraryVolumeDeleter(requestDockerSocket),
		token,
	});
	const port = readPort(process.env.PORT);
	await listenForFixedHttpService({
		listeningMessage: (activePort) =>
			`Library volume deleter is listening on port ${activePort}.`,
		port,
		server,
		shutdownErrorMessage: "Volume deleter shutdown failed.",
	});
}

runFixedHttpServiceMain({
	formatError: (error) =>
		error instanceof Error ? error.message : String(error),
	importMetaUrl: import.meta.url,
	main,
});
