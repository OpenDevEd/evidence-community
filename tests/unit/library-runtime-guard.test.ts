import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createLibraryRuntimeGuardManager,
	renderLibraryDomainsRoute,
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
		readApplicationWebService: vi.fn(
			async () => `https-0-${applicationUuid}-web-2567`,
		),
		readGuard: vi.fn(async () => null),
		readOwnedGuard: vi.fn(async () => ({
			ipAddress: "172.19.0.41",
			port: 3000,
			probeOrigin: "https://old-library.example.org",
		})),
		removeGuard: vi.fn(async () => undefined),
	};
}

async function fixture(docker = fakeDocker(), now?: () => number) {
	const root = await temporaryDirectory();
	const routeDirectory = path.join(root, "routes");
	const stateDirectory = path.join(root, "state");
	return {
		docker,
		manager: createLibraryRuntimeGuardManager({
			docker,
			maintenanceUrl: "http://runtime-verifier:3001",
			now,
			routeDirectory,
			stateDirectory,
		}),
		routePath: path.join(
			routeDirectory,
			`ode-evidence-library-${applicationUuid}.yaml`,
		),
		domainsPath: path.join(
			routeDirectory,
			`ode-evidence-library-domains-${applicationUuid}.yaml`,
		),
		stateDirectory,
	};
}

