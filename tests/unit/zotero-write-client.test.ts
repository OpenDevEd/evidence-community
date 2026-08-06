import { describe, expect, it, vi } from "vitest";

import {
	ZoteroApiClient,
	ZoteroApiError,
	ZoteroObjectWriteError,
} from "@/lib/source-ingestion/zotero/client";

function versionedResponse(
	body: BodyInit | null = null,
	init: ResponseInit = {},
) {
	return new Response(body, {
		...init,
		headers: {
			"last-modified-version": "12",
			...init.headers,
		},
	});
}

function client(fetchImplementation: typeof fetch) {
	return new ZoteroApiClient({
		apiBaseUrl: "https://api.zotero.test",
		apiKey: "secret",
		fetch: fetchImplementation,
		requestTimeoutMs: 1_000,
		sleep: async () => undefined,
	});
}

describe("Zotero write client", () => {
	it("requires explicit write permission for the configured library", async () => {
		const readOnly = client(async () =>
			versionedResponse(
				JSON.stringify({
					access: {
						groups: { "999": { library: true, write: false } },
					},
					userID: 1,
				}),
			),
		);
		await expect(
			readOnly.verifyKeyAccess(
				{ externalScopeKey: "999", kind: "group" },
				"write",
			),
		).rejects.toMatchObject({ status: 403 });

		const writable = client(async () =>
			versionedResponse(
				JSON.stringify({
					access: {
						groups: { all: { library: true, write: true } },
					},
					userID: 1,
				}),
			),
		);
		await expect(
			writable.verifyKeyAccess(
				{ externalScopeKey: "999", kind: "group" },
				"write",
			),
		).resolves.toBeUndefined();
	});

	it("creates a versioned predetermined item without a redundant write token", async () => {
		const fetchImplementation = vi.fn<typeof fetch>(
			async (_input, init) => {
				const headers = new Headers(init?.headers);
				expect(init?.method).toBe("POST");
				expect(headers.get("content-type")).toBe("application/json");
				expect(headers.has("zotero-write-token")).toBe(false);
				expect(JSON.parse(String(init?.body))).toEqual([
					{
						itemType: "report",
						key: "ABCD2345",
						title: "Test",
						version: 0,
					},
				]);
				return versionedResponse(
					JSON.stringify({
						successful: { "0": { key: "ABCD2345" } },
					}),
				);
			},
		);
		await expect(
			client(fetchImplementation).createItem("groups/999", {
				itemType: "report",
				key: "ABCD2345",
				title: "Test",
				version: 0,
			}),
		).resolves.toEqual({ libraryVersion: 12 });
		expect(fetchImplementation).toHaveBeenCalledOnce();
	});

	it("surfaces per-object creation failures", async () => {
		const api = client(async () =>
			versionedResponse(
				JSON.stringify({
					failed: {
						"0": { code: 400, message: "Invalid field" },
					},
				}),
			),
		);
		await expect(
			api.createItem(
				"groups/999",
				{ itemType: "report" },
				{
					writeToken: "0123456789abcdef0123456789abcdef",
				},
			),
		).rejects.toBeInstanceOf(ZoteroObjectWriteError);
	});

	it("patches and deletes with optimistic item versions", async () => {
		const requests: RequestInit[] = [];
		const api = client(async (_input, init) => {
			requests.push(init ?? {});
			return versionedResponse(null, { status: 204 });
		});
		await api.patchItem(
			"groups/999",
			"ABCD2345",
			{ collections: [], title: "Changed" },
			7,
		);
		await api.deleteItem("groups/999", "ABCD2345", 12);

		expect(requests).toHaveLength(2);
		expect(requests[0]?.method).toBe("PATCH");
		expect(
			new Headers(requests[0]?.headers).get(
				"if-unmodified-since-version",
			),
		).toBe("7");
		expect(JSON.parse(String(requests[0]?.body))).toEqual({
			collections: [],
			title: "Changed",
		});
		expect(requests[1]?.method).toBe("DELETE");
		expect(
			new Headers(requests[1]?.headers).get(
				"if-unmodified-since-version",
			),
		).toBe("12");
		expect(requests[1]?.body).toBeUndefined();
	});

	it("preserves response details for optimistic conflicts", async () => {
		const api = client(
			async () =>
				new Response("version mismatch", {
					status: 412,
					statusText: "Precondition Failed",
				}),
		);
		await expect(
			api.patchItem("groups/999", "ABCD2345", { title: "Changed" }, 7),
		).rejects.toEqual(
			expect.objectContaining<Partial<ZoteroApiError>>({
				responseBody: "version mismatch",
				status: 412,
			}),
		);
	});

	it("propagates worker abort reasons without retrying", async () => {
		const reason = new Error("lease lost");
		const controller = new AbortController();
		const fetchImplementation = vi.fn<typeof fetch>(
			async (_input, init) => {
				return new Promise((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					);
					queueMicrotask(() => controller.abort(reason));
				});
			},
		);
		await expect(
			client(fetchImplementation).item(
				"groups/999",
				"ABCD2345",
				controller.signal,
			),
		).rejects.toBe(reason);
		expect(fetchImplementation).toHaveBeenCalledOnce();
	});
});
