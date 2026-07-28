import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/cache", () => ({
	getCachedCollectionsResult: vi.fn(),
}));

import { getCachedCollectionsResult } from "@/app/api/cache";
import { GET } from "@/app/api/collections/route";

const mockedGetCachedCollectionsResult = vi.mocked(
	getCachedCollectionsResult,
);

beforeEach(() => {
	mockedGetCachedCollectionsResult.mockReset();
});

describe("runtime collections route", () => {
	it("returns configured collections from the shared cache", async () => {
		mockedGetCachedCollectionsResult.mockResolvedValue({
			ok: true,
			collections: [],
		});

		const response = await GET();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ collections: [] });
	});

	it("returns 503 with missing IDs instead of caching a thrown error", async () => {
		mockedGetCachedCollectionsResult.mockResolvedValue({
			ok: false,
			missingIds: ["MISSING12"],
		});

		const response = await GET();

		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			error: "INVALID_LIBRARY_COLLECTIONS",
			missingIds: ["MISSING12"],
		});
	});
});
