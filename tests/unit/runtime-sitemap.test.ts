import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	getMeilisearchForConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
	cacheLife: vi.fn(),
	cacheTag: vi.fn(),
}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));
vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: mocks.getMeilisearchForConfig,
}));

import { SITEMAP_SIZE } from "@/constants/misc";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { getSitemapPageCount } from "@/lib/sitemap";
import { cloneLibraryConfig } from "../fixtures/library-config";

function config(sitemap: boolean) {
	const input = cloneLibraryConfig();
	input.generation = {
		redirects: true,
		sitemap,
	};
	return libraryConfigSchema.parse(input);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runtime sitemap page count", () => {
	it("does not touch Meilisearch when sitemap publication is disabled", async () => {
		await expect(
			getSitemapPageCount(config(false)),
		).resolves.toBe(0);
		expect(
			mocks.getMeilisearchForConfig,
		).not.toHaveBeenCalled();
	});

	it("counts configured-index shards when sitemap publication is enabled", async () => {
		const getStats = vi.fn().mockResolvedValue({
			numberOfDocuments: SITEMAP_SIZE + 1,
		});
		mocks.getMeilisearchForConfig.mockResolvedValue({
			index: { getStats },
		});

		await expect(
			getSitemapPageCount(config(true)),
		).resolves.toBe(2);
		expect(getStats).toHaveBeenCalledOnce();
	});
});