async function readRoute(filePath: string) {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function expectMissing(filePath: string) {
	await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
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

	it("removes both dynamic routes before deleting the guard", async () => {
		const docker = fakeDocker();
		const { domainsPath, manager, routePath } = await fixture(docker);
		await manager.protect(input);
		await manager.routeDomains({
			applicationUuid,
			receivedAt: Date.now(),
			customOrigins: input.customOrigins,
		});
		docker.removeGuard = vi.fn(async () => {
			await expectMissing(routePath);
			await expectMissing(domainsPath);
		});

		await expect(manager.remove(applicationUuid)).resolves.toEqual({
			status: "removed",
		});
		expect(docker.removeGuard).toHaveBeenCalledOnce();
	});

	it("routes custom domains to Coolify's platform service below the guard", async () => {
		const { domainsPath, manager } = await fixture();

		await expect(
			manager.routeDomains({
				applicationUuid,
				receivedAt: Date.now(),
				customOrigins: [
					"https://Library.Example.org",
					"https://evidence.example.com",
				],
			}),
		).resolves.toEqual({
			customOrigins: [
				"https://library.example.org",
				"https://evidence.example.com",
			],
			status: "routed",
		});
		const name = `ode-el-${applicationUuid}-domains`;
		const rule =
			"Host(`library.example.org`) || Host(`evidence.example.com`)";
		expect(await readRoute(domainsPath)).toEqual({
			http: {
				middlewares: {
					[`${name}-https-redirect`]: {
						redirectScheme: { permanent: true, scheme: "https" },
					},
				},
				routers: {
					[`${name}-http`]: {
						entryPoints: ["http"],
						middlewares: [`${name}-https-redirect`],
						priority: 100_000,
						rule,
						service: "noop@internal",
					},
					[`${name}-https`]: {
						entryPoints: ["https"],
						middlewares: [
							"ode-shield-rate-direct@file",
							"ode-shield-inflight@file",
							"ode-library-shield@file",
						],
						priority: 100_000,
						rule,
						service: `https-0-${applicationUuid}-web-2567@docker`,
						tls: { certResolver: "letsencrypt" },
					},
				},
			},
		});
	});

	it("keeps the permanent route below the guard route", async () => {
		const { domainsPath, manager, routePath } = await fixture();
		await manager.routeDomains({
			applicationUuid,
			receivedAt: Date.now(),
			customOrigins: input.customOrigins,
		});
		await manager.protect(input);

		const guard = await readRoute(routePath);
		const domains = await readRoute(domainsPath);
		const prefix = `ode-el-${applicationUuid}`;
		expect(
			domains.http.routers[`${prefix}-domains-https`].priority,
		).toBeLessThan(guard.http.routers[`${prefix}-custom-https`].priority);
		expect(
			domains.http.routers[`${prefix}-domains-http`].priority,
		).toBeLessThan(guard.http.routers[`${prefix}-http`].priority);
	});

	it("releases removed hosts below custom routes and above Coolify labels", async () => {
		const { domainsPath, manager } = await fixture();
		const route = (customOrigins: string[]) =>
			manager.routeDomains({
				applicationUuid,
				customOrigins,
				receivedAt: Date.now(),
			});
		const name = `ode-el-${applicationUuid}-domains`;
		// Traefik gives a label router its rule length as priority.
		const longestCoolifyRule = `Host(\`${"a".repeat(253)}\`) && PathPrefix(\`/\`)`;

		await route(["https://kept.example.org", "https://gone.example.org"]);
		await route(["https://kept.example.org"]);

		const { middlewares, routers, services } = (await readRoute(domainsPath))
			.http;
		expect(routers[`${name}-https`].rule).toBe("Host(`kept.example.org`)");
		for (const entryPoint of ["http", "https"]) {
			const released = routers[`${name}-released-${entryPoint}`];
			expect(released).toMatchObject({
				entryPoints: [entryPoint],
				rule: "Host(`gone.example.org`)",
				service: `${name}-released`,
			});
			expect(released.priority).toBeLessThan(
				routers[`${name}-https`].priority,
			);
			expect(released.priority).toBeGreaterThan(longestCoolifyRule.length);
			expect(released.middlewares).toContain(`${name}-released-page`);
		}
		expect(routers[`${name}-released-https`].tls).toEqual({
			certResolver: "letsencrypt",
		});
		expect(middlewares[`${name}-released-page`]).toEqual({
			replacePath: { path: "/released" },
		});
		expect(services[`${name}-released`]).toEqual({
			loadBalancer: { servers: [{ url: "http://runtime-verifier:3001" }] },
		});

		await route([]);
		const releasedOnly = (await readRoute(domainsPath)).http.routers;
		expect(Object.keys(releasedOnly).sort()).toEqual([
			`${name}-released-http`,
			`${name}-released-https`,
		]);
		expect(releasedOnly[`${name}-released-https`].rule).toBe(
			"Host(`kept.example.org`) || Host(`gone.example.org`)",
		);
	});

	it("moves a re-added host back to the custom route and keeps other released hosts", async () => {
		const { domainsPath, manager } = await fixture();
		const route = (customOrigins: string[]) =>
			manager.routeDomains({
				applicationUuid,
				customOrigins,
				receivedAt: Date.now(),
			});
		const name = `ode-el-${applicationUuid}-domains`;

		await route(["https://one.example.org", "https://two.example.org"]);
		await route([]);
		await route(["https://two.example.org"]);

		const { routers } = (await readRoute(domainsPath)).http;
		expect(routers[`${name}-https`].rule).toBe("Host(`two.example.org`)");
		expect(routers[`${name}-released-https`].rule).toBe(
			"Host(`one.example.org`)",
		);
	});

	it("keeps only the twenty most recently released hosts", async () => {
		const { domainsPath, manager } = await fixture();
		const origins = (prefix: string) =>
			Array.from(
				{ length: 20 },
				(_, index) => `https://${prefix}-${index}.example.org`,
			);
		const route = (customOrigins: string[]) =>
			manager.routeDomains({
				applicationUuid,
				customOrigins,
				receivedAt: Date.now(),
			});

		await route(origins("older"));
		await route(origins("newer"));
		await route([]);

		const { routers } = (await readRoute(domainsPath)).http;
		expect(routers[`ode-el-${applicationUuid}-domains-released-https`].rule).toBe(
			origins("newer")
				.map((origin) => `Host(\`${new URL(origin).hostname}\`)`)
				.join(" || "),
		);
	});

	it("drops released hosts at finalization and deletes a file with no hosts", async () => {
		const { domainsPath, manager } = await fixture();
		await manager.routeDomains({
			applicationUuid,
			customOrigins: ["https://gone.example.org", ...input.customOrigins],
			receivedAt: Date.now(),
		});
		await manager.routeDomains({
			applicationUuid,
			customOrigins: input.customOrigins,
			receivedAt: Date.now(),
		});

		await manager.finalize(input);
		expect(
			Object.keys((await readRoute(domainsPath)).http.routers).sort(),
		).toEqual([
			`ode-el-${applicationUuid}-domains-http`,
			`ode-el-${applicationUuid}-domains-https`,
		]);

		await manager.finalize({ ...input, customOrigins: [] });
		await expectMissing(domainsPath);
		await expect(
			manager.routeDomains({
				applicationUuid,
				customOrigins: [],
				receivedAt: Date.now(),
			}),
		).resolves.toEqual({ customOrigins: [], status: "routed" });
		await expectMissing(domainsPath);
	});

	it.each([
		["text that is not JSON", "not json\n"],
		["a file without routers", '{"http":{}}\n'],
		[
			"a template host",
			JSON.stringify({
				http: {
					routers: {
						[`ode-el-${applicationUuid}-domains-https`]: {
							rule: "Host(`{{.example.org`)",
						},
					},
				},
			}),
		],
	])(
		"refuses to replace a previous route holding %s",
		async (_label, content) => {
			const { domainsPath, manager } = await fixture();
			await mkdir(path.dirname(domainsPath), { recursive: true });
			await writeFile(domainsPath, content);

			await expect(
				manager.routeDomains({
					applicationUuid,
					customOrigins: input.customOrigins,
					receivedAt: Date.now(),
				}),
			).rejects.toMatchObject({
				code: "runtime_domains_route_unreadable",
				status: 500,
			});
			expect(await readFile(domainsPath, "utf8")).toBe(content);
		},
	);

	it.each([
		["an HTTP origin", ["http://library.example.org"]],
		["a port", ["https://library.example.org:8443"]],
		["a path", ["https://library.example.org/library"]],
		["user information", ["https://user@library.example.org"]],
		["a Traefik template delimiter", ["https://{{.example.org"]],
		["a closing template delimiter", ["https://a}}.example.org"]],
		["a backtick", ["https://ex`ample.org"]],
		["an underscore", ["https://a_b.example.org"]],
		["an empty label", ["https://a..example.org"]],
		["a trailing dot", ["https://library.example.org."]],
		["a single-label host", ["https://localhost"]],
		["an IP address", ["https://192.0.2.1"]],
		["a label longer than 63 characters", [`https://${"a".repeat(64)}.org`]],
		[
			"a duplicate host",
			["https://library.example.org", "https://LIBRARY.example.org"],
		],
		[
			"more than twenty origins",
			Array.from(
				{ length: 21 },
				(_, index) => `https://library-${index}.example.org`,
			),
		],
	])("refuses %s without writing a route", async (_label, customOrigins) => {
		const { docker, domainsPath, manager } = await fixture();

		await expect(
			manager.routeDomains({
				applicationUuid,
				customOrigins,
				receivedAt: Date.now(),
			}),
		).rejects.toMatchObject({ code: "invalid_request", status: 400 });
		expect(docker.readApplicationWebService).not.toHaveBeenCalled();
		await expectMissing(domainsPath);
	});

	it.each([
		["a new host set", ["https://new.example.org"]],
		["an empty host set", []],
	])(
		"does not write %s after the 20-second deadline",
		async (_label, customOrigins) => {
			let clock = 1_000_000;
			const docker = fakeDocker();
			const { domainsPath, manager } = await fixture(docker, () => clock);
			await manager.routeDomains({
				applicationUuid,
				customOrigins: ["https://old.example.org"],
				receivedAt: clock,
			});
			const current = await readFile(domainsPath, "utf8");
			const receivedAt = clock;
			docker.readApplicationWebService = vi.fn(async () => {
				clock += 20_001;
				return `https-0-${applicationUuid}-web-2567`;
			});
			if (customOrigins.length === 0) clock += 20_001;

			await expect(
				manager.routeDomains({ applicationUuid, customOrigins, receivedAt }),
			).rejects.toMatchObject({
				code: "runtime_route_deadline",
				status: 503,
			});
			expect(await readFile(domainsPath, "utf8")).toBe(current);
		},
	);

	it("writes a route that finishes inside the deadline", async () => {
		let clock = 1_000_000;
		const docker = fakeDocker();
		const { domainsPath, manager } = await fixture(docker, () => clock);
		docker.readApplicationWebService = vi.fn(async () => {
			clock += 19_999;
			return `https-0-${applicationUuid}-web-2567`;
		});

		await expect(
			manager.routeDomains({
				applicationUuid,
				customOrigins: input.customOrigins,
				receivedAt: clock,
			}),
		).resolves.toMatchObject({ status: "routed" });
		expect(await readFile(domainsPath, "utf8")).toContain(
			"Host(`library.example.org`)",
		);
	});

	it("accepts punycode hosts", async () => {
		const { manager } = await fixture();

		await expect(
			manager.routeDomains({
				applicationUuid,
				receivedAt: Date.now(),
				customOrigins: ["https://Bücher.example"],
			}),
		).resolves.toEqual({
			customOrigins: ["https://xn--bcher-kva.example"],
			status: "routed",
		});
	});

	it("refuses a template host in the guard route without writing it", async () => {
		const { manager, routePath } = await fixture();

		await expect(
			manager.prepare({
				...input,
				platformOrigins: ["https://{{.opendev.space"],
			}),
		).rejects.toMatchObject({ code: "invalid_request", status: 400 });
		await expectMissing(routePath);
	});

	it("never renders a host that could break the Traefik file", () => {
		expect(() =>
			renderLibraryDomainsRoute({
				applicationUuid,
				custom: {
					dockerService: `https-0-${applicationUuid}`,
					origins: ["https://{{.example.org"],
				},
				maintenanceUrl: "http://runtime-verifier:3001",
				releasedHosts: [],
			}),
		).toThrow("A route host is not a plain DNS name.");
		expect(() =>
			renderLibraryDomainsRoute({
				applicationUuid,
				maintenanceUrl: "http://runtime-verifier:3001",
				releasedHosts: ["ex`ample.org"],
			}),
		).toThrow("A route host is not a plain DNS name.");
		expect(() =>
			renderLibraryRuntimeRoute({
				applicationUuid,
				commit,
				customOrigins: ["https://ex`ample.org"],
				maintenanceUrl: "http://runtime-verifier:3001",
				platformOrigins: input.platformOrigins,
				revision: input.revision,
			}),
		).toThrow("A route host is not a plain DNS name.");
	});

	it("refuses an unknown application", async () => {
		const { docker, manager } = await fixture();

		await expect(
			manager.routeDomains({
				applicationUuid: "../../etc",
				receivedAt: Date.now(),
				customOrigins: input.customOrigins,
			}),
		).rejects.toMatchObject({ code: "invalid_request", status: 400 });
		expect(docker.readApplicationWebService).not.toHaveBeenCalled();
	});

	it("writes the permanent route from the new web service before removing the guard route", async () => {
		const docker = fakeDocker();
		const { domainsPath, manager, routePath } = await fixture(docker);
		await manager.routeDomains({
			applicationUuid,
			receivedAt: Date.now(),
			customOrigins: ["https://old.example.org"],
		});
		await manager.protect(input);
		docker.readApplicationWebService = vi.fn(
			async () => `https-0-${applicationUuid}-web-9999`,
		);
		docker.removeGuard = vi.fn(async () => {
			await access(routePath);
			const domains = await readRoute(domainsPath);
			expect(
				domains.http.routers[`ode-el-${applicationUuid}-domains-https`],
			).toMatchObject({
				rule: "Host(`library.example.org`)",
				service: `https-0-${applicationUuid}-web-9999@docker`,
			});
		});

		await expect(manager.finalize(input)).resolves.toEqual({
			status: "finalized",
		});
		expect(docker.removeGuard).toHaveBeenCalledOnce();
		await expectMissing(routePath);
	});

	it("keeps the guard route when the web service has no platform route", async () => {
		const docker = fakeDocker();
		const { domainsPath, manager, routePath } = await fixture(docker);
		await manager.protect(input);
		const protectedRoute = await readFile(routePath, "utf8");
		docker.readApplicationWebService = vi.fn(async () => {
			throw new Error("platform route missing");
		});

		await expect(manager.finalize(input)).rejects.toThrow(
			"platform route missing",
		);
		expect(await readFile(routePath, "utf8")).toBe(protectedRoute);
		await expectMissing(domainsPath);
		expect(docker.removeGuard).not.toHaveBeenCalled();
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
