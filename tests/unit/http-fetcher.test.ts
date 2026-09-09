import { afterEach, expect, it, vi } from "vitest";
import { fetcher } from "@/lib/utils";

vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("rejects unsuccessful JSON responses instead of returning them as collection data", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "INVALID_LIBRARY_COLLECTIONS" }, { status: 503 })));
	await expect(fetcher("/collections")).rejects.toThrow(/503/);
});

it("returns successful collection data", async () => {
	const payload = { collections: [{ key: "ABCDEFGH", name: "Research" }] };
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
	await expect(fetcher("/collections")).resolves.toEqual(payload);
});
