import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LibraryVolumeDeletionError } from "@/lib/deployment/library-volume-deleter-http";
import {
	createDockerLibraryVolumeDeleter,
	type DockerVolumeRequest,
	parseDockerJsonResponse,
	requestDockerSocket,
} from "../../tools/runLibraryVolumeDeleter";

const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";
const volumeName = `${applicationUuid}_meilisearch-data`;

function jsonResponse(status: number, body: unknown) {
	return {
		body: JSON.stringify(body),
		contentType: "application/json",
		status,
	};
}

describe("library volume Docker deleter", () => {
	it.each([
		{ name: "both volumes", present: [volumeName, `${applicationUuid}_library-config-data`] },
		{ name: "configuration volume alone", present: [`${applicationUuid}_library-config-data`] },
		{ name: "neither volume", present: [] },
	])("removes $name without touching another library", async ({ present }) => {
		const otherVolume = "anotherlibrary00000000000_library-config-data";
		const remaining = new Set([...present, otherVolume]);
		const request: DockerVolumeRequest = async ({ method, path }) => {
			if (path.startsWith("/containers/json?")) return jsonResponse(200, []);
			const name = path.slice("/volumes/".length);
			if (!remaining.has(name)) return { body: "", contentType: null, status: 404 };
			if (method === "GET") return jsonResponse(200, { Name: name });
			remaining.delete(name);
			return { body: "", contentType: null, status: 204 };
		};
		const remove = createDockerLibraryVolumeDeleter(request);
		await expect(remove(applicationUuid)).resolves.toEqual({
			outcome: present.length ? "deleted" : "absent",
		});
		expect([...remaining]).toEqual([otherVolume]);
		await expect(remove(applicationUuid)).resolves.toEqual({ outcome: "absent" });
	});

	it("does not report success while the configuration volume is in use", async () => {
		const remove = createDockerLibraryVolumeDeleter(async ({ path }) => {
			if (path.startsWith("/containers/json?")) {
				const filters = JSON.parse(new URL(path, "http://docker.test").searchParams.get("filters")!);
				return jsonResponse(200, filters.volume[0].endsWith("_library-config-data")
					? [{ Id: "a".repeat(64) }] : []);
			}
			return { body: "", contentType: null, status: 404 };
		});
		await expect(remove(applicationUuid)).rejects.toMatchObject({ code: "volume_in_use" });
	});

	it.each(["coolify-proxy", "library-worker"])("cleans the private network only when %s is its last endpoint", async (endpointName) => {
		const networkName = `${applicationUuid}_private`;
		let exists = true;
		const endpoints: Record<string, { Name: string }> = { ["b".repeat(64)]: { Name: endpointName } };
		const remove = createDockerLibraryVolumeDeleter(async ({ method, path, body }) => {
			if (path.startsWith("/containers/json?")) return jsonResponse(200, []);
			if (!path.startsWith(`/networks/${networkName}`) || !exists) return jsonResponse(404, {});
			if (method === "GET") return jsonResponse(200, {
				Name: networkName, Labels: { "com.docker.compose.project": applicationUuid }, Containers: endpoints,
			});
			if (method === "POST") {
				expect(JSON.parse(body!)).toEqual({ Container: "b".repeat(64), Force: false });
				delete endpoints["b".repeat(64)];
				return jsonResponse(200, {});
			}
			expect(endpoints).toEqual({});
			exists = false;
			return jsonResponse(204, {});
		});
		if (endpointName === "library-worker") {
			await expect(remove(applicationUuid)).rejects.toMatchObject({ code: "volume_in_use" });
			expect(exists).toBe(true);
			expect(Object.keys(endpoints)).toHaveLength(1);
		} else {
			await expect(remove(applicationUuid)).resolves.toEqual({ outcome: "deleted" });
			expect(exists).toBe(false);
			await expect(remove(applicationUuid)).resolves.toEqual({ outcome: "absent" });
		}
	});

	it.each(["stopped container", "endpoint reattached"])("keeps a network for retry after %s", async (scenario) => {
		let deletionAttempted = false;
		const remove = createDockerLibraryVolumeDeleter(async ({ method, path }) => {
			if (path.startsWith("/containers/json?")) {
				const filter = JSON.parse(new URL(path, "http://docker.test").searchParams.get("filters")!);
				return jsonResponse(200, filter.network && scenario === "stopped container" ? [{ Id: "c".repeat(64) }] : []);
			}
			if (!path.startsWith("/networks/")) return jsonResponse(404, {});
			if (method === "GET") return jsonResponse(200, {
				Name: `${applicationUuid}_private`, Labels: { "com.docker.compose.project": applicationUuid }, Containers: {},
			});
			deletionAttempted = true;
			return jsonResponse(403, {});
		});
		await expect(remove(applicationUuid)).rejects.toMatchObject({ code: "volume_in_use" });
		expect(deletionAttempted).toBe(scenario === "endpoint reattached");
	});

	it("refuses deletion while any container references the volume", async () => {
		const requests: Array<{ method: string; path: string }> = [];
		const remove = createDockerLibraryVolumeDeleter(async (request) => {
			requests.push(request);
			return jsonResponse(200, [{ Id: "a".repeat(64) }]);
		});

		await expect(remove(applicationUuid)).rejects.toMatchObject({
			code: "volume_in_use",
		});
		expect(requests).toHaveLength(1);
	});

	it("reports a delete race as in use and never forces it", async () => {
		const requests: Array<{ method: string; path: string }> = [];
		const remove = createDockerLibraryVolumeDeleter(async (request) => {
			requests.push(request);
			if (request.path.startsWith("/containers/json?")) {
				return jsonResponse(200, []);
			}
			if (request.method === "GET") {
				return jsonResponse(200, { Name: volumeName });
			}
			return jsonResponse(409, { message: "raw Docker detail" });
		});

		await expect(remove(applicationUuid)).rejects.toEqual(
			new LibraryVolumeDeletionError("volume_in_use"),
		);
		expect(requests.some(({ path }) => path.includes("force"))).toBe(false);
	});

	it("fails when Docker still reports the volume after deletion", async () => {
		const remove = createDockerLibraryVolumeDeleter(async (request) => {
			if (request.path.startsWith("/containers/json?")) {
				return jsonResponse(200, []);
			}
			if (request.method === "DELETE") {
				return { body: "", contentType: null, status: 204 };
			}
			return jsonResponse(200, { Name: volumeName });
		});

		await expect(remove(applicationUuid)).rejects.toMatchObject({
			code: "volume_deletion_failed",
		});
	});

	it("rejects malformed Docker JSON without exposing its contents", async () => {
		const secret = "raw-docker-secret";
		const remove = createDockerLibraryVolumeDeleter(async () => ({
			body: `{${secret}`,
			contentType: "application/json",
			status: 200,
		}));

		let error: unknown;
		try {
			await remove(applicationUuid);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(LibraryVolumeDeletionError);
		expect((error as Error).message).not.toContain(secret);
	});

	it("parses only bounded JSON responses", () => {
		expect(() =>
			parseDockerJsonResponse({
				body: "x".repeat(70_000),
				contentType: "application/json",
				status: 200,
			}),
		).toThrow(LibraryVolumeDeletionError);
	});

	it("settles when Docker sends an oversized partial response", async () => {
		const directory = await mkdtemp(join(tmpdir(), "volume-deleter-test-"));
		const socketPath = join(directory, "docker.sock");
		const server = createServer((_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write("x".repeat(70_000));
		});
		try {
			await new Promise<void>((resolve, reject) => {
				server.listen(socketPath, () => resolve());
				server.once("error", reject);
			});
			await expect(
				Promise.race([
					requestDockerSocket(
						{ method: "GET", path: "/containers/json" },
						socketPath,
					),
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error("The Docker request did not settle.")),
							1_000,
						),
					),
				]),
			).rejects.toBeInstanceOf(LibraryVolumeDeletionError);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(directory, { recursive: true });
		}
	});
});
