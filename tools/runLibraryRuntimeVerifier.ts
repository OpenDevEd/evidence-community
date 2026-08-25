import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	createLibraryRuntimeVerifierServer,
	type LibraryRuntimeContainerFact,
	type LibraryRuntimeContainerReader,
} from "../src/lib/deployment/library-runtime-verifier-http";

const dockerApiVersion = "v1.51";
const dockerRequestTimeoutMs = 2_000;
const maximumDockerResponseBytes = 512 * 1_024;
const maximumApplicationContainers = 24;
const maximumLabels = 256;
const maximumPortBindings = 128;

const composeProjectLabel = "com.docker.compose.project";
const composeServiceLabel = "com.docker.compose.service";
const coolifyManagedLabel = "coolify.managed";
const coolifyTypeLabel = "coolify.type";

const dockerContainerStates = new Set([
	"created",
	"dead",
	"exited",
	"paused",
	"removing",
	"restarting",
	"running",
]);
const dockerHealthStates = new Set(["healthy", "starting", "unhealthy"]);

class RuntimeVerifierStartupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeVerifierStartupError";
	}
}

class DockerRuntimeInspectionError extends Error {
	constructor() {
		super("The Docker runtime could not be inspected.");
		this.name = "DockerRuntimeInspectionError";
	}
}

function invalidDockerResponse(): never {
	throw new DockerRuntimeInspectionError();
}

function requireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return invalidDockerResponse();
	}
	return value as Record<string, unknown>;
}

function requireString(value: unknown, maximumBytes = 8_192) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf8") > maximumBytes
	) {
		return invalidDockerResponse();
	}
	return value;
}

function requireLabels(value: unknown) {
	const record = requireRecord(value);
	const entries = Object.entries(record);
	if (entries.length > maximumLabels) return invalidDockerResponse();
	const labels: Record<string, string> = {};
	for (const [key, candidate] of entries) {
		if (Buffer.byteLength(key, "utf8") > 256) return invalidDockerResponse();
		labels[key] = requireString(candidate);
	}
	return labels;
}

function requireCoolifyApplicationLabels(
	labels: Readonly<Record<string, string>>,
	applicationUuid: string,
) {
	if (
		labels[composeProjectLabel] !== applicationUuid ||
		labels[coolifyManagedLabel] !== "true" ||
		labels[coolifyTypeLabel] !== "application"
	) {
		return invalidDockerResponse();
	}
}

function requireContainerId(value: unknown) {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
		return invalidDockerResponse();
	}
	return value;
}

function requirePortNumber(value: string) {
	if (!/^[1-9][0-9]{0,4}$/u.test(value)) return invalidDockerResponse();
	const port = Number(value);
	if (port > 65_535) return invalidDockerResponse();
	return port;
}

function requirePublishedPorts(value: unknown) {
	if (value === null) return [];
	const ports = requireRecord(value);
	if (Object.keys(ports).length > maximumPortBindings) {
		return invalidDockerResponse();
	}
	const published: LibraryRuntimeContainerFact["publishedPorts"][number][] = [];
	for (const [containerSocket, candidateBindings] of Object.entries(ports)) {
		const match = /^([1-9][0-9]{0,4})\/(sctp|tcp|udp)$/u.exec(containerSocket);
		if (!match) return invalidDockerResponse();
		const containerPort = requirePortNumber(match[1]);
		const protocol = match[2] as "sctp" | "tcp" | "udp";
		if (candidateBindings === null) continue;
		if (!Array.isArray(candidateBindings) || candidateBindings.length > 16) {
			return invalidDockerResponse();
		}
		for (const candidate of candidateBindings) {
			const binding = requireRecord(candidate);
			published.push({
				containerPort,
				hostIp: requireString(binding.HostIp, 255),
				hostPort: requirePortNumber(requireString(binding.HostPort, 5)),
				protocol,
			});
		}
	}
	return published.sort(
		(left, right) =>
			left.containerPort - right.containerPort ||
			left.protocol.localeCompare(right.protocol) ||
			left.hostIp.localeCompare(right.hostIp) ||
			left.hostPort - right.hostPort,
	);
}

function requireContainerState(value: unknown) {
	const state = requireRecord(value);
	const status = requireString(state.Status, 32);
	if (!dockerContainerStates.has(status)) return invalidDockerResponse();
	if (state.Health === undefined || state.Health === null) {
		return { health: null, state: status };
	}
	const health = requireString(requireRecord(state.Health).Status, 32);
	if (!dockerHealthStates.has(health)) return invalidDockerResponse();
	return { health, state: status };
}

function requireContainerInspection(
	value: unknown,
	applicationUuid: string,
	expectedContainerId: string,
): LibraryRuntimeContainerFact {
	const inspection = requireRecord(value);
	if (requireContainerId(inspection.Id) !== expectedContainerId) {
		return invalidDockerResponse();
	}
	const labels = requireLabels(requireRecord(inspection.Config).Labels);
	requireCoolifyApplicationLabels(labels, applicationUuid);
	const service = requireString(labels[composeServiceLabel], 128);
	if (!/^[a-z0-9][a-z0-9_.-]*$/u.test(service)) {
		return invalidDockerResponse();
	}
	const state = requireContainerState(inspection.State);
	const publishedPorts = requirePublishedPorts(
		requireRecord(inspection.NetworkSettings).Ports,
	);
	return { ...state, labels, publishedPorts, service };
}

