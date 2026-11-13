import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { getSearchForConfig } from "@/lib/elasticsearch";
import { indexHoldsTheRecords } from "@/lib/search-index/engine-setup";
import { isIndexOnly } from "@/lib/search-index/index-only";
import { documentFromWork, indexOnlyKey } from "@/lib/search-index/index-only-document";
import { readIndexedItem, readIndexedStatus } from "@/lib/search-index/index-only-read";
import { cloneLibraryConfig, minimalLibraryConfig } from "../fixtures/library-config";

const getMapping = vi.hoisted(() => vi.fn());
vi.mock("@/lib/elasticsearch", () => ({ getSearchForConfig: vi.fn() }));
vi.mock("@/lib/elasticsearch-factory", () => ({
	RevisionAwareSearchFactory: class {
		get = async () => ({ alias: "library", client: { indices: { getMapping } } });
	},
}));

const loadedAt = new Date("2026-11-05T00:00:00Z");
const options = { sourceConnectionKey: "server-files", loadedAt, links: { cites: [], citedBy: [], related: [] } };
const work = {
	id: "https://openalex.org/W2620998106",
	title: "Teachers and literacy in Kenya",
	type: "article",
	doi: "https://doi.org/10.1234/abc",
	language: "en",
	publication_date: "2018-06-01",
	publication_year: 2018,
	cited_by_count: 7,
	referenced_works_count: 2,
	open_access: { is_oa: true },
	abstract_inverted_index: { Teachers: [0], teach: [1] },
	best_oa_location: { is_oa: true, pdf_url: "https://example.org/paper.pdf", landing_page_url: "https://example.org/paper" },
	authorships: [
		{
			raw_author_name: "A. Author",
			author: { display_name: "A. Author" },
			institutions: [{ id: "https://openalex.org/I1", display_name: "University of Nairobi", country_code: "KE" }],
		},
		{
			raw_author_name: "B. Author",
			author: { display_name: "B. Author" },
			institutions: [{ id: "https://openalex.org/I2", display_name: "Makerere University", country_code: "UG" }],
		},
	],
};

