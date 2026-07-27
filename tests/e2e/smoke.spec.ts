import { expect, test } from "@playwright/test";

test("redirects the root route to the evidence library", async ({
	request,
}) => {
	const response = await request.get("/", { maxRedirects: 0 });

	expect(response.status()).toBe(307);

	const location = response.headers().location;
	expect(location).toBeDefined();
	expect(new URL(location!, response.url()).pathname).toBe("/lib");
});

test("reports the active runtime configuration revision only", async ({
	request,
}) => {
	const response = await request.get("/api/library-config/health");
	const body = await response.text();

	expect(response.status()).toBe(200);
	expect(response.headers()["cache-control"]).toContain("no-store");
	expect(JSON.parse(body)).toEqual({
		state: "active",
		active: {
			schemaVersion: 1,
			revision: "example-1",
			updatedAt: "2026-07-27T12:30:00.000Z",
		},
		rejected: null,
	});
	expect(body).not.toContain("example-search-key");
});