function requireContainerSummaries(value: unknown, applicationUuid: string) {
	if (!Array.isArray(value) || value.length > maximumApplicationContainers) {
		return invalidDockerResponse();
	}
	const seen = new Set<string>();
	return value.map((candidate) => {
		const summary = requireRecord(candidate);
		const id = requireContainerId(summary.Id);
		if (seen.has(id)) return invalidDockerResponse();
		seen.add(id);
		const labels = requireLabels(summary.Labels);
		requireCoolifyApplicationLabels(labels, applicationUuid);
		requireString(labels[composeServiceLabel], 128);
		return id;
	});
}

function requireDockerContentLength(value: string | null) {
	if (value === null) return;
	if (!/^(0|[1-9][0-9]*)$/u.test(value)) return invalidDockerResponse();
	if (Number(value) > maximumDockerResponseBytes) {
		return invalidDockerResponse();
	}
}

function requireDockerResponseBody(response: Response) {
	if (!response.ok) return invalidDockerResponse();
	const contentType = response.headers.get("content-type")?.split(";", 1)[0];
	if (contentType !== "application/json") return invalidDockerResponse();
	requireDockerContentLength(response.headers.get("content-length"));
	if (!response.body) return invalidDockerResponse();
	return response.body;
}

async function readBoundedStream(body: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	const reader = body.getReader();
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		bytes += result.value.byteLength;
		if (bytes > maximumDockerResponseBytes) {
			await reader.cancel();
			return invalidDockerResponse();
		}
		chunks.push(result.value);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(
		Buffer.concat(chunks, bytes),
	);
}

async function readBoundedResponse(response: Response) {
	return JSON.parse(
		await readBoundedStream(requireDockerResponseBody(response)),
	) as unknown;
}

function invalidDockerProxyUrl(): never {
	throw new RuntimeVerifierStartupError(
		"EVIDENCE_LIBRARY_RUNTIME_VERIFIER_DOCKER_URL must be an HTTP origin.",
	);
}

function parseDockerProxyUrl(value: string | URL) {
	try {
		return new URL(value);
	} catch {
		return invalidDockerProxyUrl();
	}
	}

function requireDockerProxyUrl(value: string | URL) {
	const url = parseDockerProxyUrl(value);
	if (url.protocol !== "http:" || url.href !== `${url.origin}/`) {
		return invalidDockerProxyUrl();
	}
	return url;
}

async function readDockerJson(url: URL) {
	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			method: "GET",
			redirect: "error",
			signal: AbortSignal.timeout(dockerRequestTimeoutMs),
		});
		return await readBoundedResponse(response);
	} catch {
		return invalidDockerResponse();
	}
}

export function createDockerLibraryRuntimeContainerReader(
	dockerProxyUrl: string | URL,
): LibraryRuntimeContainerReader {
	const baseUrl = requireDockerProxyUrl(dockerProxyUrl);
	return async (applicationUuid) => {
		try {
			if (!/^[a-z0-9]{24}$/u.test(applicationUuid)) {
				return invalidDockerResponse();
			}
			const listUrl = new URL(`${dockerApiVersion}/containers/json`, baseUrl);
			listUrl.searchParams.set("all", "true");
			listUrl.searchParams.set(
				"filters",
				JSON.stringify({
					label: [`${composeProjectLabel}=${applicationUuid}`],
				}),
			);
			const ids = requireContainerSummaries(
				await readDockerJson(listUrl),
				applicationUuid,
			);
			return await Promise.all(
				ids.map(async (id) => {
					const inspectUrl = new URL(
						`${dockerApiVersion}/containers/${id}/json`,
						baseUrl,
					);
					return requireContainerInspection(
						await readDockerJson(inspectUrl),
						applicationUuid,
						id,
					);
				}),
			);
		} catch {
			throw new DockerRuntimeInspectionError();
		}
	};
}

function readRequiredEnvironment(name: string) {
	const value = process.env[name];
	if (!value) throw new RuntimeVerifierStartupError(`${name} is required.`);
	return value;
}

function readPort(value = "3000") {
	if (!/^[1-9][0-9]{0,4}$/u.test(value)) {
		throw new RuntimeVerifierStartupError(
			"PORT must be an integer between 1 and 65535.",
		);
	}
	const port = Number(value);
	if (port > 65_535) {
		throw new RuntimeVerifierStartupError(
			"PORT must be an integer between 1 and 65535.",
		);
	}
	return port;
}

function readToken() {
	const token = readRequiredEnvironment(
		"EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN",
	);
	const bytes = Buffer.byteLength(token, "utf8");
	if (bytes < 32 || bytes > 1_024) {
		throw new RuntimeVerifierStartupError(
			"EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN must be 32 to 1024 bytes.",
		);
	}
	return token;
}

async function main() {
	const readContainers = createDockerLibraryRuntimeContainerReader(
		readRequiredEnvironment(
			"EVIDENCE_LIBRARY_RUNTIME_VERIFIER_DOCKER_URL",
		),
	);
	const server = createLibraryRuntimeVerifierServer({
		readContainers,
		token: readToken(),
	});
	const stop = () => {
		server.close((error) => {
			if (error) {
				console.error("Runtime verifier shutdown failed.");
				process.exitCode = 1;
			}
		});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	const port = readPort(process.env.PORT);
	server.listen(port, "0.0.0.0");
	await once(server, "listening");
	console.log(`Library runtime verifier is listening on port ${port}.`);
}

const entrypoint = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (entrypoint === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(
			error instanceof RuntimeVerifierStartupError
				? error.message
				: "Runtime verifier failed to start.",
		);
		process.exitCode = 1;
	});
}
