import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activateAdminCrossrefPublication,
	activateAdminZenodoPublication,
	getAdminPublication,
	getAdminLibrary,
	getAdminSearchIndexOverview,
	getAdminSearchIndexReceipts,
	mutateAdminItems,
	publishAdminItem,
	retryAdminSearchIndex,
	retryAdminZenodoPublication,
} from "@/components/admin/admin-api";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin API client", () => {
	const canonicalKeys = (count: number) => {
		const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
		return Array.from(
			{ length: count },
			(_, index) =>
				`AAAAAA${alphabet[Math.floor(index / alphabet.length)]}${
					alphabet[index % alphabet.length]
				}`,
		);
	};

	it("uses the item publication routes and sends only the Zenodo DOI policy", async () => {
		const fetchMock = vi.fn().mockImplementation(async () =>
			new Response(
				JSON.stringify({ publication: { itemKey: "A/B" } }),
				{
					headers: { "Content-Type": "application/json" },
					status: 200,
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await getAdminPublication("A/B");
		await activateAdminCrossrefPublication("A/B");
		await activateAdminZenodoPublication("A/B", "mint-zenodo");
		await retryAdminZenodoPublication("A/B");

		expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
			"/api/admin/items/A%2FB/publication",
			"/api/admin/items/A%2FB/publication/crossref/activate",
			"/api/admin/items/A%2FB/publication/zenodo/activate",
			"/api/admin/items/A%2FB/publication/zenodo/retry",
		]);
		expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
			body: JSON.stringify({ identifierPolicy: "mint-zenodo" }),
			method: "POST",
		});
	});

	it("sends one request for a batch mutation", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{
							indexingReceipts: [],
							key: "ABCD2345",
							outcome: "changed",
						},
					],
				}),
				{
					headers: { "Content-Type": "application/json" },
					status: 200,
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			mutateAdminItems({ action: "publish", keys: ["ABCD2345"] }),
		).resolves.toEqual({
			results: [
				{
					indexingReceipts: [],
					key: "ABCD2345",
					outcome: "changed",
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/items/batch",
			expect.objectContaining({
				body: JSON.stringify({
					action: "publish",
					keys: ["ABCD2345"],
				}),
				method: "POST",
			}),
		);
	});

	it("chunks selections at the server contract limit", async () => {
		const keys = canonicalKeys(51);
		const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { keys: string[] };
			return new Response(
				JSON.stringify({
					results: body.keys.map((key) => ({
						indexingReceipts: [],
						key,
						outcome: "changed",
					})),
				}),
				{
					headers: { "Content-Type": "application/json" },
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			mutateAdminItems({ action: "publish", keys }),
		).resolves.toEqual({
			results: keys.map((key) => ({
				indexingReceipts: [],
				key,
				outcome: "changed",
			})),
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const requestSizes = fetchMock.mock.calls.map(([, init]) => {
			const body = JSON.parse(String(init?.body)) as { keys: string[] };
			return body.keys.length;
		});
		expect(requestSizes).toEqual([50, 1]);
	});

	it("retries dependency-skipped records after every first-pass chunk", async () => {
		const keys = canonicalKeys(51);
		let requestIndex = 0;
		const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { keys: string[] };
			const currentRequest = requestIndex++;
			return new Response(
				JSON.stringify({
					results: body.keys.map((key, index) => ({
						indexingReceipts: [],
						key,
						outcome:
							currentRequest === 0 && index === 0
								? "failed"
								: "changed",
						...(currentRequest === 0 && index === 0
							? { code: "conflict", retryable: true }
							: {}),
					})),
				}),
				{
					headers: { "Content-Type": "application/json" },
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await mutateAdminItems({ action: "remove", keys });
		expect(response.results).toEqual(
			keys.map((key) => ({
				indexingReceipts: [],
				key,
				outcome: "changed",
			})),
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(
			JSON.parse(String(fetchMock.mock.calls[2]![1]?.body)),
		).toMatchObject({ keys: [keys[0]] });
	});

	it("continues dependency retries while later chunks make progress", async () => {
		const keys = canonicalKeys(101);
		let requestIndex = 0;
		const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { keys: string[] };
			const currentRequest = requestIndex++;
			const retryable =
				currentRequest === 0 ||
				currentRequest === 1 ||
				currentRequest === 3;
			return new Response(
				JSON.stringify({
					results: body.keys.map((key) => ({
						indexingReceipts: [],
						key,
						outcome: retryable ? "failed" : "changed",
						...(retryable
							? { code: "conflict", retryable: true }
							: {}),
					})),
				}),
				{
					headers: { "Content-Type": "application/json" },
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await mutateAdminItems({ action: "publish", keys });
		expect(response.results).toEqual(
			keys.map((key) => ({
				indexingReceipts: [],
				key,
				outcome: "changed",
			})),
		);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it("preserves structured validation details from the server", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							code: "validation_failed",
							fields: {
								"creators.0":
									"Enter a name for this creator, or remove the empty creator.",
							},
							message:
								"Check the highlighted fields and try again.",
						},
					}),
					{
						headers: { "Content-Type": "application/json" },
						status: 400,
					},
				),
			),
		);

		await expect(getAdminLibrary()).rejects.toMatchObject({
			code: "validation_failed",
			fields: {
				"creators.0":
					"Enter a name for this creator, or remove the empty creator.",
			},
			message: "Check the highlighted fields and try again.",
			status: 400,
		});
	});

	it("preserves a forbidden response from the server", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							code: "forbidden",
							message: "Only a library Owner can do this.",
						},
					}),
					{
						headers: { "Content-Type": "application/json" },
						status: 403,
					},
				),
			),
		);

		await expect(getAdminLibrary()).rejects.toMatchObject({
			code: "forbidden",
			status: 403,
		});
	});

	it("falls back safely when an upstream error has the wrong shape", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							fields: "not-an-object",
							message: "Proxy error",
						},
					}),
					{
						headers: { "Content-Type": "application/json" },
						status: 409,
					},
				),
			),
		);

		await expect(getAdminLibrary()).rejects.toMatchObject({
			code: "conflict",
			fields: {},
			message:
				"This content changed while you were editing it. Refresh and try again.",
			status: 409,
		});
	});

	it("requests the lightweight search worker overview without caching", async () => {
		const overview = {
			queue: { hasFailed: false, hasPending: false, nextAttemptAt: null },
			worker: null,
		};
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(overview), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();

		await expect(
			getAdminSearchIndexOverview(controller.signal),
		).resolves.toEqual(overview);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/search-index",
			expect.objectContaining({
				cache: "no-store",
				signal: controller.signal,
			}),
		);
	});

	it("sends receipt identities to status and retry APIs", async () => {
		const receipt = {
			entityKey: "LIVEB22K",
			entityType: "item" as const,
			revision: 4,
		};
		const status = {
			...receipt,
			attempts: 0,
			createdAt: "2026-08-04T10:00:00.000Z",
			error: null,
			nextAttemptAt: "2026-08-04T10:00:00.000Z",
			processedAt: null,
			state: "queued",
		};
		const fetchMock = vi.fn().mockImplementation(async (path: string) =>
			new Response(JSON.stringify({
				receipts: path.endsWith("/receipts") ? [status] : [],
				requeued: 1,
			}), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await getAdminSearchIndexReceipts([receipt]);
		await retryAdminSearchIndex({ receipts: [receipt], scope: "receipts" });

		expect(fetchMock.mock.calls).toEqual([
			[
				"/api/admin/search-index/receipts",
				expect.objectContaining({
					body: JSON.stringify({ receipts: [receipt] }),
					method: "POST",
				}),
			],
			[
				"/api/admin/search-index/retry",
				expect.objectContaining({
					body: JSON.stringify({
						receipts: [receipt],
						scope: "receipts",
					}),
					method: "POST",
				}),
			],
		]);
	});

	it.each([
		["missing", []],
		[
			"duplicate",
			[
				{
					entityKey: "LIVEB22K",
					entityType: "item",
					revision: 4,
				},
				{
					entityKey: "LIVEB22K",
					entityType: "item",
					revision: 4,
				},
			],
		],
		[
			"mismatched",
			[
				{
					entityKey: "ABCD2345",
					entityType: "item",
					revision: 4,
				},
			],
		],
	] as const)("rejects %s receipt status responses", async (_label, returned) => {
		const statuses = returned.map((receipt) => ({
			...receipt,
			attempts: 0,
			createdAt: "2026-08-04T10:00:00.000Z",
			error: null,
			nextAttemptAt: "2026-08-04T10:00:00.000Z",
			processedAt: null,
			state: "queued",
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ receipts: statuses }), {
					headers: { "Content-Type": "application/json" },
					status: 200,
				}),
			),
		);

		await expect(
			getAdminSearchIndexReceipts([
				{ entityKey: "LIVEB22K", entityType: "item", revision: 4 },
			]),
		).rejects.toMatchObject({ code: "internal_error", status: 502 });
	});

	it("rejects mutation responses that omit indexing receipts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ item: {} }), {
					headers: { "Content-Type": "application/json" },
					status: 200,
				}),
			),
		);

		await expect(publishAdminItem("LIVEB22K")).rejects.toMatchObject({
			code: "internal_error",
			message:
				"The server returned an invalid search indexing response. Refresh and try again.",
			status: 502,
		});
	});
});
