import { isIP } from "node:net";
import path from "node:path";

import { MAX_LIBRARY_CONFIG_BYTES } from "@/config/library-config/schema";

import { isCoolifyApplicationUuid } from "./coolify-application";
import {
	LibraryRuntimeGuardError,
	type LibraryRuntimeGuardDocker,
	type LibraryRuntimeRouteInput,
} from "./library-runtime-guard";
import { LIBRARY_COMPOSE_RELEASE_LABEL } from "./library-compose-contract";

const dockerApiVersion = "v1.41";
const dockerRequestTimeoutMs = 5_000;
const maximumDockerJsonBytes = 512 * 1_024;
const maximumDockerArchiveBytes = MAX_LIBRARY_CONFIG_BYTES + 4 * 1_024;
const guardStartAttempts = 20;
const guardPort = 3000;
const guardLabel = "org.opendeved.evidence-library.guard";
const guardApplicationLabel = `${guardLabel}.application`;
const guardRevisionLabel = `${guardLabel}.revision`;
const composeProjectLabel = "com.docker.compose.project";
const composeServiceLabel = "com.docker.compose.service";
const managedLabel = "coolify.managed";
const managedTypeLabel = "coolify.type";

type Fetch = typeof fetch;

type DockerGuardOptions = {
	dockerProxyUrl: string | URL;
	fetch?: Fetch;
	sleep?: (milliseconds: number) => Promise<void>;
};

type EnsureGuardInput = Parameters<LibraryRuntimeGuardDocker["ensureGuard"]>[0];

type InspectedContainer = {
	config: Record<string, unknown>;
	id: string;
	networks: Record<string, unknown>;
	state: Record<string, unknown>;
};

function guardError(code: string, message: string, status = 409): never {
	throw new LibraryRuntimeGuardError(code, message, status);
}

function requireRecord(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime could not be inspected.",
			502,
		);
	}
	return value as Record<string, unknown>;
}

function requireString(value: unknown, maximumBytes = 8_192) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf8") > maximumBytes
	) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime could not be inspected.",
			502,
		);
	}
	return value;
}

function requireLabels(value: unknown) {
	const record = requireRecord(value);
	if (Object.keys(record).length > 256) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime could not be inspected.",
			502,
		);
	}
	return Object.fromEntries(
		Object.entries(record).map(([key, candidate]) => [
			key,
			requireString(candidate),
		]),
	);
}

function requireDockerOrigin(value: string | URL) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return guardError(
			"runtime_guard_configuration_invalid",
			"The runtime guard Docker URL must be an HTTP origin.",
			500,
		);
	}
	if (url.protocol !== "http:" || url.href !== `${url.origin}/`) {
		return guardError(
			"runtime_guard_configuration_invalid",
			"The runtime guard Docker URL must be an HTTP origin.",
			500,
		);
	}
	return url;
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
	const declaredLength = response.headers.get("content-length");
	if (
		declaredLength &&
		(!/^(0|[1-9][0-9]*)$/u.test(declaredLength) ||
			Number(declaredLength) > maximumBytes)
	) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime returned too much data.",
			502,
		);
	}
	if (!response.body) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime returned no data.",
			502,
		);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		byteLength += result.value.byteLength;
		if (byteLength > maximumBytes) {
			await reader.cancel();
			return guardError(
				"runtime_inspection_failed",
				"The Evidence Library runtime returned too much data.",
				502,
			);
		}
		chunks.push(result.value);
	}
	return Buffer.concat(chunks, byteLength);
}

async function readJson(response: Response) {
	const contentType = response.headers.get("content-type")?.split(";", 1)[0];
	if (contentType !== "application/json") {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime returned an invalid response.",
			502,
		);
	}
	try {
		return JSON.parse(
			(await readBoundedBytes(response, maximumDockerJsonBytes)).toString(
				"utf8",
			),
		) as unknown;
	} catch (error: unknown) {
		if (error instanceof LibraryRuntimeGuardError) throw error;
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime returned invalid JSON.",
			502,
		);
	}
}

function tarString(bytes: Buffer, offset: number, length: number) {
	const end = bytes.subarray(offset, offset + length).indexOf(0);
	return bytes
		.subarray(offset, offset + (end === -1 ? length : end))
		.toString("utf8");
}

