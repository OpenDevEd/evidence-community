import { once } from "node:events";
import { request as sendHttpRequest } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isCoolifyApplicationUuid } from "../src/lib/deployment/coolify-application";
import {
	createLibraryVolumeDeleterServer,
	LibraryVolumeDeletionError,
	type LibraryVolumeHttpDeleter,
} from "../src/lib/deployment/library-volume-deleter-http";

const dockerSocketPath = "/var/run/docker.sock";
const dockerRequestTimeoutMs = 2_000;
const maximumDockerResponseBytes = 64 * 1_024;
const maximumVolumeContainers = 24;

type DockerMethod = "DELETE" | "GET";

export type DockerVolumeResponse = {
	body: string;
	contentType: string | null;
	status: number;
};

export type DockerVolumeRequest = (request: {
	method: DockerMethod;
	path: string;
}) => Promise<DockerVolumeResponse>;

function deletionFailed(): never {
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
	for (const candidate of body) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
			return deletionFailed();
		}
		const id = (candidate as Record<string, unknown>).Id;
		if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id)) {
			return deletionFailed();
		}
	}
	return body;
}

function requireNamedVolume(
	response: DockerVolumeResponse,
	volumeName: string,
) {
	if (response.status !== 200) return deletionFailed();
	const body = parseDockerJsonResponse(response);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return deletionFailed();
	}
	if ((body as Record<string, unknown>).Name !== volumeName) {
		return deletionFailed();
	}
}

function containerListPath(volumeName: string) {
	const query = new URLSearchParams({
		all: "true",
		filters: JSON.stringify({ volume: [volumeName] }),
	});
	return `/containers/json?${query}`;
}

export function createDockerLibraryVolumeDeleter(
	requestDocker: DockerVolumeRequest,
): LibraryVolumeHttpDeleter {
	return async (applicationUuid) => {
		if (!isCoolifyApplicationUuid(applicationUuid)) return deletionFailed();
		const volumeName = `${applicationUuid}_meilisearch-data`;
		const volumePath = `/volumes/${volumeName}`;

		const containers = requireContainerList(
			await requestDocker({
				method: "GET",
				path: containerListPath(volumeName),
			}),
		);
		if (containers.length > 0) {
			throw new LibraryVolumeDeletionError("volume_in_use");
		}

		const inspection = await requestDocker({ method: "GET", path: volumePath });
		if (inspection.status === 404) return { outcome: "absent" };
		requireNamedVolume(inspection, volumeName);

		const removal = await requestDocker({ method: "DELETE", path: volumePath });
		if (removal.status === 409) {
			throw new LibraryVolumeDeletionError("volume_in_use");
		}
		if (removal.status === 404) return { outcome: "absent" };
		if (removal.status !== 204) return deletionFailed();

		const verification = await requestDocker({
			method: "GET",
			path: volumePath,
		});
		if (verification.status !== 404) return deletionFailed();
		return { outcome: "deleted" };
	};
}

function requestDockerSocket(input: {
	method: DockerMethod;
	path: string;
}): Promise<DockerVolumeResponse> {
	return new Promise((resolveRequest, rejectRequest) => {
		const request = sendHttpRequest(
			{
				headers: { Accept: "application/json" },
				method: input.method,
				path: input.path,
				socketPath: dockerSocketPath,
			},
			(response) => {
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk: Buffer | string) => {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					bytes += buffer.byteLength;
					if (bytes > maximumDockerResponseBytes) {
						request.destroy();
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
		request.setTimeout(dockerRequestTimeoutMs, () => request.destroy());
		request.once("error", () => {
			rejectRequest(
				new LibraryVolumeDeletionError("volume_deletion_failed"),
			);
		});
		request.end();
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
	const stop = () => {
		server.close((error) => {
			if (error) {
				console.error("Volume deleter shutdown failed.");
				process.exitCode = 1;
			}
		});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	const port = readPort(process.env.PORT);
	server.listen(port, "0.0.0.0");
	await once(server, "listening");
	console.log(`Library volume deleter is listening on port ${port}.`);
}

const entrypoint = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (entrypoint === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
