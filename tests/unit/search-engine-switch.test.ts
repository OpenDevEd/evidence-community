import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every step the switch takes, in order, and how the fakes behave. */
const world = vi.hoisted(() => ({
	steps: [] as string[],
	records: { elasticsearch: false, meilisearch: false } as Record<string, boolean>,
	/** An index a killed rebuild left, which no reader sees and no count finds. */
	leftovers: { elasticsearch: false, meilisearch: false } as Record<string, boolean>,
	rebuildFails: false,
	removeFails: false,
	waitAborts: false,
	unreachable: "" as string,
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
	OLD_INDEX_GRACE_MS: 10_000,
	setSearchEngine: async (_database: unknown, engine: string) => void world.steps.push(`readers to ${engine}`),
	setSearchIndexRebuildPending: async (_database: unknown, pending: boolean) => void world.steps.push(`pending ${pending}`),
}));
vi.mock("@/lib/search-index/engine-setup", () => ({
	openSearchWriter: async (_config: unknown, engine: string) => ({
		hasRecords: async () => {
			if (world.unreachable === engine) throw new Error(`${engine} is unreachable`);
			return world.records[engine];
		},
		holdsIndex: async () => {
			if (world.unreachable === engine) throw new Error(`${engine} is unreachable`);
			return world.records[engine] || world.leftovers[engine];
		},
		writer: {
			remove: async () => {
				if (world.removeFails) throw new Error("search host went away");
				world.steps.push(`delete ${engine}`);
			},
		},
	}),
}));

import { readersEngineOnFailure, settleSearchEngine, switchRetryAt } from "@/lib/search-index/engine-switch";
import { SearchOutboxAbortError } from "@/lib/search-index/writer";

const connection = { host: "http://search", key: "key", index: "library" };
const both = { services: { search: { engine: "meilisearch", elasticsearch: connection, meilisearch: connection } } };
const meilisearchOnly = { services: { search: { engine: "meilisearch", meilisearch: connection } } };

function settle(input: { config?: object; live: "elasticsearch" | "meilisearch" | null; rebuild?: boolean; embedderBlocksRebuild?: boolean }) {
	return settleSearchEngine({
		config: (input.config ?? both) as never,
		database: {} as never,
		embedderBlocksRebuild: input.embedderBlocksRebuild ?? false,
		live: input.live,
		rebuild: input.rebuild ?? false,
		signal: new AbortController().signal,
		taskTimeoutMs: 1_000,
		writer: { engine: "meilisearch" } as never,
	});
}

beforeEach(() => {
	Object.assign(world, { steps: [], records: { elasticsearch: false, meilisearch: false }, leftovers: { elasticsearch: false, meilisearch: false }, rebuildFails: false, removeFails: false, waitAborts: false, unreachable: "" });
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

	it("waits for a broken embedder with readers, and writes, on the old engine, and tries again in 30 minutes", async () => {
		const settled = await settle({ live: "elasticsearch", embedderBlocksRebuild: true });
		expect(settled).toMatchObject({ rebuilt: null, readersOn: "elasticsearch" });
		expect(world.steps).toEqual([]);
		expect(switchRetryAt(settled.readersOn, "meilisearch", 0)).toBe(30 * 60_000);
		expect(switchRetryAt((await settle({ live: "elasticsearch" })).readersOn, "meilisearch", 0)).toBeNull();
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
		await settle({ live: null, rebuild: true });
		expect(world.steps).toEqual(["rebuild meilisearch", "pending false", "readers to meilisearch"]);
	});

	it("records an index that was complete before engines were recorded, without rebuilding it", async () => {
		await settle({ live: null });
		expect(world.steps).toEqual(["readers to meilisearch"]);
	});

	it("records the configured engine on a first start when the other engine can't be reached", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		world.unreachable = "elasticsearch";
		expect(await settle({ live: null, rebuild: true })).toMatchObject({ readersOn: "meilisearch" });
		expect(world.steps).toEqual(["rebuild meilisearch", "pending false", "readers to meilisearch"]);
		error.mockRestore();
	});

	it("keeps readers on the other engine's records while the configured engine's new index is built, after any restart", async () => {
		world.records.elasticsearch = true;
		expect(await settle({ live: null, rebuild: true })).toMatchObject({ switchedFrom: "elasticsearch" });
		expect(world.steps).toEqual(["readers to elasticsearch", "rebuild meilisearch", "pending false", "readers to meilisearch", "wait 10000", "delete elasticsearch"]);
	});
});

describe("a start with readers on the configured engine", () => {
	it("only rebuilds when asked", async () => {
		await settle({ live: "meilisearch" });
		expect(world.steps).toEqual([]);
	});

	it("keeps working when the engine it doesn't search can't be reached", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		world.unreachable = "elasticsearch";
		expect(await settle({ live: "meilisearch" })).toMatchObject({ oldIndexRemoved: false, readersOn: "meilisearch" });
		expect(error).toHaveBeenCalledWith(expect.stringContaining("elasticsearch is unreachable"));
		error.mockRestore();
	});

	it("deletes an old index a stopped switch left behind", async () => {
		world.records.elasticsearch = true;
		expect(await settle({ live: "meilisearch" })).toMatchObject({ oldIndexRemoved: true });
		expect(world.steps).toEqual(["wait 10000", "delete elasticsearch"]);
	});

	it("deletes an index a killed rebuild left, though no count finds its records, without moving readers to it", async () => {
		world.leftovers.elasticsearch = true;
		expect(await settle({ live: null })).toMatchObject({ readersOn: "meilisearch", oldIndexRemoved: true });
		expect(world.steps).toEqual(["readers to meilisearch", "wait 10000", "delete elasticsearch"]);
	});
});

describe("a configured engine that can't start", () => {
	const failure = new Error("security_exception: unable to authenticate user [el_library]");
	const running = new AbortController().signal;
	const choosingElasticsearch = { services: { search: { ...both.services.search, engine: "elasticsearch" } } } as never;

	it("keeps readers on the engine they search while its connection is still configured", () => {
		expect(readersEngineOnFailure(choosingElasticsearch, "meilisearch", failure, running)).toBe("meilisearch");
	});

	it("stops the worker when readers have no other engine to stay on, or the worker is stopping", () => {
		const elasticsearchOnly = { services: { search: { engine: "elasticsearch", elasticsearch: connection } } } as never;
		const stopped = new AbortController();
		stopped.abort();
		expect(readersEngineOnFailure(choosingElasticsearch, null, failure, running)).toBeNull();
		expect(readersEngineOnFailure(choosingElasticsearch, "elasticsearch", failure, running)).toBeNull();
		expect(readersEngineOnFailure(elasticsearchOnly, "meilisearch", failure, running)).toBeNull();
		expect(readersEngineOnFailure(choosingElasticsearch, "meilisearch", failure, stopped.signal)).toBeNull();
		expect(readersEngineOnFailure(choosingElasticsearch, "meilisearch", new SearchOutboxAbortError(), running)).toBeNull();
	});
});
