import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every step the switch takes, in order, and how the fakes behave. */
const world = vi.hoisted(() => ({
	steps: [] as string[],
	records: { elasticsearch: false, meilisearch: false } as Record<string, boolean>,
	rebuildFails: false,
	removeFails: false,
	waitAborts: false,
}));
vi.mock("node:timers/promises", () => ({
	setTimeout: async (ms: number) => {
		world.steps.push(`wait ${ms}`);
		if (world.waitAborts) throw new Error("The operation was aborted");
	},
}));
vi.mock("@/lib/search-index/consumer", () => ({
	rebuildSearchIndex: async (_database: unknown, writer: { engine: string }) => {
		world.steps.push(`rebuild ${writer.engine}`);
		if (world.rebuildFails) throw new Error("rebuild failed");
		return { indexed: 10, deleted: 0, redrained: 0 };
	},
}));
vi.mock("@/lib/search-index/bootstrap-state", () => ({
	LIVE_ENGINE_TTL_MS: 5_000,
	setSearchEngine: async (_database: unknown, engine: string) => void world.steps.push(`readers to ${engine}`),
	setSearchIndexRebuildPending: async (_database: unknown, pending: boolean) => void world.steps.push(`pending ${pending}`),
}));
vi.mock("@/lib/search-index/engine-setup", () => ({
	openSearchWriter: async (_config: unknown, engine: string) => ({
		hasRecords: async () => world.records[engine],
		writer: {
			remove: async () => {
				if (world.removeFails) throw new Error("search host went away");
				world.steps.push(`delete ${engine}`);
			},
		},
	}),
}));

import { settleSearchEngine } from "@/lib/search-index/engine-switch";

const connection = { host: "http://search", key: "key", index: "library" };
const both = { services: { search: { engine: "meilisearch", elasticsearch: connection, meilisearch: connection } } };
const meilisearchOnly = { services: { search: { engine: "meilisearch", meilisearch: connection } } };

function settle(input: { config?: object; live: "elasticsearch" | "meilisearch" | null; rebuild?: boolean; indexCreated?: boolean; embedderBlocksRebuild?: boolean }) {
	return settleSearchEngine({
		config: (input.config ?? both) as never,
		database: {} as never,
		embedderBlocksRebuild: input.embedderBlocksRebuild ?? false,
		indexCreated: input.indexCreated ?? false,
		live: input.live,
		rebuild: input.rebuild ?? false,
		signal: new AbortController().signal,
		taskTimeoutMs: 1_000,
		writer: { engine: "meilisearch" } as never,
	});
}

beforeEach(() => {
	Object.assign(world, { steps: [], records: { elasticsearch: false, meilisearch: false }, rebuildFails: false, removeFails: false, waitAborts: false });
});

describe("switching a library to another engine", () => {
	it("builds the new index, then moves readers, then deletes the old index once their cache expired", async () => {
		world.records.elasticsearch = true;
		expect(await settle({ live: "elasticsearch" })).toMatchObject({ switchedFrom: "elasticsearch", oldIndexRemoved: true, readersOn: "meilisearch" });
		expect(world.steps).toEqual(["rebuild meilisearch", "pending false", "readers to meilisearch", "wait 10000", "delete elasticsearch"]);
	});

	it("keeps readers on the old engine, and deletes nothing, when the new index can't be built", async () => {
		world.rebuildFails = true;
		await expect(settle({ live: "elasticsearch" })).rejects.toThrow("rebuild failed");
		expect(world.steps).toEqual(["rebuild meilisearch"]);
	});

	it("leaves the old index to the next start when the worker stops during the wait", async () => {
		world.waitAborts = true;
		await expect(settle({ live: "elasticsearch" })).rejects.toThrow("aborted");
		expect(world.steps).toEqual(["rebuild meilisearch", "pending false", "readers to meilisearch", "wait 10000"]);
	});

	it("waits for a broken embedder with readers, and writes, on the old engine", async () => {
		expect(await settle({ live: "elasticsearch", embedderBlocksRebuild: true })).toMatchObject({ rebuilt: null, readersOn: "elasticsearch" });
		expect(world.steps).toEqual([]);
	});

	it("warns, and writes to the new engine, when the configuration has no old connection left", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await settle({ live: "elasticsearch", config: meilisearchOnly, embedderBlocksRebuild: true })).toMatchObject({ readersOn: "meilisearch" });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("no elasticsearch connection left"));
		warn.mockRestore();
	});

	it("keeps going when deleting the old index fails, leaving an unused index", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		world.removeFails = true;
		expect(await settle({ live: "elasticsearch" })).toMatchObject({ switchedFrom: "elasticsearch", oldIndexRemoved: false });
		expect(error).toHaveBeenCalledWith(expect.stringContaining("search host went away"));
		error.mockRestore();
	});
});

describe("a library's first recorded engine", () => {
	it("records the configured engine once its first index is complete", async () => {
		await settle({ live: null, rebuild: true, indexCreated: true });
		expect(world.steps).toEqual(["rebuild meilisearch", "pending false", "readers to meilisearch"]);
	});

	it("records an index that was complete before engines were recorded, without rebuilding it", async () => {
		await settle({ live: null });
		expect(world.steps).toEqual(["readers to meilisearch"]);
	});

	it("keeps readers on the other engine's records while the configured engine's new index is built", async () => {
		world.records.elasticsearch = true;
		expect(await settle({ live: null, rebuild: true, indexCreated: true })).toMatchObject({ switchedFrom: "elasticsearch" });
		expect(world.steps).toEqual(["readers to elasticsearch", "rebuild meilisearch", "pending false", "readers to meilisearch", "wait 10000", "delete elasticsearch"]);
	});
});

describe("a start with readers on the configured engine", () => {
	it("only rebuilds when asked", async () => {
		await settle({ live: "meilisearch" });
		expect(world.steps).toEqual([]);
	});

	it("deletes an old index a stopped switch left behind", async () => {
		world.records.elasticsearch = true;
		expect(await settle({ live: "meilisearch" })).toMatchObject({ oldIndexRemoved: true });
		expect(world.steps).toEqual(["wait 10000", "delete elasticsearch"]);
	});
});
