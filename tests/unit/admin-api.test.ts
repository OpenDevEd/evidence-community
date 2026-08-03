import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getAdminLibrary,
	mutateAdminItems,
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

	it("sends one request for a batch mutation", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [{ key: "ABCD2345", outcome: "changed" }],
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
			results: [{ key: "ABCD2345", outcome: "changed" }],
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
			results: keys.map((key) => ({ key, outcome: "changed" })),
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
			keys.map((key) => ({ key, outcome: "changed" })),
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
			keys.map((key) => ({ key, outcome: "changed" })),
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
});
