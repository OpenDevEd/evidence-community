import { once } from "node:events";
import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
	LIBRARY_COMPOSE_RELEASE_LABEL,
	LIBRARY_COMPOSE_SERVICES,
	type LibraryComposeService,
} from "@/lib/deployment/library-compose-contract";
import {
	createLibraryRuntimeVerifierServer,
	type LibraryRuntimeContainerFact,
	type LibraryRuntimeContainerReader,
} from "@/lib/deployment/library-runtime-verifier-http";

import {
	LibraryRuntimeGuardError,
	type LibraryRuntimeGuardManager,
} from "@/lib/deployment/library-runtime-guard";

const token = "test-runtime-verifier-token-with-at-least-32-bytes";
const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const commit = "a1b2c3d4e5f678901234567890abcdef12345678";
const runtimeImage = `ghcr.io/opendeved/evidence-library-runtime@sha256:${"b".repeat(64)}`;
const movedRuntimeImage = `ghcr.io/openscholar-ai/evidence-library-runtime@sha256:${"b".repeat(64)}`;
const runtimeImageId = `sha256:${"c".repeat(64)}`;

function publishedPort(hostPort: number, containerPort: number) {
	return {
		containerPort,
		hostIp: "0.0.0.0",
		hostPort,
		protocol: "tcp" as const,
	};
}

function readyContainers(image = runtimeImage): LibraryRuntimeContainerFact[] {
	return LIBRARY_COMPOSE_SERVICES.map((service) => ({
		health:
			service === "source-sync" || service === "source-writeback"
				? null
				: "healthy",
		labels: { [LIBRARY_COMPOSE_RELEASE_LABEL]: commit },
		imageId:
			service === "meilisearch" ? `sha256:${"d".repeat(64)}` : runtimeImageId,
		imageReference:
			service === "meilisearch" ? "getmeili/meilisearch:v1.31" : image,
		publishedPorts: service === "web" ? [publishedPort(443, 3000)] : [],
		repoDigests:
			service === "meilisearch"
				? [`getmeili/meilisearch@sha256:${"e".repeat(64)}`]
				: [image],
		service,
		state: "running",
	}));
}