function readConfigFromTar(bytes: Buffer) {
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = tarString(header, 0, 100);
		const prefix = tarString(header, 345, 155);
		const sizeText = tarString(header, 124, 12).trim();
		if (!/^[0-7]+$/u.test(sizeText)) {
			return guardError(
				"runtime_config_copy_failed",
				"The active Evidence Library configuration could not be copied.",
				502,
			);
		}
		const size = Number.parseInt(sizeText, 8);
		const contentStart = offset + 512;
		const contentEnd = contentStart + size;
		if (contentEnd > bytes.length || size > MAX_LIBRARY_CONFIG_BYTES) {
			return guardError(
				"runtime_config_copy_failed",
				"The active Evidence Library configuration could not be copied.",
				502,
			);
		}
		const entryPath = prefix ? `${prefix}/${name}` : name;
		if (path.posix.basename(entryPath) === "library.json") {
			try {
				return new TextDecoder("utf-8", { fatal: true }).decode(
					bytes.subarray(contentStart, contentEnd),
				);
			} catch {
				return guardError(
					"runtime_config_copy_failed",
					"The active Evidence Library configuration could not be copied.",
					502,
				);
			}
		}
		offset = contentStart + Math.ceil(size / 512) * 512;
	}
	return guardError(
		"runtime_config_copy_failed",
		"The active Evidence Library configuration could not be copied.",
		502,
	);
}

function requireConfigRevision(configJson: string, expectedRevision: string) {
	try {
		const config = requireRecord(JSON.parse(configJson));
		if (config.revision !== expectedRevision) {
			return guardError(
				"runtime_revision_mismatch",
				"The active Evidence Library revision does not match the requested revision.",
			);
		}
	} catch (error: unknown) {
		if (error instanceof LibraryRuntimeGuardError) throw error;
		return guardError(
			"runtime_config_copy_failed",
			"The active Evidence Library configuration could not be copied.",
			502,
		);
	}
}

function guardName(applicationUuid: string) {
	return `openscholar-library-guard-${applicationUuid}`;
}

function requireContainerId(value: unknown) {
	const id = requireString(value, 64);
	if (!/^[a-f0-9]{64}$/u.test(id)) {
		return guardError(
			"runtime_inspection_failed",
			"The Evidence Library runtime could not be inspected.",
			502,
		);
	}
	return id;
}

function inspectContainer(value: unknown): InspectedContainer {
	const record = requireRecord(value);
	return {
		config: requireRecord(record.Config),
		id: requireContainerId(record.Id),
		networks: requireRecord(requireRecord(record.NetworkSettings).Networks),
		state: requireRecord(record.State),
	};
}

function requireRunning(
	state: Record<string, unknown>,
	requireHealthy: boolean,
) {
	if (state.Status !== "running") {
		return guardError(
			"runtime_web_not_ready",
			"The Evidence Library web service is not running.",
		);
	}
	if (requireHealthy && requireRecord(state.Health).Status !== "healthy") {
		return guardError(
			"runtime_web_not_ready",
			"The Evidence Library web service is not healthy.",
		);
	}
}

function requireNetworkIp(networks: Record<string, unknown>, network: string) {
	const ipAddress = requireString(
		requireRecord(networks[network]).IPAddress,
		64,
	);
	if (isIP(ipAddress) === 0) {
		return guardError(
			"runtime_network_invalid",
			"The Evidence Library web address could not be resolved.",
		);
	}
	return ipAddress;
}

function requireApplicationNetworks(networks: Record<string, unknown>) {
	const names = Object.keys(networks);
	if (
		names.length < 2 ||
		names.length > 4 ||
		!names.includes("coolify") ||
		names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(name))
	) {
		return guardError(
			"runtime_network_invalid",
			"The Evidence Library web networks are invalid.",
		);
	}
	return names.sort();
}

function requireApplicationContainerId(value: unknown) {
	if (!Array.isArray(value) || value.length !== 1) {
		return guardError(
			"runtime_web_not_ready",
			"The Evidence Library must have one running web service.",
		);
	}
	return requireContainerId(requireRecord(value[0]).Id);
}

function requireApplicationWebIdentity(
	container: InspectedContainer,
	input: LibraryRuntimeRouteInput,
) {
	const labels = requireLabels(container.config.Labels);
	if (
		labels[composeProjectLabel] !== input.applicationUuid ||
		labels[composeServiceLabel] !== "web" ||
		labels[managedLabel] !== "true" ||
		labels[managedTypeLabel] !== "application" ||
		labels[LIBRARY_COMPOSE_RELEASE_LABEL] !== input.commit ||
		container.config.Image !== input.runtimeImage
	) {
		return guardError(
			"runtime_web_mismatch",
			"The running Evidence Library web service does not match its active release.",
		);
	}
	requireRunning(container.state, true);
	return container;
}

