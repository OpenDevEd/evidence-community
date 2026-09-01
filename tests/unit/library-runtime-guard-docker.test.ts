import { describe, expect, it, vi } from "vitest";

import { createDockerLibraryRuntimeGuard } from "@/lib/deployment/library-runtime-guard-docker";
import { LIBRARY_COMPOSE_RELEASE_LABEL } from "@/lib/deployment/library-compose-contract";

const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const containerId = "c".repeat(64);
const guardId = "d".repeat(64);
const commit = "a".repeat(40);
const revision = "library-7";
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

function applicationInspection(configJson: string) {
	return {
		Config: {
			Image: runtimeImage,
			Labels: {
				"com.docker.compose.project": applicationUuid,
				"com.docker.compose.service": "web",
				"coolify.managed": "true",
				"coolify.type": "application",
				[LIBRARY_COMPOSE_RELEASE_LABEL]: commit,
			},
		},
		Id: containerId,
		NetworkSettings: {
			Networks: {
				[applicationUuid]: { IPAddress: "172.18.0.9" },
				coolify: { IPAddress: "172.19.0.9" },
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
				[LIBRARY_COMPOSE_RELEASE_LABEL]: commit,
			},
		},
		Id: guardId,
		NetworkSettings: {
			Networks: {
				[applicationUuid]: { IPAddress: "172.18.0.10" },
				coolify: { IPAddress: "172.19.0.10" },
			},
		},
		State: { Health: { Status: "starting" }, Status: "running" },
	};
}

describe("Docker Evidence Library runtime guard", () => {
	it("copies the exact active config and starts one isolated web guard", async () => {
		const configJson = JSON.stringify({ revision });
		let guardExists = false;
		let coolifyConnected = false;
		let createBody: Record<string, unknown> | undefined;
		const fetchRequest = vi.fn(
			async (request: string | URL | Request, init?: RequestInit) => {
				const url = new URL(request.toString());
				if (url.hostname === "172.19.0.10") {
					return json({ active: { revision }, state: "active" });
				}
				if (url.pathname.endsWith("/containers/json")) {
					return json([{ Id: containerId }]);
				}
				if (url.pathname.endsWith(`/containers/${containerId}/json`)) {
					return json(applicationInspection(configJson));
				}
				if (
					url.pathname.endsWith(`/containers/${containerId}/archive`)
				) {
					return new Response(tarFile("library.json", configJson), {
						headers: { "Content-Type": "application/x-tar" },
					});
				}
				if (
					url.pathname.endsWith(
						`/containers/openscholar-library-guard-${applicationUuid}/json`,
					)
				) {
					return guardExists
						? json(guardInspection())
						: json({ message: "missing" }, 404);
				}
				if (url.pathname.endsWith("/containers/create")) {
					createBody = JSON.parse(init?.body as string) as Record<
						string,
						unknown
					>;
					guardExists = true;
					return json({ Id: guardId, Warnings: [] }, 201);
				}
				if (url.pathname.endsWith("/networks/coolify/connect")) {
					coolifyConnected = true;
					return new Response(null, { status: 200 });
				}
				if (url.pathname.endsWith(`/containers/${guardId}/start`)) {
					return new Response(null, { status: 204 });
				}
				if (url.pathname.endsWith(`/containers/${guardId}/json`)) {
					return json(guardInspection());
				}
				throw new Error(
					`Unexpected request: ${init?.method ?? "GET"} ${url}`,
				);
			},
		);
		const docker = createDockerLibraryRuntimeGuard({
			dockerProxyUrl: "http://docker-proxy:2375",
			fetch: fetchRequest as typeof fetch,
			sleep: async () => undefined,
		});

		const source = await docker.readApplicationWeb(input);
		expect(source).toEqual({
			configJson,
			ipAddress: "172.19.0.9",
			networks: [applicationUuid, "coolify"],
			port: 3000,
		});
		await expect(
			docker.ensureGuard({
				...input,
				configPath: `/runtime/guards/${applicationUuid}/library.json`,
				source,
			}),
		).resolves.toEqual({ ipAddress: "172.19.0.10", port: 3000 });
		expect(createBody).toMatchObject({
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
		expect(coolifyConnected).toBe(true);
		expect(createBody?.Labels).not.toHaveProperty(
			"com.docker.compose.project",
		);
		expect(createBody?.Labels).not.toHaveProperty("coolify.managed");
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
});
