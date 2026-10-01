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
vi.mock("@/lib/admin/access", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/admin/access")>(),
	authorizeAdminRequest: vi.fn(async () => ({
		status: "authorized",
		session: { clerkUserId: "editor", role: "editor" },
	})),
}));
vi.mock("@/lib/publication/zenodo-activation-service", () => ({
	activateZenodoPublication: mocks.activate,
	retryZenodoPublication: mocks.retry,
}));
vi.mock("@/lib/publication/admin-publication-view-service", () => ({
	buildAdminPublicationView: mocks.buildView,
}));

import { POST as activate } from "@/app/api/admin/items/[key]/publication/zenodo/activate/route";
import { POST as retry } from "@/app/api/admin/items/[key]/publication/zenodo/retry/route";

describe("Zenodo publication admin routes", () => {
	beforeEach(() => {
		mocks.activate.mockReset();
		mocks.retry.mockReset();
		mocks.activate.mockResolvedValue({ state: "waiting_for_file" });
		mocks.buildView.mockResolvedValue({ itemKey: "ABCDEFGH" });
		mocks.retry.mockResolvedValue({ job: { id: 2, state: "retrying" } });
	});

	it("uses the configured default when the request body is empty", async () => {
		const response = await activate(
			new NextRequest(
				"https://library.example.org/api/admin/items/ABCDEFGH/publication/zenodo/activate",
				{
					method: "POST",
				},
			),
			{ params: Promise.resolve({ key: "ABCDEFGH" }) },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			activation: { state: "waiting_for_file" },
			publication: { itemKey: "ABCDEFGH" },
		});
		expect(mocks.activate).toHaveBeenCalledWith(
			mocks.database,
			"ABCDEFGH",
			mocks.config,
			undefined,
		);
	});

	it("passes only the supported DOI policy", async () => {
		const response = await activate(
			new NextRequest(
				"https://library.example.org/api/admin/items/ABCDEFGH/publication/zenodo/activate",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ identifierPolicy: "mint-zenodo" }),
				},
			),
			{ params: Promise.resolve({ key: "ABCDEFGH" }) },
		);
		expect(response.status).toBe(200);
		expect(mocks.activate).toHaveBeenCalledWith(
			mocks.database,
			"ABCDEFGH",
			mocks.config,
			"mint-zenodo",
		);
	});

	it("reopens the failed Zenodo job", async () => {
		const response = await retry(
			new NextRequest("https://library.example.org"),
			{
				params: Promise.resolve({ key: "ABCDEFGH" }),
			},
		);
		expect(await response.json()).toEqual({
			activation: { job: { id: 2, state: "retrying" } },
			publication: { itemKey: "ABCDEFGH" },
		});
		expect(mocks.retry).toHaveBeenCalledWith(
			mocks.database,
			"ABCDEFGH",
			mocks.config,
		);
	});

	it("rejects an unknown DOI policy before calling the service", async () => {
		const response = await activate(
			new NextRequest(
				"https://library.example.org/api/admin/items/ABCDEFGH/publication/zenodo/activate",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ identifierPolicy: "guess" }),
				},
			),
			{ params: Promise.resolve({ key: "ABCDEFGH" }) },
		);
		expect(response.status).toBe(400);
		expect(mocks.activate).not.toHaveBeenCalled();
	});
});
