import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { finishIndex, linesOf, loadPart, type LoadSearch, prepareIndex } from "@/lib/search-index/index-only-load";

const work = (id: number, title = `Work ${id}`) => JSON.stringify({ id: `https://openalex.org/W${id}`, title, type: "article", publication_year: 2020 });

function fakeSearch(bulkItems: object[] = []) {
	const bulks: object[][] = [];
	const updateAliases = vi.fn(async () => ({}));
	const create = vi.fn(async () => ({}));
	const search = {
		alias: "library",
		client: {
			bulk: vi.fn(async ({ operations }: { operations: object[] }) => {
				bulks.push(operations);
				return { items: bulkItems };
			}),
			count: async () => ({ count: 3 }),
			indices: {
				create,
				exists: async () => true,
				get: async ({ index }: { index: string }) => (index === "library" ? { library_1: {} } : { library_1: {}, library_2: {} }),
				putSettings: async () => ({}),
				refresh: async () => ({}),
				updateAliases,
			},
		},
	} as unknown as LoadSearch;
	return { search, bulks, updateAliases, create };
}

describe("loading an index-only library", () => {
	let folder: string;
	let state: string;

	beforeEach(() => {
		folder = mkdtempSync(join(tmpdir(), "index-only-files-"));
		state = mkdtempSync(join(tmpdir(), "index-only-state-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		rmSync(folder, { recursive: true });
		rmSync(state, { recursive: true });
		vi.restoreAllMocks();
	});

	const file = (name: string, lines: string[]) => writeFileSync(join(folder, name), gzipSync(lines.join("\n")));

	it("keeps a record whole when its text holds a line separator", async () => {
		const title = "Teachers and pupils";
		async function* stream() {
			yield Buffer.from(`${work(1, title)}\n${work(2).slice(0, 5)}`);
			yield Buffer.from(work(2).slice(5));
		}

		const lines = [];
		for await (const line of linesOf(stream())) lines.push(line);

		expect(lines).toEqual([work(1, title), work(2)]);
	});

	it("loads every work under its own key and reports the lines it can't use", async () => {
		file("a.jsonl.gz", [work(1), "not json", work(2)]);
		const { search, bulks } = fakeSearch();

		const result = await loadPart(search, { part: "0/1", files: folder, state });

		expect(result).toMatchObject({ works: 2, refused: 1, failed: 0 });
		expect(bulks.flat().filter((line) => "title" in line)).toHaveLength(2);
	});

	it("carries on from where a load stopped", async () => {
		file("a.jsonl.gz", [work(1)]);
		file("b.jsonl.gz", [work(2)]);
		const first = fakeSearch();
		await loadPart(first.search, { part: "0/1", files: folder, state });
		file("c.jsonl.gz", [work(3)]);

		const next = fakeSearch();
		const result = await loadPart(next.search, { part: "0/1", files: folder, state });

		expect(result.works).toBe(1);
		expect(readdirSync(state).sort()).toEqual(["a.jsonl.gz.done", "b.jsonl.gz.done", "c.jsonl.gz.done"]);
	});

	it("gives each part its share of the files", async () => {
		for (const name of ["a", "b", "c", "d"]) file(`${name}.jsonl.gz`, [work(name.charCodeAt(0))]);

		const results = await Promise.all(
			["0/2", "1/2"].map((part) => loadPart(fakeSearch().search, { part, files: folder, state })),
		);

		expect(results.map(({ works }) => works)).toEqual([2, 2]);
	});

	it("stops at its limit without marking the file done", async () => {
		file("a.jsonl.gz", [work(1), work(2), work(3)]);

		const result = await loadPart(fakeSearch().search, { part: "0/1", files: folder, state, limit: 2 });

		expect(result.works).toBe(2);
		expect(readdirSync(state)).toEqual([]);
	});

	it("counts a record Elasticsearch refuses", async () => {
		file("a.jsonl.gz", [work(1)]);

		const result = await loadPart(fakeSearch([{ index: { error: { type: "mapper_parsing_exception" } } }]).search, {
			part: "0/1",
			files: folder,
			state,
		});

		expect(result).toMatchObject({ failed: 1, reasons: { "index: mapper_parsing_exception": 1 } });
	});

	it("refuses a part it can't read, and a load with no index to fill", async () => {
		await expect(loadPart(fakeSearch().search, { part: "one", files: folder, state })).rejects.toThrow("written <i>/<n>");
		const { search } = fakeSearch();
		search.client.indices.get = async () => ({});
		await expect(loadPart(search, { part: "0/1", files: folder, state })).rejects.toThrow("run --prepare first");
	});

	it("creates its index with refresh off, and moves the alias to it when full", async () => {
		const { search, updateAliases, create } = fakeSearch();

		await prepareIndex(search, 4);
		const finished = await finishIndex(search);

		expect(create).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ index: expect.objectContaining({ number_of_shards: 4, refresh_interval: "-1" }) }) }));
		expect(finished).toEqual({ finished: "library_2", records: 3 });
		expect(updateAliases).toHaveBeenCalledWith({
			actions: [{ remove: { index: "library_1", alias: "library" } }, { add: { index: "library_2", alias: "library", is_write_index: true } }],
		});
	});
});
