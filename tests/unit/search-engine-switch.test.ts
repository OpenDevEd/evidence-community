import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ rebuilt: 0, live: [] as string[], removed: [] as string[], removeFails: false }));
vi.mock("@/lib/search-index/consumer", () => ({
	rebuildSearchIndex: async () => {
		calls.rebuilt += 1;
		return { indexed: 10, deleted: 0, redrained: 0 };
	},
}));
vi.mock("@/lib/search-index/bootstrap-state", () => ({
	LIVE_ENGINE_TTL_MS: 5_000,
	setSearchEngine: async (_database: unknown, engine: string) => void calls.live.push(engine),
}));
vi.mock("@/lib/search-index/engine-setup", () => ({
	openSearchWriter: async (_config: unknown, engine: string) => ({
		writer: {
			remove: async () => {
				if (calls.removeFails) throw new Error("search host went away");
				calls.removed.push(engine);
			},
		},
	}),
}));

import { settleSearchEngine } from "@/lib/search-index/engine-switch";

// The old index stays a while after readers move; these checks record the wait instead of waiting.
const waits = vi.hoisted(() => [] as number[]);
vi.mock("node:timers/promises", () => ({ setTimeout: async (ms: number) => void waits.push(ms) }));

const connection = { host: "http://search", key: "key", index: "library" };
const bothEngines = { services: { search: { engine: "meilisearch", elasticsearch: connection, meilisearch: connection } } } as never;
const meilisearchOnly = { services: { search: { engine: "meilisearch", meilisearch: connection } } } as never;
const writer = { engine: "meilisearch" } as never;
const settle = (input: { config?: unknown; live: "elasticsearch" | "meilisearch" | null; rebuild?: boolean; embedderBlocksRebuild?: boolean }) =>
	settleSearchEngine({
		config: (input.config ?? bothEngines) as never,
		database: {} as never,
		embedderBlocksRebuild: input.embedderBlocksRebuild ?? false,
		live: input.live,
		rebuild: input.rebuild ?? false,
		signal: new AbortController().signal,
		taskTimeoutMs: 1_000,
		writer,
	});

beforeEach(() => {
	Object.assign(calls, { rebuilt: 0, live: [], removed: [], removeFails: false });
	waits.length = 0;
});

describe("settling a library's search engine", () => {
	it("builds the configured engine's index before readers move to it, then deletes the old one", async () => {
		expect(await settle({ live: "elasticsearch" })).toMatchObject({ switchedFrom: "elasticsearch", oldIndexRemoved: true });
		expect(calls).toMatchObject({ rebuilt: 1, live: ["meilisearch"], removed: ["elasticsearch"] });
		// Readers trust the engine they read for 5 s, so the old index stays twice that before it goes.
		expect(waits).toEqual([10_000]);
	});

	it("keeps readers on the old engine while the new engine's embedder is broken", async () => {
		expect(await settle({ live: "elasticsearch", embedderBlocksRebuild: true })).toMatchObject({ rebuilt: null, switchedFrom: null });
		expect(calls).toMatchObject({ rebuilt: 0, live: [], removed: [] });
	});

	it("records a library's first complete index", async () => {
		await settle({ live: null, rebuild: true });
		expect(calls).toMatchObject({ rebuilt: 1, live: ["meilisearch"] });
	});

	it("records an index that was already complete before engines were recorded, without rebuilding it", async () => {
		await settle({ live: null });
		expect(calls).toMatchObject({ rebuilt: 0, live: ["meilisearch"] });
	});

	it("only rebuilds when asked once readers already search the configured engine", async () => {
		await settle({ live: "meilisearch" });
		expect(calls).toMatchObject({ rebuilt: 0, live: [], removed: [] });
	});

	it("leaves the old index alone when the old engine has no connection, or the delete fails", async () => {
		expect(await settle({ live: "elasticsearch", config: meilisearchOnly })).toMatchObject({ switchedFrom: "elasticsearch", oldIndexRemoved: false });
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		calls.removeFails = true;
		expect(await settle({ live: "elasticsearch" })).toMatchObject({ oldIndexRemoved: false });
		expect(error).toHaveBeenCalledWith(expect.stringContaining("search host went away"));
		error.mockRestore();
	});
});
