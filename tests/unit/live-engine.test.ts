import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({ engine: "meilisearch" as string | null, fail: false, reads: 0 }));
vi.mock("@/db", () => ({
	getDatabaseForConfig: async () => {
		if (database.fail) throw new Error("database unavailable");
		return {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: async () => {
							database.reads += 1;
							return [{ engine: database.engine }];
						},
					}),
				}),
			}),
		};
	},
}));

const { readLiveSearchEngine } = await vi.importActual<typeof import("@/lib/search-engines/live-engine")>("@/lib/search-engines/live-engine");

const library = (url: string) => ({ revision: "r1", updatedAt: "2026-10-26T00:00:00.000Z", services: { database: { url } } }) as never;

afterEach(() => {
	vi.useRealTimers();
	database.fail = false;
});

describe("the engine a library's readers search", () => {
	it("is the one the search worker recorded, read again only after a few seconds", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		database.engine = "meilisearch";
		database.reads = 0;
		expect(await readLiveSearchEngine(library("postgresql://one"))).toBe("meilisearch");
		database.engine = "elasticsearch";
		expect(await readLiveSearchEngine(library("postgresql://one"))).toBe("meilisearch");
		vi.setSystemTime(Date.now() + 6_000);
		expect(await readLiveSearchEngine(library("postgresql://one"))).toBe("elasticsearch");
		expect(database.reads).toBe(2);
	});

	it("is none when the status was never read and can't be read, so readers search the configured engine", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		database.fail = true;
		expect(await readLiveSearchEngine(library("postgresql://two"))).toBeNull();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("stays the engine read before when a later read fails, which mid-switch is the complete one", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		database.engine = "meilisearch";
		expect(await readLiveSearchEngine(library("postgresql://three"))).toBe("meilisearch");
		vi.setSystemTime(Date.now() + 6_000);
		database.fail = true;
		expect(await readLiveSearchEngine(library("postgresql://three"))).toBe("meilisearch");
		warn.mockRestore();
	});
});
