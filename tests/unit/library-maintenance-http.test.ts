import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { createLibraryMaintenanceServer } from "@/lib/deployment/library-maintenance-http";

const servers = new Set<ReturnType<typeof createLibraryMaintenanceServer>>();

afterEach(async () => {
	await Promise.all(
		[...servers].map(
			(server) =>
				new Promise<void>((resolve) => server.close(() => resolve())),
		),
	);
	servers.clear();
});

async function withServer() {
	const server = createLibraryMaintenanceServer();
	servers.add(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("The maintenance server did not bind to a TCP port.");
	}
	return `http://127.0.0.1:${address.port}`;
}

describe("Evidence Library maintenance response", () => {
	it("answers every page with a non-cacheable temporary response", async () => {
		const baseUrl = await withServer();
		const response = await fetch(`${baseUrl}/any/library/path`);

		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("retry-after")).toBe("30");
		expect(response.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(await response.text()).toContain("being updated");
	});
});
