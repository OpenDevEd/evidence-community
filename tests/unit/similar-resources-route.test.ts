import { MeilisearchApiError } from "meilisearch";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: {
		content: { tags: { hidden: [] as string[], publish: [] as string[] } },
		sources: [],
		features: { relatedResources: true },
		search: {
			embedder: {
				source: "openAi",
				model: "text-embedding-3-small",
				apiKey: "embedding-key",
			} as Record<string, string> | null,
		},
	},
	item: {
		item: {
			key: "ABCDEFGH",
			title: "Mobile phones and literacy",
			itemType: "journalArticle",
			fullNames: ["Amina Okafor"],
		},
	} as { item: Record<string, unknown> } | null,
	search: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => mocks.config),
}));
vi.mock("@/app/api/cache", () => ({
	getCachedItem: vi.fn(),
	getCachedItemSmall: vi.fn(async () => mocks.item),
}));
vi.mock("@/app/api/item/[key]/route", () => ({ getItem: vi.fn() }));
vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: vi.fn(async () => ({
		index: { search: mocks.search },
	})),
}));

import { GET } from "@/app/api/similar/[key]/route";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";

function meilisearchError(code: string) {
	return new MeilisearchApiError(new Response(null, { status: 400 }), {
		code,
		link: "https://www.meilisearch.com/docs/reference/errors/error_codes",
		message: `Meilisearch reported ${code}`,
		type: "invalid_request",
	});
}

function request(key = "ABCDEFGH") {
	return GET(
		new NextRequest(`https://library.example.org/api/similar/${key}`),
		{ params: Promise.resolve({ key }) },
	);
}

describe("Similar Resources route", () => {
	beforeEach(() => {
		mocks.search.mockReset();
		mocks.config.features.relatedResources = true;
		mocks.config.search.embedder = {
			source: "openAi",
			model: "text-embedding-3-small",
			apiKey: "embedding-key",
		};
		mocks.item = {
			item: {
				key: "ABCDEFGH",
				title: "Mobile phones and literacy",
				itemType: "journalArticle",
				fullNames: ["Amina Okafor"],
			},
		};
	});

	it("searches with the shared embedder name and returns the hits", async () => {
		mocks.search.mockResolvedValue({
			hits: [{ key: "ZYXWVUTS", title: "Radio lessons" }],
			estimatedTotalHits: 1,
		});

		const response = await request();

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			hits: [{ key: "ZYXWVUTS" }],
		});
		const options = mocks.search.mock.calls[0]?.[1] as {
			hybrid: { embedder: string };
			filter: string[];
		};
		expect(options.hybrid.embedder).toBe(PLATFORM_SEARCH_EMBEDDER);
		expect(options.filter).toContain("key != ABCDEFGH");
	});

	it.each(["invalid_search_embedder", "vector_embedding_error"])(
		"answers 503 when Meilisearch reports %s",
		async (code) => {
			mocks.search.mockRejectedValue(meilisearchError(code));

			const response = await request();

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({
				error: "Similar resources are not ready",
			});
			expect(response.headers.get("Cache-Control")).toBeNull();
		},
	);

	it("rethrows other Meilisearch errors", async () => {
		mocks.search.mockRejectedValue(meilisearchError("index_not_found"));

		await expect(request()).rejects.toBeInstanceOf(MeilisearchApiError);
	});

	it("returns an empty result without searching when the library has no embedder", async () => {
		mocks.config.search.embedder = null;

		const response = await request();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ hits: [], totalHits: 0 });
		expect(mocks.search).not.toHaveBeenCalled();
	});

	it("returns an empty result without searching when related resources are off", async () => {
		mocks.config.features.relatedResources = false;

		const response = await request();

		expect(await response.json()).toEqual({ hits: [], totalHits: 0 });
		expect(mocks.search).not.toHaveBeenCalled();
	});

	it("answers 404 for an unknown record", async () => {
		mocks.item = null;

		const response = await request("NOPE0000");

		expect(response.status).toBe(404);
		expect(mocks.search).not.toHaveBeenCalled();
	});
});
