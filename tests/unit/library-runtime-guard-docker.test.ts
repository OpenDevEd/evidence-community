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

function dockerFetchFixture(configJson: string) {
	let guardExists = false;
	const connectedNetworks = new Set<string>();
	let createBody: Record<string, unknown> | undefined;
	const handlers = new Map<string, (init?: RequestInit) => Response>([
		["/v1.41/containers/json", () => json([{ Id: containerId }])],
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
				guardExists
					? json(guardInspection())
					: json({ message: "missing" }, 404),
		],
		[
			"/v1.41/containers/create",
			(init) => {
				createBody = JSON.parse(init?.body as string) as Record<
					string,
					unknown
				>;
				guardExists = true;
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
			() => new Response(null, { status: 204 }),
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

	it("refuses to preserve a web container with a different revision", async () => {
		const configJson = JSON.stringify({ revision: "other-revision" });
		const fetchRequest = vi.fn(async (request: string | URL | Request) => {
			const url = new URL(request.toString());
			if (url.pathname.endsWith("/containers/json")) {
				return json([{ Id: containerId }]);
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
				fetch: webLabelFetch({
					[`traefik.http.routers.${service}.service`]: service,
					[`traefik.http.services.${service}.loadbalancer.server.port`]:
						"3000",
					[`traefik.http.services.https-1-${applicationUuid}-web-2567.loadbalancer.server.port`]:
						"3000",
					[`traefik.http.services.http-0-${applicationUuid}-web-2567.loadbalancer.server.port`]:
						"3000",
				}),
			});

			await expect(
				docker.readApplicationWebService(applicationUuid),
			).resolves.toBe(service);
		},
	);

	it("refuses a web service without a Coolify platform service", async () => {
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: webLabelFetch({
				[`traefik.http.services.https-1-${applicationUuid}-web-2567.loadbalancer.server.port`]:
					"3000",
			}),
		});

		await expect(
			docker.readApplicationWebService(applicationUuid),
		).rejects.toMatchObject({ code: "runtime_web_route_missing", status: 409 });
	});

	it("refuses when the library has no web container", async () => {
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: (async () => json([])) as typeof fetch,
		});

		await expect(
			docker.readApplicationWebService(applicationUuid),
		).rejects.toMatchObject({ code: "runtime_web_not_ready", status: 409 });
	});
});

function webLabelFetch(routeLabels: Record<string, string>) {
	return (async (request: string | URL | Request) => {
		const url = new URL(request.toString());
		if (url.pathname === "/v1.41/containers/json") {
			return json([{ Id: containerId }]);
		}
		if (url.pathname === `/v1.41/containers/${containerId}/json`) {
			return json(applicationInspection("{}", routeLabels));
		}
		throw new Error(`Unexpected request: ${url}`);
	}) as typeof fetch;
}
