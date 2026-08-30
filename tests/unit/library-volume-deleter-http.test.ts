import { once } from "node:events";
import type { Server } from "node:http";

import { describe, expect, it } from "vitest";

import {
	createLibraryVolumeDeleterServer,
	LibraryVolumeDeletionError,
	type LibraryVolumeHttpDeleter,
} from "@/lib/deployment/library-volume-deleter-http";

const token = "test-volume-deleter-token-with-at-least-32-bytes";
const applicationUuid = "a1b2c3d4e5f6g7h8i9j0k1l2";

async function closeServer(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function withServer<T>(
	remove: LibraryVolumeHttpDeleter,
	run: (baseUrl: string) => Promise<T>,
) {
	const server = createLibraryVolumeDeleterServer({ remove, token });
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

function deleteUrl(baseUrl: string) {
	return `${baseUrl}/v1/library-volumes/delete`;
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

describe("library volume deleter HTTP contract", () => {
	it.each(["deleted", "absent"] as const)(
		"returns the confirmed %s outcome for the requested application",
		async (outcome) => {
			let receivedUuid: string | undefined;
			await withServer(
				async (candidateUuid) => {
					receivedUuid = candidateUuid;
					return { outcome };
				},
				async (baseUrl) => {
					const response = await fetch(
						deleteUrl(baseUrl),
						authorizedJson({ applicationUuid }),
					);

					expect(response.status).toBe(200);
					expect(response.headers.get("cache-control")).toBe("no-store");
					expect(await response.json()).toEqual({
						applicationUuid,
						outcome,
					});
				},
			);
			expect(receivedUuid).toBe(applicationUuid);
		},
	);

	it("does not accept a caller-selected volume name", async () => {
		await withServer(async () => ({ outcome: "absent" }), async (baseUrl) => {
			const response = await fetch(
				deleteUrl(baseUrl),
				authorizedJson({
					applicationUuid,
					volumeName: "another-project_meilisearch-data",
				}),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					code: "invalid_request",
					message: "Send only applicationUuid.",
				},
			});
		});
	});

	it("rejects an invalid application UUID and missing authorization", async () => {
		await withServer(async () => ({ outcome: "absent" }), async (baseUrl) => {
			const invalidUuid = await fetch(
				deleteUrl(baseUrl),
				authorizedJson({ applicationUuid: "../../var/lib/docker" }),
			);
			expect(invalidUuid.status).toBe(400);
			expect(await invalidUuid.json()).toEqual({
				error: {
					code: "invalid_request",
					message:
						"applicationUuid must be a 24-character lowercase Coolify UUID.",
				},
			});

			const unauthorized = await fetch(deleteUrl(baseUrl), {
				body: JSON.stringify({ applicationUuid }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});
			expect(unauthorized.status).toBe(401);
		});
	});

	it.each([
		{
			code: "volume_in_use" as const,
			message: "The library volume is still in use.",
			status: 409,
		},
		{
			code: "volume_deletion_failed" as const,
			message: "The library volume could not be deleted.",
			status: 502,
		},
	])("returns the fixed $code error", async ({ code, message, status }) => {
		await withServer(
			async () => {
				throw new LibraryVolumeDeletionError(code);
			},
			async (baseUrl) => {
				const response = await fetch(
					deleteUrl(baseUrl),
					authorizedJson({ applicationUuid }),
				);

				expect(response.status).toBe(status);
				expect(await response.json()).toEqual({
					error: { code, message },
				});
			},
		);
	});
});