export function createDockerLibraryRuntimeGuard(
	options: DockerGuardOptions,
): LibraryRuntimeGuardDocker {
	const baseUrl = requireDockerOrigin(options.dockerProxyUrl);
	const fetchRequest = options.fetch ?? fetch;
	const sleep =
		options.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

	const request = async (
		endpoint: string,
		init: RequestInit,
		expectedStatuses: readonly number[],
	) => {
		let response: Response;
		try {
			response = await fetchRequest(new URL(endpoint, baseUrl), {
				...init,
				redirect: "error",
				signal: AbortSignal.timeout(dockerRequestTimeoutMs),
			});
		} catch {
			return guardError(
				"runtime_inspection_failed",
				"The Evidence Library runtime could not be reached.",
				502,
			);
		}
		if (!expectedStatuses.includes(response.status)) {
			return guardError(
				"runtime_inspection_failed",
				"The Evidence Library runtime request failed.",
				502,
			);
		}
		return response;
	};

	const inspect = async (idOrName: string, allowMissing = false) => {
		const response = await request(
			`${dockerApiVersion}/containers/${encodeURIComponent(idOrName)}/json`,
			{ headers: { Accept: "application/json" }, method: "GET" },
			allowMissing ? [200, 404] : [200],
		);
		return response.status === 404
			? null
			: inspectContainer(await readJson(response));
	};

	const readApplicationWeb = async (input: LibraryRuntimeRouteInput) => {
		if (!isCoolifyApplicationUuid(input.applicationUuid)) {
			return guardError(
				"invalid_request",
				"applicationUuid must identify one Evidence Library.",
				400,
			);
		}
		const listUrl = new URL(`${dockerApiVersion}/containers/json`, baseUrl);
		listUrl.searchParams.set("all", "true");
		listUrl.searchParams.set(
			"filters",
			JSON.stringify({
				label: [
					`${composeProjectLabel}=${input.applicationUuid}`,
					`${composeServiceLabel}=web`,
				],
			}),
		);
		const response = await request(
			`${listUrl.pathname}${listUrl.search}`,
			{ headers: { Accept: "application/json" }, method: "GET" },
			[200],
		);
		const container = await inspect(
			requireApplicationContainerId(await readJson(response)),
		);
		if (!container) {
			return guardError(
				"runtime_web_not_ready",
				"The Evidence Library web service disappeared during inspection.",
			);
		}
		requireApplicationWebIdentity(container, input);
		const archiveUrl = new URL(
			`${dockerApiVersion}/containers/${container.id}/archive`,
			baseUrl,
		);
		archiveUrl.searchParams.set("path", "/runtime/config/library.json");
		const archiveResponse = await request(
			`${archiveUrl.pathname}${archiveUrl.search}`,
			{ headers: { Accept: "application/x-tar" }, method: "GET" },
			[200],
		);
		const configJson = readConfigFromTar(
			await readBoundedBytes(archiveResponse, maximumDockerArchiveBytes),
		);
		requireConfigRevision(configJson, input.revision);
		return {
			configJson,
			ipAddress: requireNetworkIp(container.networks, "coolify"),
			networks: requireApplicationNetworks(container.networks),
			port: guardPort,
		};
	};

	const requireGuard = (
		container: InspectedContainer,
		input: LibraryRuntimeRouteInput,
	) => {
		const labels = requireLabels(container.config.Labels);
		if (
			labels[guardLabel] !== "true" ||
			labels[guardApplicationLabel] !== input.applicationUuid ||
			labels[LIBRARY_COMPOSE_RELEASE_LABEL] !== input.commit ||
			labels[guardRevisionLabel] !== input.revision ||
			container.config.Image !== input.runtimeImage
		) {
			return guardError(
				"runtime_guard_conflict",
				"An unrelated container is using the Evidence Library guard name.",
			);
		}
		return container;
	};

	const requireOwnedGuard = (
		container: InspectedContainer,
		applicationUuid: string,
	) => {
		const labels = requireLabels(container.config.Labels);
		if (
			labels[guardLabel] !== "true" ||
			labels[guardApplicationLabel] !== applicationUuid
		) {
			return guardError(
				"runtime_guard_conflict",
				"An unrelated container is using the Evidence Library guard name.",
			);
		}
		return container;
	};

	const probeGuard = async (
		container: InspectedContainer,
		input: LibraryRuntimeRouteInput,
	) => {
		if (container.state.Status !== "running") return null;
		let ipAddress: string;
		try {
			ipAddress = requireNetworkIp(container.networks, "coolify");
		} catch {
			return null;
		}
		try {
			const response = await fetchRequest(
				`http://${ipAddress}:${guardPort}/api/library-config/health`,
				{
					headers: {
						Accept: "application/json",
						"X-Forwarded-Host": new URL(input.platformOrigins[0])
							.host,
						"X-Forwarded-Proto": "https",
					},
					redirect: "error",
					signal: AbortSignal.timeout(2_000),
				},
			);
			if (!response.ok) return null;
			const health = requireRecord(await readJson(response));
			const active = requireRecord(health.active);
			if (
				health.state !== "active" ||
				active.revision !== input.revision
			) {
				return null;
			}
			return { ipAddress, port: guardPort };
		} catch {
			return null;
		}
	};

	const connectToNetwork = async (containerId: string, network: string) => {
		await request(
			`${dockerApiVersion}/networks/${encodeURIComponent(network)}/connect`,
			{
				body: JSON.stringify({ Container: containerId }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
			[200],
		);
	};

	const connectGuardNetworks = async (
		container: InspectedContainer,
		input: EnsureGuardInput,
	) => {
		const connectedNetworks = container.networks;
		const missingNetworks = input.source.networks.filter(
			(network) => !(network in connectedNetworks),
		);
		for (const network of missingNetworks) {
			await connectToNetwork(container.id, network);
		}
		if (missingNetworks.length === 0) return container;
		const updated = await inspect(container.id);
		if (!updated) {
			return guardError(
				"runtime_guard_start_failed",
				"The Evidence Library continuity guard disappeared.",
			);
		}
		return requireGuard(updated, input);
	};

	const createGuard = async (
		name: string,
		initialNetwork: string,
		input: EnsureGuardInput,
	) => {
		const createUrl = new URL(
			`${dockerApiVersion}/containers/create`,
			baseUrl,
		);
		createUrl.searchParams.set("name", name);
		const labels = {
			[guardLabel]: "true",
			[guardApplicationLabel]: input.applicationUuid,
			[guardRevisionLabel]: input.revision,
			[LIBRARY_COMPOSE_RELEASE_LABEL]: input.commit,
		};
		const response = await request(
			`${createUrl.pathname}${createUrl.search}`,
			{
				body: JSON.stringify({
					Cmd: ["node_modules/.bin/next", "start"],
					Env: ["LIBRARY_CONFIG_PATH=/runtime/config/library.json"],
					ExposedPorts: { [`${guardPort}/tcp`]: {} },
					HostConfig: {
						Binds: [
							`${input.configPath}:/runtime/config/library.json`,
						],
						Init: true,
						RestartPolicy: { Name: "unless-stopped" },
						SecurityOpt: ["no-new-privileges:true"],
					},
					Image: input.runtimeImage,
					Labels: labels,
					NetworkingConfig: {
						EndpointsConfig: { [initialNetwork]: {} },
					},
				}),
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				method: "POST",
			},
			[201],
		);
		const created = requireRecord(await readJson(response));
		const id = requireContainerId(created.Id);
		for (const network of input.source.networks) {
			if (network !== initialNetwork) await connectToNetwork(id, network);
		}
		await request(
			`${dockerApiVersion}/containers/${id}/start`,
			{ method: "POST" },
			[204, 304],
		);
		const container = await inspect(id);
		if (!container) {
			return guardError(
				"runtime_guard_start_failed",
				"The Evidence Library continuity guard did not start.",
			);
		}
		return requireGuard(container, input);
	};

	return {
		async ensureGuard(input) {
			const name = guardName(input.applicationUuid);
			const initialNetwork = input.source.networks.find(
				(network) => network !== "coolify",
			);
			if (!initialNetwork) {
				return guardError(
					"runtime_network_invalid",
					"The Evidence Library web networks are invalid.",
				);
			}
			let container = await inspect(name, true);
			if (container) {
				container = await connectGuardNetworks(
					requireGuard(container, input),
					input,
				);
			} else {
				container = await createGuard(name, initialNetwork, input);
			}

			for (let attempt = 0; attempt < guardStartAttempts; attempt += 1) {
				const target = await probeGuard(container, input);
				if (target) return target;
				await sleep(1_000);
				const next = await inspect(name, true);
				if (!next) break;
				container = requireGuard(next, input);
			}
			return guardError(
				"runtime_guard_start_failed",
				"The Evidence Library continuity guard did not become ready.",
			);
		},

		readApplicationWeb,

		async readGuard(input) {
			const container = await inspect(
				guardName(input.applicationUuid),
				true,
			);
			if (!container) return null;
			return await probeGuard(requireGuard(container, input), input);
		},

		async readOwnedGuard(applicationUuid) {
			const container = await inspect(guardName(applicationUuid), true);
			if (!container) return null;
			const owned = requireOwnedGuard(container, applicationUuid);
			if (owned.state.Status !== "running") return null;
			return {
				ipAddress: requireNetworkIp(owned.networks, "coolify"),
				port: guardPort,
			};
		},

		async removeGuard(applicationUuid) {
			if (!isCoolifyApplicationUuid(applicationUuid)) {
				return guardError(
					"invalid_request",
					"applicationUuid must identify one Evidence Library.",
					400,
				);
			}
			const name = guardName(applicationUuid);
			const container = await inspect(name, true);
			if (!container) return;
			requireOwnedGuard(container, applicationUuid);
			await request(
				`${dockerApiVersion}/containers/${container.id}/stop?t=10`,
				{ method: "POST" },
				[204, 304, 404],
			);
			await request(
				`${dockerApiVersion}/containers/${container.id}?v=true`,
				{ method: "DELETE" },
				[204, 404],
			);
		},
	};
}
