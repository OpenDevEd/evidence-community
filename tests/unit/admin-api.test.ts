import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminLibrary } from "@/components/admin/admin-api";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin API client", () => {
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
