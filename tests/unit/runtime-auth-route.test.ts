import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
	auth: vi.fn(),
	buildAuthOptions: vi.fn(),
	drizzleAdapter: vi.fn(),
	getDatabaseForConfig: vi.fn(),
	getConfigForEnabledFeature: vi.fn(),
	getHandler: vi.fn(),
	getLibraryConfig: vi.fn(),
	postHandler: vi.fn(),
}));

vi.mock("next-auth", () => ({
	default: vi.fn(() => ({
		auth: harness.auth,
		handlers: {
			GET: harness.getHandler,
			POST: harness.postHandler,
		},
	})),
}));

vi.mock("@/db", () => ({
	getDatabaseForConfig: harness.getDatabaseForConfig,
}));

vi.mock("@/lib/auth-service", () => ({
	authorizeForConfig: vi.fn(),
	getProfileForConfig: vi.fn(),
}));

vi.mock("@auth/drizzle-adapter", () => ({
	DrizzleAdapter: harness.drizzleAdapter,
}));

vi.mock("@/lib/auth-options", () => ({
	buildAuthOptions: harness.buildAuthOptions,
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: harness.getLibraryConfig,
}));

vi.mock("@/lib/runtime-feature", () => ({
	getConfigForEnabledFeature: harness.getConfigForEnabledFeature,
	featureUnavailableResponse: () =>
		Response.json(
			{ error: "Not found" },
			{
				status: 404,
				headers: { "Cache-Control": "no-store" },
			},
		),
}));

import {
	auth,
	getAuthOptions,
	handlers,
} from "@/app/api/auth/[...nextauth]/config";

describe("runtime authentication route gate", () => {
	beforeEach(() => {
		harness.auth.mockReset();
		harness.buildAuthOptions.mockReset();
		harness.drizzleAdapter.mockReset();
		harness.getDatabaseForConfig.mockReset();
		harness.getConfigForEnabledFeature.mockReset();
		harness.getHandler.mockReset();
		harness.getLibraryConfig.mockReset();
		harness.postHandler.mockReset();
	});

	it("builds disabled options without opening a database", async () => {
		const config = {
			features: { login: false },
		};
		const options = { providers: [] };
		harness.getLibraryConfig.mockResolvedValue(config);
		harness.buildAuthOptions.mockReturnValue(options);

		await expect(getAuthOptions()).resolves.toBe(options);
		expect(harness.buildAuthOptions).toHaveBeenCalledWith(config);
		expect(harness.getDatabaseForConfig).not.toHaveBeenCalled();
		expect(harness.drizzleAdapter).not.toHaveBeenCalled();
	});

	it("answers the session endpoint with null when login is disabled", async () => {
		harness.getConfigForEnabledFeature.mockResolvedValue(null);
		const request = new Request(
			"https://library.example.org/api/auth/session",
		);

		const response = await handlers.GET(request as never);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toBeNull();
		expect(harness.getHandler).not.toHaveBeenCalled();
	});

	it("hides handlers and returns no session when login is disabled", async () => {
		harness.getConfigForEnabledFeature.mockResolvedValue(null);
		const request = new Request(
			"https://library.example.org/api/auth/providers",
		);

		const [session, getResponse, postResponse] = await Promise.all([
			auth(),
			handlers.GET(request as never),
			handlers.POST(request as never),
		]);

		expect(session).toBeNull();
		expect(getResponse.status).toBe(404);
		expect(postResponse.status).toBe(404);
		expect(getResponse.headers.get("cache-control")).toBe("no-store");
		expect(harness.auth).not.toHaveBeenCalled();
		expect(harness.getHandler).not.toHaveBeenCalled();
		expect(harness.postHandler).not.toHaveBeenCalled();
	});

	it("delegates to Auth.js when login is enabled", async () => {
		harness.getConfigForEnabledFeature.mockResolvedValue({
			identity: {
				baseUrl: "https://configured.example.org",
			},
		});
		harness.auth.mockResolvedValue({ user: { id: "user-one" } });
		harness.getHandler.mockResolvedValue(Response.json({ enabled: true }));
		const request = new Request(
			"https://library.example.org/api/auth/providers",
		);

		const session = await auth();
		const response = await handlers.GET(request as never);

		expect(session).toEqual({ user: { id: "user-one" } });
		expect(response.status).toBe(200);
		expect(harness.auth).toHaveBeenCalledOnce();
		expect(harness.getHandler).toHaveBeenCalledOnce();
		expect(harness.getHandler.mock.calls[0][0].url).toBe(
			"https://configured.example.org/api/auth/providers",
		);
	});

	it("preserves POST method, headers, and body while configuring the origin", async () => {
		harness.getConfigForEnabledFeature.mockResolvedValue({
			identity: {
				baseUrl: "https://configured.example.org",
			},
		});
		harness.postHandler.mockImplementation(async (request: Request) =>
			Response.json({
				body: await request.text(),
				contentType: request.headers.get("content-type"),
				method: request.method,
				url: request.url,
			}),
		);
		const request = new Request(
			"https://alias.example.org/api/auth/signin/google",
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
				},
				body: "csrfToken=runtime-proof",
			},
		);

		const response = await handlers.POST(request as never);

		await expect(response.json()).resolves.toEqual({
			body: "csrfToken=runtime-proof",
			contentType: "application/x-www-form-urlencoded",
			method: "POST",
			url: "https://configured.example.org/api/auth/signin/google",
		});
	});
});
