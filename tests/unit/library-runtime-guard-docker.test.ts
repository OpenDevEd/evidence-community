import { describe, expect, it, vi } from "vitest";

import { createDockerLibraryRuntimeGuard } from "@/lib/deployment/library-runtime-guard-docker";
import { LIBRARY_COMPOSE_RELEASE_LABEL } from "@/lib/deployment/library-compose-contract";

const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const containerId = "c".repeat(64);
const guardId = "d".repeat(64);
const commit = "a".repeat(40);
const revision = "library-7";
const canonicalOrigin = "https://evidence.example.org";
const privateNetwork = `${applicationUuid}_private`;
const runtimeImage = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"b".repeat(64)}`;
const input = {
	applicationUuid,
	commit,
	customOrigins: ["https://library.example.org"],
	platformOrigins: ["https://library.opendev.space"],
	revision,
	runtimeImage,
};

function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
		status,
	});
}

function tarFile(name: string, content: string) {
	const data = Buffer.from(content);
	const result = Buffer.alloc(
		512 + Math.ceil(data.length / 512) * 512 + 1024,
	);
	result.write(name, 0, 100, "utf8");
	result.write(data.length.toString(8).padStart(11, "0"), 124, 11, "ascii");
	result[135] = 0;
	result[156] = "0".charCodeAt(0);
	data.copy(result, 512);
	return result;
}

function applicationInspection(
	configJson: string,
	routeLabels: Record<string, string> = {},
) {
	return {
		Config: {
			Image: runtimeImage,
			Labels: {
				"com.docker.compose.project": applicationUuid,
				"com.docker.compose.service": "web",
				"coolify.managed": "true",
				"coolify.type": "application",
				[LIBRARY_COMPOSE_RELEASE_LABEL]: commit,
				...routeLabels,
			},
		},
		Id: containerId,
		NetworkSettings: {
			Networks: {
				[applicationUuid]: { IPAddress: "172.18.0.9" },
				coolify: { IPAddress: "172.19.0.9" },
				[privateNetwork]: { IPAddress: "172.20.0.9" },
			},
		},
		State: { Health: { Status: "healthy" }, Status: "running" },
		configJson,
	};
}

function guardInspection() {
	return {
		Config: {
			Image: runtimeImage,
			Labels: {
				"org.opendeved.evidence-library.guard": "true",
				"org.opendeved.evidence-library.guard.application":
					applicationUuid,
				"org.opendeved.evidence-library.guard.revision": revision,
				"org.opendeved.evidence-library.guard.probe-origin":
					canonicalOrigin,
				[LIBRARY_COMPOSE_RELEASE_LABEL]: commit,
			},
		},
		Id: guardId,
		NetworkSettings: {
			Networks: {
				[applicationUuid]: { IPAddress: "172.18.0.10" },
				coolify: { IPAddress: "172.19.0.10" },
				[privateNetwork]: { IPAddress: "172.20.0.10" },
			},
		},
		State: { Health: { Status: "starting" }, Status: "running" },
	};
}

/** A guard an earlier hand-off created for another revision and never started. */
const staleGuardId = "e".repeat(64);
function staleGuardInspection() {
	const guard = guardInspection();
	return {
		...guard,
		Config: { ...guard.Config, Labels: { ...guard.Config.Labels, "org.opendeved.evidence-library.guard.revision": "library-6" } },
		Id: staleGuardId,
		State: { Status: "created" },
	};
}

function dockerFetchFixture(configJson: string, { staleGuard = false, unstartedGuard = false, createdMeanwhile = false } = {}) {
	let guardExists = unstartedGuard;
	let guardRunning = !unstartedGuard;
	let stale = staleGuard;
	const removed: string[] = [];
	const started: string[] = [];
	const connectedNetworks = new Set<string>();
	let createBody: Record<string, unknown> | undefined;
	const handlers = new Map<string, (init?: RequestInit) => Response>([
		["/v1.41/containers/json", () => json([{ Id: containerId, State: "running" }])],
		[
			`/v1.41/containers/${containerId}/json`,
			() => json(applicationInspection(configJson)),
		],
		[
			`/v1.41/containers/${containerId}/archive`,
			() =>
				new Response(tarFile("library.json", configJson), {
					headers: { "Content-Type": "application/x-tar" },
				}),
		],
		[
			`/v1.41/containers/openscholar-library-guard-${applicationUuid}/json`,
			() =>
				stale
					? json(staleGuardInspection())
					: guardExists
						? json({ ...guardInspection(), State: guardRunning ? guardInspection().State : { Status: "created" } })
						: json({ message: "missing" }, 404),
		],
		[`/v1.41/containers/${staleGuardId}/stop`, () => new Response(null, { status: 304 })],
		[
			`/v1.41/containers/${staleGuardId}`,
			(init) => {
				if (init?.method === "DELETE") {
					stale = false;
					removed.push(staleGuardId);
				}
				return new Response(null, { status: 204 });
			},
		],
		[
			"/v1.41/containers/create",
			(init) => {
				guardExists = true;
				// Another request for this revision created the guard first; it has not started it yet.
				if (createdMeanwhile) {
					guardRunning = false;
					return json({ message: "Conflict. The container name is already in use." }, 409);
				}
				createBody = JSON.parse(init?.body as string) as Record<
					string,
					unknown
				>;
				return json({ Id: guardId, Warnings: [] }, 201);
			},
		],
		[
			"/v1.41/networks/coolify/connect",
			() => {
				connectedNetworks.add("coolify");
				return new Response(null, { status: 200 });
			},
		],
		[
			`/v1.41/networks/${privateNetwork}/connect`,
			() => {
				connectedNetworks.add(privateNetwork);
				return new Response(null, { status: 200 });
			},
		],
		[
			`/v1.41/containers/${guardId}/start`,
			() => {
				started.push(guardId);
				guardRunning = true;
				return new Response(null, { status: 204 });
			},
		],
		[`/v1.41/containers/${guardId}/json`, () => json(guardInspection())],
	]);
	const fetchRequest = vi.fn(
		async (request: string | URL | Request, init?: RequestInit) => {
			const url = new URL(request.toString());
			if (url.hostname === "172.19.0.10") {
				if (
					new Headers(init?.headers).get("x-forwarded-host") !==
					new URL(canonicalOrigin).host
				) {
					return new Response(null, {
						headers: {
							Location:
								"https://library.opendev.space/api/library-config/health",
						},
						status: 308,
					});
				}
				return json({ active: { revision }, state: "active" });
			}
			const handler = handlers.get(url.pathname);
			if (!handler) {
				throw new Error(
					`Unexpected request: ${init?.method ?? "GET"} ${url}`,
				);
			}
			return handler(init);
		},
	);
	return {
		fetchRequest,
		get connectedNetworks() {
			return connectedNetworks;
		},
		get createBody() {
			return createBody;
		},
		removed,
		started,
	};
}

describe("Docker Evidence Library runtime guard", () => {
	it("copies the exact active config and starts one isolated web guard", async () => {
		const configJson = JSON.stringify({
			identity: { baseUrl: canonicalOrigin },
			revision,
		});
		const fixture = dockerFetchFixture(configJson);
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: fixture.fetchRequest as typeof fetch,
			sleep: async () => undefined,
		});

		const source = await docker.readApplicationWeb(input);
		expect(source).toEqual({
			configJson,
			ipAddress: "172.19.0.9",
			networks: [applicationUuid, privateNetwork, "coolify"],
			port: 3000,
			probeOrigin: canonicalOrigin,
		});
		await expect(
			docker.ensureGuard({
				...input,
				configPath: `/runtime/guards/${applicationUuid}/library.json`,
				source,
			}),
		).resolves.toEqual({
			ipAddress: "172.19.0.10",
			port: 3000,
			probeOrigin: canonicalOrigin,
		});
		expect(fixture.createBody).toMatchObject({
			Cmd: ["node_modules/.bin/next", "start"],
			Env: ["LIBRARY_CONFIG_PATH=/runtime/config/library.json"],
			HostConfig: {
				Init: true,
				SecurityOpt: ["no-new-privileges:true"],
			},
			Image: runtimeImage,
			NetworkingConfig: {
				EndpointsConfig: {
					[applicationUuid]: {},
				},
			},
		});
		expect([...fixture.connectedNetworks].sort()).toEqual([
			privateNetwork,
			"coolify",
		]);
		expect(fixture.createBody?.Labels).not.toHaveProperty(
			"com.docker.compose.project",
		);
		expect(fixture.createBody?.Labels).toMatchObject({
			"org.opendeved.evidence-library.guard.probe-origin":
				canonicalOrigin,
		});
		expect(fixture.createBody?.Labels).not.toHaveProperty(
			"coolify.managed",
		);
	});

	it("replaces a guard an earlier hand-off created but never started", async () => {
		const configJson = JSON.stringify({ identity: { baseUrl: canonicalOrigin }, revision });
		const fixture = dockerFetchFixture(configJson, { staleGuard: true });
		const docker = createDockerLibraryRuntimeGuard({ dockerProxyUrl: "http://docker-proxy:2375", fetch: fixture.fetchRequest as typeof fetch, sleep: async () => undefined });
		const source = await docker.readApplicationWeb(input);
		await expect(docker.ensureGuard({ ...input, configPath: `/runtime/guards/${applicationUuid}/library.json`, source })).resolves.toEqual({
			ipAddress: "172.19.0.10",
			port: 3000,
			probeOrigin: canonicalOrigin,
		});
		expect(fixture.removed).toEqual([staleGuardId]);
		expect(fixture.createBody?.Labels).toMatchObject({ "org.opendeved.evidence-library.guard.revision": revision });
	});

	it("starts this revision's guard when another request created it and has not started it yet", async () => {
		const configJson = JSON.stringify({ identity: { baseUrl: canonicalOrigin }, revision });
		const fixture = dockerFetchFixture(configJson, { unstartedGuard: true });
		const docker = createDockerLibraryRuntimeGuard({ dockerProxyUrl: "http://docker-proxy:2375", fetch: fixture.fetchRequest as typeof fetch, sleep: async () => undefined });
		const source = await docker.readApplicationWeb(input);
		await expect(docker.ensureGuard({ ...input, configPath: `/runtime/guards/${applicationUuid}/library.json`, source })).resolves.toMatchObject({ ipAddress: "172.19.0.10" });
		expect(fixture.started).toEqual([guardId]);
		expect(fixture.removed).toEqual([]);
		expect(fixture.createBody).toBeUndefined();
	});

	it("uses the guard another request created after this one replaced a stale guard", async () => {
		const configJson = JSON.stringify({ identity: { baseUrl: canonicalOrigin }, revision });
		const fixture = dockerFetchFixture(configJson, { staleGuard: true, createdMeanwhile: true });
		const docker = createDockerLibraryRuntimeGuard({ dockerProxyUrl: "http://docker-proxy:2375", fetch: fixture.fetchRequest as typeof fetch, sleep: async () => undefined });
		const source = await docker.readApplicationWeb(input);
		await expect(docker.ensureGuard({ ...input, configPath: `/runtime/guards/${applicationUuid}/library.json`, source })).resolves.toMatchObject({ ipAddress: "172.19.0.10" });
		expect(fixture.removed).toEqual([staleGuardId]);
		expect(fixture.started).toEqual([guardId]);
	});

	it("refuses to preserve a web container with a different revision", async () => {
		const configJson = JSON.stringify({ revision: "other-revision" });
		const fetchRequest = vi.fn(async (request: string | URL | Request) => {
			const url = new URL(request.toString());
			if (url.pathname.endsWith("/containers/json")) {
				return json([{ Id: containerId, State: "running" }]);
			}
			if (url.pathname.endsWith(`/containers/${containerId}/json`)) {
				return json(applicationInspection(configJson));
			}
			return new Response(tarFile("library.json", configJson), {
				headers: { "Content-Type": "application/x-tar" },
			});
		});
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: fetchRequest as typeof fetch,
		});

		await expect(docker.readApplicationWeb(input)).rejects.toMatchObject({
			code: "runtime_revision_mismatch",
		});
	});

	it.each([
		["current", `https-0-${applicationUuid}-web-2567`],
		["legacy unsuffixed", `https-0-${applicationUuid}`],
	])(
		"reads the %s Coolify platform service name from the web labels",
		async (_label, service) => {
			const docker = createDockerLibraryRuntimeGuard({
				dockerProxyUrl: "http://docker-proxy:2375",
				fetch: webLabelFetch([
					{
						id: containerId,
						labels: {
							[`traefik.http.routers.${service}.service`]: service,
							[platformServiceLabel(service)]: "3000",
							[platformServiceLabel(
								`https-1-${applicationUuid}-web-2567`,
							)]: "3000",
							[platformServiceLabel(
								`http-0-${applicationUuid}-web-2567`,
							)]: "3000",
						},
					},
				]),
			});

			await expect(
				docker.readApplicationWebService(applicationUuid),
			).resolves.toBe(service);
		},
	);

	it("reads the running web service next to an exited one", async () => {
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: webLabelFetch([
				{
					id: guardId,
					labels: {
						[platformServiceLabel(`https-0-${applicationUuid}`)]:
							"3000",
					},
					state: "exited",
				},
				{
					health: null,
					id: containerId,
					labels: {
						[platformServiceLabel(
							`https-0-${applicationUuid}-web-2567`,
						)]: "3000",
					},
				},
			]),
		});

		await expect(
			docker.readApplicationWebService(applicationUuid),
		).resolves.toBe(`https-0-${applicationUuid}-web-2567`);
	});

	it.each<[string, Partial<WebContainer>[]]>([
		["no web container", []],
		["only an exited web container", [{ state: "exited" }]],
		["a starting web container", [{ health: "starting" }]],
		["an unhealthy web container", [{ health: "unhealthy" }]],
	])("refuses %s", async (_label, containers) => {
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: webLabelFetch(
				containers.map((container) => ({
					id: containerId,
					labels: {
						[platformServiceLabel(
							`https-0-${applicationUuid}-web-2567`,
						)]: "3000",
					},
					...container,
				})),
			),
		});

		await expect(
			docker.readApplicationWebService(applicationUuid),
		).rejects.toMatchObject({ code: "runtime_web_not_ready", status: 409 });
	});

	it("refuses a web service without a Coolify platform service", async () => {
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: webLabelFetch([
				{
					id: containerId,
					labels: {
						[platformServiceLabel(
							`https-1-${applicationUuid}-web-2567`,
						)]: "3000",
					},
				},
			]),
		});

		await expect(
			docker.readApplicationWebService(applicationUuid),
		).rejects.toMatchObject({ code: "runtime_web_route_missing", status: 409 });
	});
});

function platformServiceLabel(service: string) {
	return `traefik.http.services.${service}.loadbalancer.server.port`;
}

type WebContainer = {
	health?: string | null;
	id: string;
	labels: Record<string, string>;
	state?: string;
};

function webLabelFetch(containers: readonly WebContainer[]) {
	return (async (request: string | URL | Request) => {
		const url = new URL(request.toString());
		if (url.pathname === "/v1.41/containers/json") {
			return json(
				containers.map(({ id, state = "running" }) => ({
					Id: id,
					State: state,
				})),
			);
		}
		const container = containers.find(
			({ id }) => url.pathname === `/v1.41/containers/${id}/json`,
		);
		if (!container) throw new Error(`Unexpected request: ${url}`);
		const health =
			container.health === undefined ? "healthy" : container.health;
		return json({
			...applicationInspection("{}", container.labels),
			Id: container.id,
			State: {
				...(health ? { Health: { Status: health } } : {}),
				Status: container.state ?? "running",
			},
		});
	}) as typeof fetch;
}