async function closeServer(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function withServer<T>(
	readContainers: LibraryRuntimeContainerReader,
	run: (baseUrl: string) => Promise<T>,
	guard: LibraryRuntimeGuardManager = createGuard(),
) {
	const server = createLibraryRuntimeVerifierServer({
		guard,
		readContainers,
		token,
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("The test server did not bind to a TCP port.");
	}

	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await closeServer(server);
	}
}

function createGuard(
	overrides: Partial<LibraryRuntimeGuardManager> = {},
): LibraryRuntimeGuardManager {
	return {
		activate: vi.fn(async () => ({ status: "active" as const })),
		finalize: vi.fn(async () => ({ status: "finalized" as const })),
		prepare: vi.fn(async () => ({ status: "maintenance" as const })),
		protect: vi.fn(async () => ({ status: "protected" as const })),
		remove: vi.fn(async () => ({ status: "removed" as const })),
		routeDomains: vi.fn(async () => ({
			customOrigins: [],
			status: "routed" as const,
		})),
		...overrides,
	};
}

function readinessUrl(baseUrl: string) {
	return `${baseUrl}/v1/library-runtime/readiness`;
}

function authorizedJson(body: unknown) {
	return {
		body: JSON.stringify(body),
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	};
}

function readinessBody(image = runtimeImage) {
	return { applicationUuid, commit, runtimeImage: image };
}

function routeBody() {
	return {
		applicationUuid,
		commit,
		customOrigins: ["https://library.example.org"],
		platformOrigins: ["https://library.opendev.space"],
		revision: "library-7",
		runtimeImage,
	};
}

function expectedServiceError(
	code: string,
	message: string,
	service: LibraryComposeService,
) {
	return { error: { code, message, service } };
}

describe("library runtime verifier HTTP contract", () => {
	it.each([
		{
			method: "prepare" as const,
			path: "maintenance",
			result: { status: "maintenance" },
		},
		{
			method: "protect" as const,
			path: "protection",
			result: { status: "protected" },
		},
		{
			method: "activate" as const,
			path: "activation",
			result: { status: "active" },
		},
		{
			method: "finalize" as const,
			path: "finalization",
			result: { status: "finalized" },
		},
	])("runs the fixed $path operation", async ({ method, path, result }) => {
		const operation = vi.fn(async () => result);
		const guard = createGuard({ [method]: operation });
		await withServer(
			async () => readyContainers(),
			async (baseUrl) => {
				const response = await fetch(
					`${baseUrl}/v1/library-runtime/${path}`,
					authorizedJson(routeBody()),
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual(result);
			},
			guard,
		);
		expect(operation).toHaveBeenCalledWith(routeBody());
	});

	it("removes only the requested library guard", async () => {
		const remove = vi.fn(async () => ({ status: "removed" as const }));
		await withServer(
			async () => readyContainers(),
			async (baseUrl) => {
				const response = await fetch(
					`${baseUrl}/v1/library-runtime/removal`,
					authorizedJson({ applicationUuid }),
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ status: "removed" });
			},
			createGuard({ remove }),
		);
		expect(remove).toHaveBeenCalledWith(applicationUuid);
	});

	it("routes the requested custom domains", async () => {
		const routeDomains = vi.fn(async () => ({
			customOrigins: ["https://library.example.org"],
			status: "routed" as const,
		}));
		const sentAt = Date.now();
		await withServer(
			async () => readyContainers(),
			async (baseUrl) => {
				const response = await fetch(
					`${baseUrl}/v1/library-runtime/domains`,
					authorizedJson({
						applicationUuid,
						customOrigins: ["https://library.example.org"],
					}),
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					customOrigins: ["https://library.example.org"],
					status: "routed",
				});

				const unauthorized = await fetch(
					`${baseUrl}/v1/library-runtime/domains`,
					{
						...authorizedJson({ applicationUuid, customOrigins: [] }),
						headers: { "Content-Type": "application/json" },
					},
				);
				expect(unauthorized.status).toBe(401);

				const extraField = await fetch(
					`${baseUrl}/v1/library-runtime/domains`,
					authorizedJson({ ...routeBody() }),
				);
				expect(extraField.status).toBe(400);
				expect(await extraField.json()).toMatchObject({
					error: { code: "invalid_request" },
				});
			},
			createGuard({ routeDomains }),
		);
		expect(routeDomains).toHaveBeenCalledOnce();
		expect(routeDomains).toHaveBeenCalledWith({
			applicationUuid,
			customOrigins: ["https://library.example.org"],
			receivedAt: expect.any(Number),
		});
		const [{ receivedAt }] = routeDomains.mock.calls[0] as unknown as [
			{ receivedAt: number },
		];
		expect(receivedAt).toBeGreaterThanOrEqual(sentAt);
		expect(receivedAt).toBeLessThanOrEqual(Date.now());
	});

	it("answers 503 when the domains route misses its deadline", async () => {
		const routeDomains = vi.fn(async () => {
			throw new LibraryRuntimeGuardError(
				"runtime_route_deadline",
				"The custom-domain route was not changed because the request took too long.",
				503,
			);
		});
		await withServer(
			async () => readyContainers(),
			async (baseUrl) => {
				const response = await fetch(
					`${baseUrl}/v1/library-runtime/domains`,
					authorizedJson({ applicationUuid, customOrigins: [] }),
				);
				expect(response.status).toBe(503);
				expect(await response.json()).toMatchObject({
					error: { code: "runtime_route_deadline" },
				});
			},
			createGuard({ routeDomains }),
		);
	});

	it("returns a bounded guard failure without changing its code", async () => {
		const protect = vi.fn(async () => {
			throw new LibraryRuntimeGuardError(
				"runtime_guard_start_failed",
				"The Evidence Library continuity guard did not become ready.",
			);
		});
		await withServer(
			async () => readyContainers(),
			async (baseUrl) => {
				const response = await fetch(
					`${baseUrl}/v1/library-runtime/protection`,
					authorizedJson(routeBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual({
					error: {
						code: "runtime_guard_start_failed",
						message:
							"The Evidence Library continuity guard did not become ready.",
					},
				});
			},
			createGuard({ protect }),
		);
	});

	// Images from before and after the repositories moved from OpenDevEd to Openscholar-ai.
	it.each([runtimeImage, movedRuntimeImage])("returns validated container facts for the requested application on %s", async (image) => {
		let receivedApplicationUuid: string | undefined;
		await withServer(
			async (candidateApplicationUuid) => {
				receivedApplicationUuid = candidateApplicationUuid;
				return readyContainers(image);
			},
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody(image)),
				);

				expect(response.status).toBe(200);
				expect(response.headers.get("cache-control")).toBe("no-store");
					expect(await response.json()).toEqual({
					applicationUuid,
					commit,
					ready: true,
					runtimeImage: image,
					services: readyContainers(image).map((container) => ({
						health: container.health,
						imageId: container.imageId,
						imageReference: container.imageReference,
						publishedPorts: container.publishedPorts,
						releaseCommit: commit,
						service: container.service,
						state: container.state,
					})),
				});
			},
		);
		expect(receivedApplicationUuid).toBe(applicationUuid);
	});

	it.each([
		{ authorization: undefined, name: "missing" },
		{ authorization: "Bearer wrong-token", name: "wrong" },
	])("rejects a $name bearer token", async ({ authorization }) => {
		await withServer(async () => readyContainers(), async (baseUrl) => {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (authorization) headers.Authorization = authorization;
			const response = await fetch(readinessUrl(baseUrl), {
				body: JSON.stringify(readinessBody()),
				headers,
				method: "POST",
			});

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				error: {
					code: "unauthorized",
					message: "A valid bearer token is required.",
				},
			});
		});
	});

	it("accepts only the fixed POST endpoint and JSON content type", async () => {
		await withServer(async () => readyContainers(), async (baseUrl) => {
			const wrongMethod = await fetch(readinessUrl(baseUrl), {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(wrongMethod.status).toBe(405);
			expect(wrongMethod.headers.get("allow")).toBe("POST");

			const wrongPath = await fetch(
				`${readinessUrl(baseUrl)}/`,
				authorizedJson(readinessBody()),
			);
			expect(wrongPath.status).toBe(404);

			const healthPath = await fetch(`${baseUrl}/health`);
			expect(healthPath.status).toBe(404);

			const wrongContentType = await fetch(readinessUrl(baseUrl), {
				body: JSON.stringify(readinessBody()),
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "text/plain",
				},
				method: "POST",
			});
			expect(wrongContentType.status).toBe(415);
			expect(await wrongContentType.json()).toEqual({
				error: {
					code: "unsupported_media_type",
					message: "Content-Type must be application/json.",
				},
			});
		});
	});

	it.each([
		{
			body: "{not-json",
			code: "invalid_json",
			message: "The request body must be valid JSON.",
		},
		{
			body: JSON.stringify({ ...readinessBody(), command: "docker ps" }),
			code: "invalid_request",
			message: "Send only applicationUuid, commit and runtimeImage.",
		},
		{
			body: JSON.stringify({ ...readinessBody(), applicationUuid: "too-short" }),
			code: "invalid_request",
			message:
				"applicationUuid must be a 24-character lowercase Coolify UUID.",
		},
		{
			body: JSON.stringify({ ...readinessBody(), commit: "A".repeat(40) }),
			code: "invalid_request",
			message: "commit must be a lowercase 40-character Git commit.",
		},
		{
			body: JSON.stringify({
				...readinessBody(),
				runtimeImage: "ghcr.io/opendeved/evidence-library-runtime:main",
			}),
			code: "invalid_request",
			message:
				"runtimeImage must be the fixed Evidence Library image with a sha256 digest.",
		},
	])("returns the fixed $code input error", async (example) => {
		await withServer(async () => readyContainers(), async (baseUrl) => {
			const response = await fetch(readinessUrl(baseUrl), {
				body: example.body,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				method: "POST",
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: { code: example.code, message: example.message },
			});
		});
	});

	it("rejects a request body larger than the fixed limit", async () => {
		await withServer(async () => readyContainers(), async (baseUrl) => {
			const response = await fetch(
				readinessUrl(baseUrl),
				authorizedJson({
					...readinessBody(),
					padding: "x".repeat(5_000),
				}),
			);

			expect(response.status).toBe(413);
			expect(await response.json()).toEqual({
				error: {
					code: "payload_too_large",
					message: "The request body is too large.",
				},
			});
		});
	});

	it("rejects an unexpected Compose service without returning its name", async () => {
		await withServer(
			async () => [
				...readyContainers(),
				{
					...readyContainers()[0],
					service: "caller-controlled-secret-service",
				},
			],
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				const body = await response.text();

				expect(response.status).toBe(409);
				expect(JSON.parse(body)).toEqual({
					error: {
						code: "unexpected_service",
						message: "The runtime contains an unexpected Compose service.",
					},
				});
				expect(body).not.toContain("caller-controlled-secret-service");
			},
		);
	});

	it("rejects a missing or duplicate service", async () => {
		const containers = readyContainers();
		await withServer(
			async () => containers.filter(({ service }) => service !== "source-sync"),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"missing_service",
						"source-sync must have one container.",
						"source-sync",
					),
				);
			},
		);

		await withServer(
			async () => [...containers, containers[0]],
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"duplicate_service",
						"web must have one container.",
						"web",
					),
				);
			},
		);
	});

	it.each(LIBRARY_COMPOSE_SERVICES)(
		"rejects %s when it is not running",
		async (failedService) => {
			await withServer(
				async () =>
					readyContainers().map((container) =>
						container.service === failedService
							? { ...container, state: "exited" }
							: container,
					),
				async (baseUrl) => {
					const response = await fetch(
						readinessUrl(baseUrl),
						authorizedJson(readinessBody()),
					);
					expect(response.status).toBe(409);
					expect(await response.json()).toEqual(
						expectedServiceError(
							"service_not_running",
							`${failedService} must be running.`,
							failedService,
						),
					);
				},
			);
		},
	);

	it.each([
		"web",
		"search-indexer",
		"publication-worker",
		"meilisearch",
	] as const)("rejects %s when it is unhealthy", async (failedService) => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === failedService
						? { ...container, health: "unhealthy" }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"service_unhealthy",
						`${failedService} must be healthy.`,
						failedService,
					),
				);
			},
		);
	});

	it.each(LIBRARY_COMPOSE_SERVICES)(
		"rejects %s when its repository release label is stale",
		async (failedService) => {
			await withServer(
				async () =>
					readyContainers().map((container) =>
						container.service === failedService
							? {
									...container,
									labels: {
										[LIBRARY_COMPOSE_RELEASE_LABEL]: "b".repeat(40),
									},
								}
							: container,
					),
				async (baseUrl) => {
					const response = await fetch(
						readinessUrl(baseUrl),
						authorizedJson(readinessBody()),
					);
					expect(response.status).toBe(409);
					expect(await response.json()).toEqual(
						expectedServiceError(
							"release_mismatch",
							`${failedService} must use the requested release.`,
							failedService,
						),
					);
				},
			);
		},
	);

	it("rejects a missing repository release label", async () => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === "source-writeback"
						? { ...container, labels: {} }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"release_mismatch",
						"source-writeback must use the requested release.",
						"source-writeback",
					),
				);
			},
		);
	});

	it.each([
		{
			code: "image_reference_mismatch",
			field: "imageReference" as const,
			message: "search-indexer must use the requested runtime image reference.",
			value: "ghcr.io/opendeved/evidence-library-runtime:main",
		},
		{
			code: "image_content_mismatch",
			field: "repoDigests" as const,
			message: "search-indexer must contain the requested runtime image digest.",
			value: [],
		},
	])("rejects a runtime $field mismatch", async (example) => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === "search-indexer"
						? { ...container, [example.field]: example.value }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						example.code,
						example.message,
						"search-indexer",
					),
				);
			},
		);
	});

	it("rejects runtime services built from different image IDs", async () => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === "publication-worker"
						? { ...container, imageId: `sha256:${"f".repeat(64)}` }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"runtime_images_differ",
						"publication-worker must use the same runtime image as the other runtime services.",
						"publication-worker",
					),
				);
			},
		);
	});

	it("rejects a public Meilisearch port", async () => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === "meilisearch"
						? { ...container, publishedPorts: [publishedPort(7700, 7700)] }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"meilisearch_public_port",
						"Meilisearch must not publish a host port.",
						"meilisearch",
					),
				);
			},
		);
	});

	it("rejects a public Redis port", async () => {
		await withServer(
			async () =>
				readyContainers().map((container) =>
					container.service === "redis"
						? { ...container, publishedPorts: [publishedPort(6379, 6379)] }
						: container,
				),
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual(
					expectedServiceError(
						"redis_public_port",
						"Redis must not publish a host port.",
						"redis",
					),
				);
			},
		);
	});

	it("returns a fixed error and writes no logs when Docker inspection fails", async () => {
		const consoleError = vi.spyOn(console, "error");
		const secret = "docker-error-secret";
		await withServer(
			async () => {
				throw new Error(secret);
			},
			async (baseUrl) => {
				const response = await fetch(
					readinessUrl(baseUrl),
					authorizedJson(readinessBody()),
				);
				const body = await response.text();

				expect(response.status).toBe(502);
				expect(JSON.parse(body)).toEqual({
					error: {
						code: "runtime_inspection_failed",
						message: "The library runtime could not be checked.",
					},
				});
				expect(body).not.toContain(secret);
			},
		);
		expect(consoleError).not.toHaveBeenCalled();
	});
});
