import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	getDatabaseForConfig: vi.fn(),
	readPublicLibraryStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
	cacheLife: vi.fn(),
	cacheTag: vi.fn(),
}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));
vi.mock("@/db", () => ({
	getDatabaseForConfig: mocks.getDatabaseForConfig,
}));
vi.mock("@/lib/library-export-records", () => ({
	readPublicLibraryStatus: mocks.readPublicLibraryStatus,
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
	it("does not read the library when sitemap publication is disabled", async () => {
		await expect(
			getSitemapPageCount(config(false)),
		).resolves.toBe(0);
		expect(
			mocks.readPublicLibraryStatus,
		).not.toHaveBeenCalled();
	});

	it("counts shards of the library's public records when sitemap publication is enabled", async () => {
		mocks.readPublicLibraryStatus.mockResolvedValue({
			totalItems: SITEMAP_SIZE + 1,
		});

		await expect(
			getSitemapPageCount(config(true)),
		).resolves.toBe(2);
		expect(mocks.readPublicLibraryStatus).toHaveBeenCalledOnce();
	});
});
