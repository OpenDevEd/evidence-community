import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
	database: { kind: "database" },
	getReceipts: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
	getDatabase: vi.fn(async () => mocks.database),
}));
vi.mock("@/lib/admin/http", async () => {
	const { NextResponse } = await import("next/server");
	return {
		ADMIN_RESPONSE_HEADERS: { "Cache-Control": "private, no-store" },
		adminErrorResponse: (error: unknown) =>
			NextResponse.json({ error: String(error) }, { status: 500 }),
		readAdminJson: (request: Request) => request.json(),
		requireAdminSession: () => null,
	};
});
vi.mock("@/lib/admin/search-index-service", () => ({
	getAdminSearchIndexReceipts: mocks.getReceipts,
}));

import { POST } from "@/app/api/admin/search-index/receipts/route";

describe("admin search receipt route", () => {
	beforeEach(() => {
		mocks.getReceipts.mockReset();
	});

	it("returns the indexing state of each requested record", async () => {
		const statuses = [
			{
				attempts: 0,
				createdAt: "2026-08-13T12:00:00.000Z",
				entityKey: "23456789",
				entityType: "item",
				error: null,
				nextAttemptAt: "2026-08-13T12:00:00.000Z",
				processedAt: "2026-08-13T12:00:01.000Z",
				revision: 1,
				state: "indexed",
			},
		];
		mocks.getReceipts.mockResolvedValue(statuses);

		const response = await POST(
			new NextRequest(
				"https://library.example.org/api/admin/search-index/receipts",
				{
					body: JSON.stringify({
						receipts: [
							{
								entityKey: "23456789",
								entityType: "item",
								revision: 1,
							},
						],
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(mocks.getReceipts).toHaveBeenCalledWith(mocks.database, [
			{ entityKey: "23456789", entityType: "item", revision: 1 },
		]);
		expect(await response.json()).toEqual({ receipts: statuses });
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
});
