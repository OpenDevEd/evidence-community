import { once } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

import { describe, expect, it } from "vitest";

import { LIBRARY_COMPOSE_RELEASE_LABEL } from "@/lib/deployment/library-compose-contract";
import { createDockerLibraryRuntimeContainerReader } from "../../tools/runLibraryRuntimeVerifier";

const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const containerId = "a".repeat(64);
const commit = "b".repeat(40);
const rejectedSummaryLabels: ReadonlyArray<{
	labels: Record<string, string>;
	name: string;
}> = [
	{
		labels: { "com.docker.compose.project": "z".repeat(24) },
		name: "another Compose project",
	},
	{
		labels: { "coolify.managed": "false" },
		name: "an unmanaged container",
	},
	{
		labels: { "coolify.type": "service" },
		name: "a non-application Coolify container",
	},
];

function containerLabels(overrides: Record<string, string> = {}) {
	return {
		"com.docker.compose.project": applicationUuid,
		"com.docker.compose.service": "web",
		"coolify.managed": "true",
		"coolify.type": "application",
		[LIBRARY_COMPOSE_RELEASE_LABEL]: commit,
		...overrides,
	};
}

function containerSummary(overrides: Record<string, unknown> = {}) {
	return {
		Id: containerId,
		Labels: containerLabels(),
		...overrides,
	};
}

function containerInspection(overrides: Record<string, unknown> = {}) {
	return {
		Config: { Labels: containerLabels() },
		Id: containerId,
		NetworkSettings: {
			Ports: {
				"3000/tcp": [
					{
						HostIp: "127.0.0.1",
						HostPort: "8443",
					},
				],
			},
		},
		State: { Health: { Status: "healthy" }, Status: "running" },
		...overrides,
	};
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "Content-Type": "application/json" });
	response.end(JSON.stringify(body));
}

async function withDockerApi<T>(
	handle: (request: IncomingMessage, response: ServerResponse) => void,
	run: (baseUrl: string) => Promise<T>,
) {
	const server = createServer(handle);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		server.closeAllConnections();
		server.close();
		throw new Error("The Docker API test server did not bind to a TCP port.");
	}

	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
}

describe("library runtime Docker reader", () => {
	it("filters by the requested Coolify application and maps inspected container facts", async () => {
		const requests: string[] = [];
		await withDockerApi(
			(request, response) => {
				const url = new URL(request.url ?? "/", "http://docker.test");
				requests.push(`${request.method} ${url.pathname}`);
				if (url.pathname === "/v1.51/containers/json") {
					expect(url.searchParams.get("all")).toBe("true");
					expect(JSON.parse(url.searchParams.get("filters") ?? "null")).toEqual({
						label: [`com.docker.compose.project=${applicationUuid}`],
					});
					sendJson(response, 200, [containerSummary()]);
					return;
				}
				if (url.pathname === `/v1.51/containers/${containerId}/json`) {
					sendJson(response, 200, containerInspection());
					return;
				}
				sendJson(response, 404, { message: "not found" });
			},
			async (baseUrl) => {
				const readContainers =
					createDockerLibraryRuntimeContainerReader(baseUrl);

				await expect(readContainers(applicationUuid)).resolves.toEqual([
					{
						health: "healthy",
						labels: containerLabels(),
						publishedPorts: [
							{
								containerPort: 3000,
								hostIp: "127.0.0.1",
								hostPort: 8443,
								protocol: "tcp",
							},
						],
						service: "web",
						state: "running",
					},
				]);
			},
		);
		expect(requests).toEqual([
			"GET /v1.51/containers/json",
			`GET /v1.51/containers/${containerId}/json`,
		]);
	});

	it.each(rejectedSummaryLabels)(
		"does not inspect $name returned by the filtered list",
		async ({ labels }) => {
			const paths: string[] = [];
			await withDockerApi(
				(request, response) => {
					const url = new URL(request.url ?? "/", "http://docker.test");
					paths.push(url.pathname);
					sendJson(response, 200, [
						containerSummary({
							Labels: containerLabels(labels),
						}),
					]);
				},
				async (baseUrl) => {
					const readContainers =
						createDockerLibraryRuntimeContainerReader(baseUrl);
					await expect(readContainers(applicationUuid)).rejects.toThrow();
				},
			);
			expect(paths).toEqual(["/v1.51/containers/json"]);
		},
	);

	it.each([
		{
			body: { ...containerInspection(), Id: "c".repeat(64) },
			name: "a different inspected container ID",
		},
		{
			body: containerInspection({
				Config: {
					Labels: containerLabels({
						"com.docker.compose.project": "z".repeat(24),
					}),
				},
			}),
			name: "a different inspected application",
		},
		{
			body: containerInspection({ State: { Status: 42 } }),
			name: "a malformed state",
		},
		{
			body: containerInspection({
				NetworkSettings: {
					Ports: { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "nope" }] },
				},
			}),
			name: "a malformed published port",
		},
	])("rejects $name from Docker", async ({ body }) => {
		await withDockerApi(
			(request, response) => {
				const url = new URL(request.url ?? "/", "http://docker.test");
				sendJson(
					response,
					200,
					url.pathname.endsWith("/json") &&
						url.pathname !== "/v1.51/containers/json"
						? body
						: [containerSummary()],
				);
			},
			async (baseUrl) => {
				const readContainers =
					createDockerLibraryRuntimeContainerReader(baseUrl);
				await expect(readContainers(applicationUuid)).rejects.toThrow();
			},
		);
	});

	it("rejects malformed and oversized Docker list responses", async () => {
		for (const body of [JSON.stringify({ containers: [] }), "x".repeat(600_000)]) {
			await withDockerApi(
				(_request, response) => {
					response.writeHead(200, { "Content-Type": "application/json" });
					response.end(body);
				},
				async (baseUrl) => {
					const readContainers =
						createDockerLibraryRuntimeContainerReader(baseUrl);
					await expect(readContainers(applicationUuid)).rejects.toThrow();
				},
			);
		}
	});

	it("does not copy a raw Docker error into its failure", async () => {
		await withDockerApi(
			(_request, response) => {
				response.writeHead(500, { "Content-Type": "text/plain" });
				response.end("raw-docker-secret");
			},
			async (baseUrl) => {
				const readContainers =
					createDockerLibraryRuntimeContainerReader(baseUrl);
				let error: unknown;
				try {
					await readContainers(applicationUuid);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).not.toContain("raw-docker-secret");
			},
		);
	});

	it("stops waiting when the Docker proxy does not respond", async () => {
		await withDockerApi(
			() => {},
			async (baseUrl) => {
				const readContainers =
					createDockerLibraryRuntimeContainerReader(baseUrl);
				const startedAt = Date.now();
				await expect(readContainers(applicationUuid)).rejects.toThrow();
				expect(Date.now() - startedAt).toBeLessThan(5_000);
			},
		);
	});
});
