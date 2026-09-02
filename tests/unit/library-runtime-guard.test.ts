import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createLibraryRuntimeGuardManager,
	renderLibraryRuntimeRoute,
	type LibraryRuntimeGuardDocker,
} from "@/lib/deployment/library-runtime-guard";

const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const commit = "a".repeat(40);
const runtimeImage = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"b".repeat(64)}`;
const input = {
	applicationUuid,
	commit,
	customOrigins: ["https://library.example.org"],
	platformOrigins: ["https://library.opendev.space"],
	revision: "library-7",
	runtimeImage,
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
	const directory = await mkdtemp(
		path.join(tmpdir(), "library-runtime-guard-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) =>
				rm(directory, { force: true, recursive: true }),
			),
	);
});

function fakeDocker(): LibraryRuntimeGuardDocker {
	return {
		ensureGuard: vi.fn(async () => ({
			ipAddress: "172.19.0.41",
			port: 3000,
			probeOrigin: "https://library.example.org",
		})),
		readApplicationWeb: vi.fn(async () => ({
			configJson: '{"revision":"library-7"}\n',
			ipAddress: "172.19.0.40",
			networks: [applicationUuid, "coolify"],
			port: 3000,
			probeOrigin: "https://library.example.org",
		})),
		readGuard: vi.fn(async () => null),
		readOwnedGuard: vi.fn(async () => ({
			ipAddress: "172.19.0.41",
			port: 3000,
			probeOrigin: "https://old-library.example.org",
		})),
		removeGuard: vi.fn(async () => undefined),
	};
}

async function fixture(docker = fakeDocker()) {
	const root = await temporaryDirectory();
	const routeDirectory = path.join(root, "routes");
	const stateDirectory = path.join(root, "state");
	return {
		docker,
		manager: createLibraryRuntimeGuardManager({
			docker,
			maintenanceUrl: "http://runtime-verifier:3001",
			routeDirectory,
			stateDirectory,
		}),
		routePath: path.join(
			routeDirectory,
			`ode-evidence-library-${applicationUuid}.yaml`,
		),
		stateDirectory,
	};
}

describe("Evidence Library runtime guard", () => {
	it("routes a first setup to maintenance without creating a guard", async () => {
		const { docker, manager, routePath } = await fixture();

		await expect(manager.prepare(input)).resolves.toEqual({
			status: "maintenance",
		});
		const route = JSON.parse(await readFile(routePath, "utf8"));
		expect(
			route.http.services[`ode-el-${applicationUuid}-maintenance`],
		).toEqual({
			loadBalancer: {
				servers: [{ url: "http://runtime-verifier:3001" }],
			},
		});
		expect(route.http.services).not.toHaveProperty(
			`ode-el-${applicationUuid}-upstream`,
		);
		expect(docker.ensureGuard).not.toHaveBeenCalled();
	});

	it("copies the active configuration before routing an update to its guard", async () => {
		const { docker, manager, routePath, stateDirectory } = await fixture();

		await expect(manager.protect(input)).resolves.toEqual({
			status: "protected",
		});
		const configPath = path.join(
			stateDirectory,
			applicationUuid,
			"library.json",
		);
		expect(await readFile(configPath, "utf8")).toBe(
			'{"revision":"library-7"}\n',
		);
		expect(docker.ensureGuard).toHaveBeenCalledWith(
			expect.objectContaining({
				...input,
				configPath,
			}),
		);
		const route = await readFile(routePath, "utf8");
		expect(route).toContain("http://172.19.0.41:3000");
		expect(route).not.toContain("http://172.19.0.40:3000");
	});

	it("reuses an existing guard without reading the replaced application", async () => {
		const docker = fakeDocker();
		docker.readGuard = vi.fn(async () => ({
			ipAddress: "172.19.0.41",
			port: 3000,
			probeOrigin: "https://library.example.org",
		}));
		const { manager, routePath } = await fixture(docker);

		await expect(manager.protect(input)).resolves.toEqual({
			status: "protected",
		});
		expect(docker.readApplicationWeb).not.toHaveBeenCalled();
		expect(docker.ensureGuard).not.toHaveBeenCalled();
		expect(await readFile(routePath, "utf8")).toContain(
			"http://172.19.0.41:3000",
		);
	});

	it("keeps the old guard as fallback during the trial cutover", async () => {
		const docker = fakeDocker();
		const { manager, routePath } = await fixture(docker);

		await manager.activate(input);
		const route = await readFile(routePath, "utf8");
		expect(route).toContain("http://172.19.0.40:3000");
		expect(route).toContain("http://172.19.0.41:3000");
		expect(docker.removeGuard).not.toHaveBeenCalled();
	});

	it("keeps the active route when deleting the old guard fails", async () => {
		const docker = fakeDocker();
		const { manager, routePath } = await fixture(docker);
		docker.removeGuard = vi.fn(async () => {
			throw new Error("guard removal failed");
		});
		await manager.protect(input);
		const protectedRoute = await readFile(routePath, "utf8");

		await expect(manager.finalize(input)).rejects.toThrow(
			"guard removal failed",
		);
		expect(await readFile(routePath, "utf8")).toBe(protectedRoute);
	});

	it("keeps the existing guard and route when the replacement cannot be read", async () => {
		const docker = fakeDocker();
		const { manager, routePath } = await fixture(docker);
		await manager.protect(input);
		const protectedRoute = await readFile(routePath, "utf8");
		docker.readApplicationWeb = vi.fn(async () => {
			throw new Error("replacement failed");
		});

		await expect(manager.activate(input)).rejects.toThrow(
			"replacement failed",
		);
		expect(await readFile(routePath, "utf8")).toBe(protectedRoute);
		expect(docker.removeGuard).not.toHaveBeenCalled();
	});

	it("removes the dynamic route before deleting the guard", async () => {
		const docker = fakeDocker();
		const { manager, routePath } = await fixture(docker);
		await manager.protect(input);
		docker.removeGuard = vi.fn(async () => {
			await expect(readFile(routePath, "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
		});

		await expect(manager.remove(applicationUuid)).resolves.toEqual({
			status: "removed",
		});
	});

	it("renders separate Cloudflare and direct-domain middleware chains", () => {
		const route = JSON.parse(
			renderLibraryRuntimeRoute({
				applicationUuid,
				commit,
				customOrigins: input.customOrigins,
				maintenanceUrl: "http://runtime-verifier:3001",
				platformOrigins: input.platformOrigins,
				revision: input.revision,
				fallbackTarget: {
					ipAddress: "172.19.0.41",
					port: 3000,
					probeOrigin: "https://old-library.example.org",
				},
				target: {
					ipAddress: "172.19.0.40",
					port: 3000,
					probeOrigin: "https://library.example.org",
				},
			}),
		);
		const routeMarker = `ode-el-${applicationUuid}-route-marker`;
		const expectedTargetHealthHeaders = {
			"X-Forwarded-Host": "library.example.org",
			"X-Forwarded-Proto": "https",
		};
		const expectedGuardHealthHeaders = {
			"X-Forwarded-Host": "old-library.example.org",
			"X-Forwarded-Proto": "https",
		};

		expect(
			route.http.routers[`ode-el-${applicationUuid}-platform-https`]
				.middlewares,
		).toContain("ode-shield-cf-origin@file");
		expect(
			route.http.routers[`ode-el-${applicationUuid}-platform-https`]
				.middlewares,
		).toContain(routeMarker);
		expect(
			route.http.routers[`ode-el-${applicationUuid}-custom-https`]
				.middlewares,
		).not.toContain("ode-shield-cf-origin@file");
		expect(
			route.http.routers[`ode-el-${applicationUuid}-custom-https`]
				.middlewares,
		).toContain(routeMarker);
		expect(
			route.http.middlewares[routeMarker].headers.customResponseHeaders,
		).toEqual({ "X-OpenScholar-Route": `${commit}:${input.revision}` });
		expect(
			route.http.services[`ode-el-${applicationUuid}-failover`],
		).toEqual({
			failover: {
				fallback: `ode-el-${applicationUuid}-guard-failover`,
				service: `ode-el-${applicationUuid}-upstream`,
			},
		});
		expect(
			route.http.services[`ode-el-${applicationUuid}-guard-failover`],
		).toEqual({
			failover: {
				fallback: `ode-el-${applicationUuid}-maintenance`,
				service: `ode-el-${applicationUuid}-guard`,
			},
		});
		expect(
			route.http.services[`ode-el-${applicationUuid}-upstream`]
				.loadBalancer.healthCheck.headers,
		).toEqual(expectedTargetHealthHeaders);
		expect(
			route.http.services[`ode-el-${applicationUuid}-guard`].loadBalancer
				.healthCheck.headers,
		).toEqual(expectedGuardHealthHeaders);
	});
});