describe("index-only records", () => {
	it("gives every OpenAlex id its own stable, valid record key", () => {
		const ids = [1, 2, 33, 2620998106, 7220200302, 2620998106 + 700_000_000_000];
		const keys = ids.map(indexOnlyKey);
		expect(new Set(keys).size).toBe(ids.length);
		expect(keys.every(isCanonicalRecordKey)).toBe(true);
		expect(indexOnlyKey(2620998106)).toBe(indexOnlyKey(2620998106));
		expect(() => indexOnlyKey(33 ** 8)).toThrow("too large");
	});

	it("makes a search document from a work, with its authors' institutions and countries", () => {
		const document = documentFromWork(work, options);

		expect(document).toMatchObject({
			title: "Teachers and literacy in Kenya",
			DOI: "10.1234/abc",
			abstractNote: "Teachers teach",
			year: "2018",
			country: ["KE"],
			authorCountry: ["KE", "UG"],
			institutionsWithAuthors: ["University of Nairobi", "Makerere University"],
			fullNames: ["A. Author", "B. Author"],
			citationCount: 7,
			openAccess: true,
			hasPdf: true,
			sourceRecordKey: "W2620998106",
			deleted: 0,
		});
		expect(document.key).toBe(indexOnlyKey(2620998106));
	});

	it("links a work's PDF without storing it, under a key of its own", () => {
		const document = documentFromWork(work, options);
		const [pdf] = document.attachmentsData as { key: string; linkMode: string; url: string }[];

		expect(pdf).toMatchObject({ linkMode: "linked_url", url: "https://example.org/paper.pdf" });
		expect(pdf!.key).not.toBe(document.key);
	});

	it("is only ever on for a library that asks for it", () => {
		const search = (value: object) => ({ services: { search: value } }) as Parameters<typeof isIndexOnly>[0];

		expect(isIndexOnly(search({ engine: "elasticsearch", indexOnly: true }))).toBe(true);
		expect(isIndexOnly(search({ engine: "elasticsearch", indexOnly: false }))).toBe(false);
		expect(isIndexOnly(search({ engine: "meilisearch" }))).toBeFalsy();
	});

	describe("its configuration", () => {
		const elasticsearch = { host: "http://elasticsearch:9200", key: "search-key", index: "library" };
		const indexOnlyConfig = () => {
			const config = cloneLibraryConfig(minimalLibraryConfig);
			config.services.search = { engine: "elasticsearch", elasticsearch, indexOnly: true } as never;
			return Object.assign(config, {
				sources: [],
				collections: [],
				features: { collections: false } as Record<string, boolean>,
				generation: { sitemap: false },
			});
		};
		const refusedPaths = (config: unknown) => libraryConfigSchema.safeParse(config).error?.issues.map(({ path }) => path.join("."));

		it("accepts a library that leaves off what needs records in the database", () => {
			expect(refusedPaths(indexOnlyConfig())).toBeUndefined();
		});

		it("refuses everything that would look for records in the database", () => {
			const config = indexOnlyConfig();
			config.features.downloads = true;
			config.features.atomFeed = true;
			config.generation.sitemap = true;
			Object.assign(config.generation, { indexNow: true });
			Object.assign(config, { navigation: { links: [{ id: "numbers", label: "Numbers", href: "/statistics", icon: "LibraryIcon" }] } });

			expect(refusedPaths(config)).toEqual(expect.arrayContaining(["features.downloads", "features.atomFeed", "generation.sitemap", "generation.indexNow", "navigation.links"]));
		});

		it("leaves Ask AI on, which reads its records from the index", () => {
			const config = indexOnlyConfig();
			config.features.ai = true;
			const provider = { provider: "openrouter", enabled: true, apiKey: "key", models: ["a/model"], defaultModel: "a/model" };
			Object.assign(config, { ai: { providers: [provider] } });
			Object.assign(config.services, { redis: { url: "redis://redis:6379" } });

			expect(refusedPaths(config)).toBeUndefined();
		});

		it("asks nothing of a library that isn't index-only", () => {
			const config = indexOnlyConfig();
			config.services.search = { engine: "elasticsearch", elasticsearch } as never;
			config.features.downloads = true;

			expect(refusedPaths(config)).toBeUndefined();
		});
	});

	describe("the index that holds its records", () => {
		const configOn = (engine: string) => ({ revision: "1", updatedAt: "2026-11-05T00:00:00Z", services: { search: { engine, elasticsearch: {} } } }) as never;
		const config = configOn("elasticsearch");

		it("says so to the search worker, even before an alias reaches it, and a normal index doesn't", async () => {
			getMapping.mockResolvedValueOnce({ library_2: { mappings: { _meta: { version: "1", indexOnly: true } } } });
			await expect(indexHoldsTheRecords(config)).resolves.toBe(true);
			expect(getMapping).toHaveBeenLastCalledWith({ index: "library_*" });

			getMapping.mockResolvedValueOnce({ library_1: { mappings: { _meta: { version: "1" } } } });
			await expect(indexHoldsTheRecords(config)).resolves.toBe(false);
		});

		it("is none of a new library's concern yet", async () => {
			getMapping.mockResolvedValueOnce({});
			await expect(indexHoldsTheRecords(config)).resolves.toBe(false);
		});

		it("still stops a library that moved to another engine in the configuration", async () => {
			getMapping.mockResolvedValueOnce({ library_2: { mappings: { _meta: { indexOnly: true } } } });
			await expect(indexHoldsTheRecords(configOn("meilisearch"))).resolves.toBe(true);
		});

		it("doesn't hold up a library on another engine whose Elasticsearch can't answer yet", async () => {
			getMapping.mockRejectedValueOnce(new Error("no login yet"));
			await expect(indexHoldsTheRecords(configOn("meilisearch"))).resolves.toBe(false);
		});

		it("leaves a failed read to the worker in a library on Elasticsearch", async () => {
			getMapping.mockRejectedValueOnce(new Error("no answer"));
			await expect(indexHoldsTheRecords(config)).rejects.toThrow("no answer");
		});

		it("is never asked about in a library with no Elasticsearch", async () => {
			getMapping.mockClear();
			await expect(indexHoldsTheRecords({ services: { search: { engine: "meilisearch" } } } as never)).resolves.toBe(false);
			expect(getMapping).not.toHaveBeenCalled();
		});

		it("tells a failed read from a missing record", async () => {
			const mget = vi.fn().mockResolvedValue({ docs: [{ _id: "ABCD2345", error: { type: "shard_failure", reason: "no shard" } }] });
			vi.mocked(getSearchForConfig).mockResolvedValue({ alias: "library", client: { mget } } as never);
			await expect(readIndexedItem("ABCD2345", config)).rejects.toThrow("no shard");

			mget.mockResolvedValue({ docs: [{ _id: "ABCD2345", found: false }] });
			await expect(readIndexedItem("ABCD2345", config)).resolves.toBeNull();
		});

		it("counts no records before the first load finishes", async () => {
			const count = vi.fn().mockResolvedValue({ error: "index_not_found_exception", status: 404 });
			vi.mocked(getSearchForConfig).mockResolvedValue({ alias: "library", client: { count } } as never);

			await expect(readIndexedStatus(config)).resolves.toEqual({ totalItems: 0, latestPublicationUpdatedAt: null });
		});
	});
});
