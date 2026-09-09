import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
	activate: vi.fn(),
	buildView: vi.fn(),
	config: { revision: "test-config" },
	database: { kind: "database" },
	retry: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => mocks.config),
}));
vi.mock("@/db", () => ({
	getDatabase: vi.fn(async () => mocks.database),
	getDatabaseForConfig: vi.fn(async () => mocks.database),
}));
vi.mock("@/lib/admin/http", async () => {
	const { NextResponse } = await import("next/server");
	return {
		ADMIN_RESPONSE_HEADERS: { "Cache-Control": "private, no-store" },
		adminErrorResponse: (error: unknown) =>
			NextResponse.json({ error: String(error) }, { status: 500 }),
		requireAdminPublisher: vi.fn(async () => null),
		requireAdminSession: () => null,
	};
});
vi.mock("@/lib/publication/crossref-activation-service", () => ({
	activateCrossrefPublication: mocks.activate,
	retryCrossrefPublication: mocks.retry,
}));
vi.mock("@/lib/publication/admin-publication-view-service", () => ({
	buildAdminPublicationView: mocks.buildView,
}));

import { POST as activate } from "@/app/api/admin/items/[key]/publication/crossref/activate/route";
import { POST as retry } from "@/app/api/admin/items/[key]/publication/crossref/retry/route";
import { GET as status } from "@/app/api/admin/items/[key]/publication/route";

describe("Crossref publication admin routes", () => {
	beforeEach(() => {
		mocks.activate.mockResolvedValue({ doi: "10.5555/library.000001" });
		mocks.retry.mockResolvedValue({ job: { id: 1, state: "retrying" } });
		mocks.buildView.mockResolvedValue({ itemKey: "ABCDEFGH" });
	});

	it("uses only server configuration when activating", async () => {
		const request = new NextRequest(
			"https://library.example.org/api/admin/items/ABCDEFGH/publication/crossref/activate",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					doi: "10.9999/client-choice",
					prefix: "10.9999",
					suffixNamespace: "client.",
				}),
			},
		);
		const response = await activate(request, {
			params: Promise.resolve({ key: "ABCDEFGH" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			activation: { doi: "10.5555/library.000001" },
			publication: { itemKey: "ABCDEFGH" },
		});
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(mocks.activate).toHaveBeenCalledWith(
			mocks.database,
			"ABCDEFGH",
			mocks.config,
		);
	});

	it("returns the shared publication view", async () => {
		const response = await status(
			new NextRequest("https://library.example.org"),
			{
				params: Promise.resolve({ key: "ABCDEFGH" }),
			},
		);
		expect(await response.json()).toEqual({
			publication: { itemKey: "ABCDEFGH" },
		});
		expect(mocks.buildView).toHaveBeenCalledWith("ABCDEFGH");
	});

	it("reopens the existing failed job", async () => {
		const response = await retry(
			new NextRequest("https://library.example.org"),
			{
				params: Promise.resolve({ key: "ABCDEFGH" }),
			},
		);
		expect(await response.json()).toEqual({
			activation: { job: { id: 1, state: "retrying" } },
			publication: { itemKey: "ABCDEFGH" },
		});
		expect(mocks.retry).toHaveBeenCalledWith(mocks.database, "ABCDEFGH", mocks.config);
	});
});
