import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = vi.hoisted(() => ({ engine: null as "elasticsearch" | "meilisearch" | null }));
vi.mock("@/lib/search-engines/live-engine", () => ({ readLiveSearchEngine: async () => live.engine }));
vi.mock("@/lib/elasticsearch", () => ({ getSearchForConfig: async () => ({ alias: "library", client: {} }) }));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ client: {}, index: {}, indexName: "library" }) }));

import { getSearchEngine } from "@/lib/search-engines";

const connection = { host: "http://search", key: "key", index: "library" };
const library = (search: object) => ({ revision: "r1", updatedAt: "2026-10-26T00:00:00.000Z", services: { search } }) as never;

describe("the engine readers search", () => {
	it("is the configured one before the library's first build", async () => {
		live.engine = null;
		expect((await getSearchEngine(library({ engine: "elasticsearch", elasticsearch: connection }))).name).toBe("elasticsearch");
	});

	it("stays the old one while a switch builds the configured engine's index", async () => {
		live.engine = "meilisearch";
		expect((await getSearchEngine(library({ engine: "elasticsearch", elasticsearch: connection, meilisearch: connection }))).name).toBe("meilisearch");
	});

	it("is the configured one when the old engine has no connection left", async () => {
		live.engine = "meilisearch";
		expect((await getSearchEngine(library({ engine: "elasticsearch", elasticsearch: connection }))).name).toBe("elasticsearch");
	});
});
