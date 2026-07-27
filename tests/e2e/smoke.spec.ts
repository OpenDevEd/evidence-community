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
