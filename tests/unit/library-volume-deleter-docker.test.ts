import { describe, expect, it } from "vitest";

import { LibraryVolumeDeletionError } from "@/lib/deployment/library-volume-deleter-http";
import {
	createDockerLibraryVolumeDeleter,
	type DockerVolumeRequest,
	parseDockerJsonResponse,
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
	it("deletes only the derived volume without force and verifies absence", async () => {
		const requests: Array<{ method: string; path: string }> = [];
		let inspections = 0;
		const request: DockerVolumeRequest = async (candidate) => {
			requests.push(candidate);
			if (candidate.path.startsWith("/containers/json?")) {
				const url = new URL(candidate.path, "http://docker.test");
				expect(JSON.parse(url.searchParams.get("filters") ?? "null")).toEqual({
					volume: [volumeName],
				});
				return jsonResponse(200, []);
			}
			if (candidate.method === "GET") {
				inspections += 1;
				return inspections === 1
					? jsonResponse(200, { Name: volumeName })
					: { body: "", contentType: null, status: 404 };
			}
			return { body: "", contentType: null, status: 204 };
		};

		const remove = createDockerLibraryVolumeDeleter(request);
		await expect(remove(applicationUuid)).resolves.toEqual({
			outcome: "deleted",
		});
		expect(requests).toEqual([
			expect.objectContaining({ method: "GET" }),
			{ method: "GET", path: `/volumes/${volumeName}` },
			{ method: "DELETE", path: `/volumes/${volumeName}` },
			{ method: "GET", path: `/volumes/${volumeName}` },
		]);
		expect(requests.some(({ path }) => path.includes("force"))).toBe(false);
	});

	it("treats an absent derived volume as success", async () => {
		const requests: Array<{ method: string; path: string }> = [];
		const remove = createDockerLibraryVolumeDeleter(async (request) => {
			requests.push(request);
			return request.path.startsWith("/containers/json?")
				? jsonResponse(200, [])
				: { body: "", contentType: null, status: 404 };
		});

		await expect(remove(applicationUuid)).resolves.toEqual({
			outcome: "absent",
		});
		expect(requests).toHaveLength(2);
		expect(requests.every(({ method }) => method === "GET")).toBe(true);
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
});
