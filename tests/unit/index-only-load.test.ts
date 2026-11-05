import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { indexOnlyKey } from "@/lib/search-index/index-only-document";
import { linesOf } from "@/lib/search-index/index-only-files";
import { buildLinks } from "@/lib/search-index/index-only-links";
import { finishIndex, loadPart, type LoadOptions, type LoadSearch, prepareIndex } from "@/lib/search-index/index-only-load";

const work = (id: number, title = `Work ${id}`, references: number[] = []) =>
	JSON.stringify({
		id: `https://openalex.org/W${id}`,
		title,
		type: "article",
		publication_year: 2020,
		referenced_works: references.map((reference) => `https://openalex.org/W${reference}`),
	});

function fakeSearch(bulkItems: object[] = []) {
	const bulks: object[][] = [];
	const updateAliases = vi.fn(async () => ({}));
	const create = vi.fn(async () => ({}));
	const forcemerge = vi.fn(async () => ({}));
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
				forcemerge,
				stats: async () => ({ _all: { primaries: { store: { size_in_bytes: 1 } } } }),
				exists: async () => true,
				get: async ({ index }: { index: string }) => (index === "library" ? { library_1: {} } : { library_1: {}, library_2: {} }),
				putSettings: async () => ({}),
				refresh: async () => ({}),
				updateAliases,
			},
		},
	} as unknown as LoadSearch;
	return { search, bulks, updateAliases, create, forcemerge };
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
	const load = async (search: LoadSearch, options: LoadOptions) => {
		await buildLinks(folder, state);
		return loadPart(search, options);
	};

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

		const result = await load(search, { part: "0/1", files: folder, state });

		expect(result).toMatchObject({ works: 2, refused: 1, failed: 0 });
		expect(bulks.flat().filter((line) => "title" in line)).toHaveLength(2);
	});

	it("carries on from where a load stopped", async () => {
		file("a.jsonl.gz", [work(1)]);
		file("b.jsonl.gz", [work(2)]);
		const first = fakeSearch();
		await load(first.search, { part: "0/1", files: folder, state });
		file("c.jsonl.gz", [work(3)]);

		const next = fakeSearch();
		const result = await load(next.search, { part: "0/1", files: folder, state });

		expect(result.works).toBe(1);
		expect(readdirSync(join(state, "library_2")).sort()).toEqual(["a.jsonl.gz.done", "b.jsonl.gz.done", "c.jsonl.gz.done"]);
	});

	it("gives each part its share of the files", async () => {
		for (const name of ["a", "b", "c", "d"]) file(`${name}.jsonl.gz`, [work(name.charCodeAt(0))]);
		await buildLinks(folder, state);

		const results = await Promise.all(
			["0/2", "1/2"].map((part) => loadPart(fakeSearch().search, { part, files: folder, state })),
		);

		expect(results.map(({ works }) => works)).toEqual([2, 2]);
	});

	it("stops at its limit without marking the file done", async () => {
		file("a.jsonl.gz", [work(1), work(2), work(3)]);

		const result = await load(fakeSearch().search, { part: "0/1", files: folder, state, limit: 2 });

		expect(result.works).toBe(2);
		expect(readdirSync(join(state, "library_2"))).toEqual([]);
	});

	it("links works across files, to records of the library only, and counts references a file only lists", async () => {
		file("a.jsonl.gz", [work(1, "One", [2, 3, 99, 1])]);
		file("b.jsonl.gz", [work(2, "Two", [3]), work(3, "Three")]);
		const { search, bulks } = fakeSearch();

		await expect(buildLinks(folder, state)).resolves.toEqual({ works: 3, links: 3 });
		await loadPart(search, { part: "0/1", files: folder, state });

		const documents = bulks.flat().filter((line) => "title" in line) as unknown as Array<{
			title: string;
			links: object;
			citationCount: number;
			citationMetrics: Array<{ referencedWorksCount: number }>;
		}>;
		const named = Object.fromEntries(documents.map((document) => [document.title, document]));
		const [one, two, three] = [1, 2, 3].map(indexOnlyKey);
		expect(named.One!.links).toEqual({ cites: [two, three], citedBy: [], related: [] });
		expect(named.Two!.links).toEqual({ cites: [three], citedBy: [one], related: [] });
		expect(named.Three!.links).toEqual({ cites: [], citedBy: expect.arrayContaining([one, two]), related: [] });
		expect(named.Three!.citationCount).toBe(2);
		expect(named.One!.citationMetrics[0]!.referencedWorksCount).toBe(4);
	});

	it("refuses a load without its links, rather than show none", async () => {
		file("a.jsonl.gz", [work(1)]);

		await expect(loadPart(fakeSearch().search, { part: "0/1", files: folder, state })).rejects.toThrow("run --links first");
	});

	it("loads a new index in full, whatever an earlier index finished", async () => {
		file("a.jsonl.gz", [work(1)]);
		await load(fakeSearch().search, { part: "0/1", files: folder, state });

		const { search } = fakeSearch();
		search.client.indices.get = (async () => ({ library_3: {} })) as never;
		const result = await load(search, { part: "0/1", files: folder, state });

		expect(result.works).toBe(1);
	});

	it("counts a record Elasticsearch refuses, and says which, and that the part isn't complete", async () => {
		file("a.jsonl.gz", [work(1)]);
		const refused = { index: { _id: "ABCD2345", status: 400, error: { type: "mapper_parsing_exception", reason: "bad date" } } };

		const result = await load(fakeSearch([refused]).search, { part: "0/1", files: folder, state });

		expect(result).toMatchObject({
			failed: 1,
			complete: false,
			reasons: { "index: mapper_parsing_exception: bad date": { records: 1, first: "ABCD2345" } },
		});
	});

	it("stops the part when Elasticsearch is too busy, and leaves the file to run again", async () => {
		file("a.jsonl.gz", [work(1)]);
		const busy = { index: { _id: "ABCD2345", status: 429, error: { type: "es_rejected_execution_exception", reason: "queue full" } } };

		await expect(load(fakeSearch([busy]).search, { part: "0/1", files: folder, state })).rejects.toThrow("queue full");

		expect(readdirSync(join(state, "library_2"))).toEqual([]);
	});

	it("keeps a write's failure, however many writes finish after it", async () => {
		file("a.jsonl.gz", Array.from({ length: 2_500 }, (_, position) => work(position + 1)));
		const { search } = fakeSearch();
		search.client.bulk = vi
			.fn()
			.mockRejectedValueOnce(new Error("connection lost"))
			.mockResolvedValue({ items: [] }) as never;

		await expect(load(search, { part: "0/1", files: folder, state })).rejects.toThrow("connection lost");

		expect(readdirSync(join(state, "library_2"))).toEqual([]);
	});

	it("carries on past a damaged file, and leaves it to run again", async () => {
		file("a.jsonl.gz", [work(1)]);
		file("b.jsonl.gz", [work(2)]);
		await buildLinks(folder, state);
		writeFileSync(join(folder, "a.jsonl.gz"), gzipSync(work(1)).subarray(0, 12));

		const result = await loadPart(fakeSearch().search, { part: "0/1", files: folder, state });

		expect(result).toMatchObject({ works: 1, complete: false, damaged: [expect.stringContaining("a.jsonl.gz")] });
		expect(readdirSync(join(state, "library_2"))).toEqual(["b.jsonl.gz.done"]);
	});

	it("stops between records when asked, without marking the file done", async () => {
		file("a.jsonl.gz", [work(1)]);

		const result = await load(fakeSearch().search, { part: "0/1", files: folder, state, signal: AbortSignal.abort() });

		expect(result).toMatchObject({ works: 0, complete: false });
		expect(readdirSync(join(state, "library_2"))).toEqual([]);
	});

	it("refuses a part it can't read, and a load with no index to fill", async () => {
		for (const part of ["one", "2/2", "1/0", "1.5/2", "-1/2"]) {
			await expect(load(fakeSearch().search, { part, files: folder, state })).rejects.toThrow("written <i>/<n>");
		}
		const { search } = fakeSearch();
		search.client.indices.get = (async () => ({})) as never;
		await expect(loadPart(search, { part: "0/1", files: folder, state })).rejects.toThrow("run --prepare first");
	});

	it("creates its index with refresh off, saying it holds the only copy of the records", async () => {
		const { search, create } = fakeSearch();

		await prepareIndex(search, 4);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				settings: expect.objectContaining({ index: expect.objectContaining({ number_of_shards: 4, refresh_interval: "-1" }) }),
				mappings: expect.objectContaining({
					_meta: expect.objectContaining({ indexOnly: true }),
					properties: expect.objectContaining({ links: { type: "object", enabled: false } }),
				}),
			}),
		);
	});

	it("moves the alias to the full index, merges it, and names the index readers left", async () => {
		file("a.jsonl.gz", [work(1), work(2)]);
		const { search, updateAliases, forcemerge } = fakeSearch();
		await load(search, { part: "0/1", files: folder, state });

		const finished = await finishIndex(search, { files: folder, state });

		expect(finished).toEqual({ finished: "library_2", records: 3, works: 2, refused: 0, failed: 0, replaced: ["library_1"] });
		expect(updateAliases).toHaveBeenCalledWith({
			actions: [{ remove: { index: "library_1", alias: "library" } }, { add: { index: "library_2", alias: "library", is_write_index: true } }],
		});
		expect(forcemerge).toHaveBeenCalledWith(expect.objectContaining({ index: "library_2" }), expect.anything());
	});

	it("won't finish before every file has loaded into this index", async () => {
		file("a.jsonl.gz", [work(1)]);
		file("b.jsonl.gz", [work(2)]);
		const { search, updateAliases } = fakeSearch();
		await load(search, { part: "0/2", files: folder, state });

		await expect(finishIndex(search, { files: folder, state })).rejects.toThrow("1 of 2 files aren't loaded");

		expect(updateAliases).not.toHaveBeenCalled();
		expect(existsSync(join(state, "library_2", "a.jsonl.gz.done"))).toBe(true);
	});

	it("won't finish an empty folder or an empty index", async () => {
		const { search, updateAliases } = fakeSearch();
		await expect(finishIndex(search, { files: folder, state })).rejects.toThrow("0 of 0 files");

		file("a.jsonl.gz", ["not json"]);
		await load(search, { part: "0/1", files: folder, state });
		search.client.count = (async () => ({ count: 0 })) as never;
		await expect(finishIndex(search, { files: folder, state })).rejects.toThrow("holds no records");

		expect(updateAliases).not.toHaveBeenCalled();
	});
});
