import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/app/api/auth/[...nextauth]/config", () => ({ auth: vi.fn() }));
vi.mock("@/app/api/cache", () => ({
	getCachedCollections: async () => [],
	getUserCollectionKeysDirect: vi.fn(),
	getUserLikesDirect: vi.fn(),
}));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/lib/runtime-feature", () => ({
	getConfigForEnabledFeature: vi.fn(),
	featureUnavailableResponse: () => new Response(null, { status: 404 }),
}));
const service = vi.hoisted(() => ({
	search: vi.fn(),
	getDisplayedAttributes: async () => ["*"],
	getStats: async () => ({ fieldDistribution: { key: 1, title: 1 } }),
}));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ index: service }) }));
import { auth } from "@/app/api/auth/[...nextauth]/config";
import { getUserCollectionKeysDirect } from "@/app/api/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";
import { GET } from "@/app/api/user/items/[id]/route";

const OWNER = "reader-owner";

function readCollection(collectionId: string) {
	return GET(new NextRequest(`https://library.example/api/user/items/${OWNER}?collectionId=${collectionId}`), {
		params: Promise.resolve({ id: OWNER }),
	});
}

beforeEach(() => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	vi.mocked(getConfigForEnabledFeature).mockResolvedValue(config as never);
	vi.mocked(getUserCollectionKeysDirect).mockResolvedValue({ private: true, userId: OWNER, itemKeys: ["SAVEDAAA"] });
	service.search.mockReset().mockResolvedValue({ estimatedTotalHits: 1, hits: [{ key: "SAVEDAAA", title: "Saved record" }] });
});

it("refuses someone else's private collection instead of listing the whole library", async () => {
	vi.mocked(auth).mockResolvedValue({ user: { id: "another-reader" } } as never);
	const response = await readCollection("private-collection");
	expect(response.status).toBe(403);
	expect(service.search).not.toHaveBeenCalled();
});

it("refuses a private collection to someone who is signed out", async () => {
	vi.mocked(auth).mockResolvedValue(null as never);
	const response = await readCollection("private-collection");
	expect(response.status).toBe(403);
	expect(service.search).not.toHaveBeenCalled();
});

it("lists a private collection's own records for its owner", async () => {
	vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never);
	const response = await readCollection("private-collection");
	expect(response.status).toBe(200);
	expect((await response.json()).items.map((item: { key: string }) => item.key)).toEqual(["SAVEDAAA"]);
	expect(service.search.mock.lastCall?.[1].filter).toContainEqual('key IN ["SAVEDAAA"]');
});
