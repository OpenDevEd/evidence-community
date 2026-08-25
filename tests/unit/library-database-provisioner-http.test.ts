import { once } from "node:events";
import type { Server } from "node:http";

import { describe, expect, it } from "vitest";

import { LibraryDatabaseProvisioningError } from "@/lib/deployment/library-database";
import {
	createLibraryDatabaseProvisionerServer,
	type LibraryDatabaseHttpDeleter,
	type LibraryDatabaseHttpReconciler,
} from "@/lib/deployment/library-database-provisioner-http";

const token = "test-provisioner-token-with-at-least-32-bytes";
const validBody = {
	libraryId: "j972k3h6k5k6x1m8v9z0",
	password: "saved opaque password /:@",
};
const receipt = {
	outcome: "created" as const,
	databaseName: "el_539c844f0b6d75c24c8c1694fc41e72c9cf96aa29653ed2f",
	loginName: "el_539c844f0b6d75c24c8c1694fc41e72c9cf96aa29653ed2f_user",
	databaseUrl:
		"postgresql://el_user:password@postgres.internal:5432/el_database",
};

async function closeServer(server: Server) {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function withServer<T>(
	reconcile: LibraryDatabaseHttpReconciler,
	run: (baseUrl: string) => Promise<T>,
	remove: LibraryDatabaseHttpDeleter = async ({ libraryId }) => ({
		libraryId,
		outcome: "absent",
		databaseName: receipt.databaseName,
		loginName: receipt.loginName,
	}),
) {
	const server = createLibraryDatabaseProvisionerServer({
		onError: () => undefined,
		reconcile,
		remove,
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

function reconcileReceipt(): LibraryDatabaseHttpReconciler {
	return async (request) => {
		if (
			request.libraryId !== validBody.libraryId ||
			request.password !== validBody.password
		) {
			throw new Error("The HTTP service changed the reconcile request.");
		}
		return receipt;
	};
}

function reconcileUrl(baseUrl: string) {
	return `${baseUrl}/v1/library-databases/reconcile`;
}

function deleteUrl(baseUrl: string) {
	return `${baseUrl}/v1/library-databases/delete`;
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

describe("library database provisioner HTTP contract", () => {
	it("reports health without exposing the reconcile endpoint", async () => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const response = await fetch(`${baseUrl}/health`);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			expect(await response.json()).toEqual({ status: "ok" });
		});
	});

	it("returns the fixed receipt for an authenticated request", async () => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const response = await fetch(
				reconcileUrl(baseUrl),
				authorizedJson(validBody),
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				libraryId: validBody.libraryId,
				...receipt,
			});
		});
	});

	it("deletes only the library derived from the authenticated request", async () => {
		const remove: LibraryDatabaseHttpDeleter = async (request) => {
			expect(request).toEqual({ libraryId: validBody.libraryId });
			return {
				libraryId: request.libraryId,
				outcome: "deleted",
				databaseName: receipt.databaseName,
				loginName: receipt.loginName,
			};
		};
		await withServer(
			reconcileReceipt(),
			async (baseUrl) => {
				const response = await fetch(
					deleteUrl(baseUrl),
					authorizedJson({ libraryId: validBody.libraryId }),
				);

				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					libraryId: validBody.libraryId,
					outcome: "deleted",
					databaseName: receipt.databaseName,
					loginName: receipt.loginName,
				});
			},
			remove,
		);
	});

	it("rejects caller-selected database deletion targets", async () => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const response = await fetch(
				deleteUrl(baseUrl),
				authorizedJson({
					libraryId: validBody.libraryId,
					databaseName: receipt.databaseName,
				}),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					code: "invalid_request",
					message: "Send only libraryId.",
				},
			});
		});
	});

	it.each([
		{ authorization: undefined, name: "missing" },
		{ authorization: "Bearer wrong-token", name: "wrong" },
	])("rejects a $name bearer token", async ({ authorization }) => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (authorization) headers.Authorization = authorization;
			const response = await fetch(reconcileUrl(baseUrl), {
				body: JSON.stringify(validBody),
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

	it("rejects caller-selected database settings", async () => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const response = await fetch(
				reconcileUrl(baseUrl),
				authorizedJson({
					...validBody,
					adminUrl: "postgresql://caller-controlled",
					runtimeHost: "caller-controlled",
				}),
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					code: "invalid_request",
					message: "Send only libraryId and password.",
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
			body: JSON.stringify({ libraryId: "", password: "password" }),
			code: "invalid_request",
			message:
				"libraryId must be a non-empty string of at most 256 bytes.",
		},
		{
			body: JSON.stringify({ libraryId: "library", password: "" }),
			code: "invalid_request",
			message:
				"password must be a non-empty string of at most 1024 bytes.",
		},
	])("returns the bounded $code protocol error", async (example) => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const response = await fetch(reconcileUrl(baseUrl), {
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

	it("rejects the wrong method, path, and content type", async () => {
		await withServer(reconcileReceipt(), async (baseUrl) => {
			const wrongMethod = await fetch(reconcileUrl(baseUrl), {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(wrongMethod.status).toBe(405);
			expect(wrongMethod.headers.get("allow")).toBe("POST");

			const wrongPath = await fetch(
				`${reconcileUrl(baseUrl)}/`,
				authorizedJson(validBody),
			);
			expect(wrongPath.status).toBe(404);

			const wrongContentType = await fetch(reconcileUrl(baseUrl), {
				body: JSON.stringify(validBody),
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

	it("returns a stable conflict without database details", async () => {
		await withServer(
			async () => {
				throw new LibraryDatabaseProvisioningError(
					"database_owner_conflict",
					"The database is owned by sensitive_owner.",
				);
			},
			async (baseUrl) => {
				const response = await fetch(
					reconcileUrl(baseUrl),
					authorizedJson(validBody),
				);

				expect(response.status).toBe(409);
				expect(await response.json()).toEqual({
					error: {
						code: "database_owner_conflict",
						message:
							"The library database is owned by another login.",
					},
				});
			},
		);
	});

	it("does not expose secrets in an unexpected failure", async () => {
		const leakedPassword = "password-that-must-not-leak";
		const leakedAdminUrl =
			"postgresql://admin:secret@postgres.internal:5432/postgres";
		await withServer(
			async () => {
				throw new Error(`${leakedPassword} ${leakedAdminUrl} ${token}`);
			},
			async (baseUrl) => {
				const response = await fetch(
					reconcileUrl(baseUrl),
					authorizedJson(validBody),
				);
				const body = await response.text();

				expect(response.status).toBe(500);
				expect(JSON.parse(body)).toEqual({
					error: {
						code: "database_reconciliation_failed",
						message:
							"The library database could not be reconciled.",
					},
				});
				expect(body).not.toContain(leakedPassword);
				expect(body).not.toContain(leakedAdminUrl);
				expect(body).not.toContain(token);
			},
		);
	});
});
