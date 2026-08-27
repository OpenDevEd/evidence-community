import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	connection: vi.fn(),
	getDatabaseForConfig: vi.fn(),
	getLibraryConfig: vi.fn(),
	getMeilisearchForConfig: vi.fn(),
	getSitemapPageCount: vi.fn(),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => {
	class TestNextResponse extends Response {
		static json(body: unknown, init?: ResponseInit) {
			return Response.json(body, init);
		}
	}

	return {
		connection: mocks.connection,
		NextResponse: TestNextResponse,
	};
});
vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
}));
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
vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: mocks.getMeilisearchForConfig,
}));
vi.mock("@/config/library-config/gap-maps", () => ({
	getEnabledGapMaps: vi.fn(() => []),
}));
vi.mock("@/lib/language-alternates", () => ({
	buildLanguageAlternates: vi.fn(() => ({})),
	buildLocalizedSiteUrl: vi.fn(
		(pathname: string, _locale: string, _localization: unknown, baseUrl: string) =>
			new URL(pathname, baseUrl).toString(),
	),
}));
vi.mock("@/lib/policy-documents", () => ({
	loadPolicyDocument: vi.fn(async (_config: unknown, kind: string) =>
		kind === "terms"
			? null
			: { content: "", lastUpdated: new Date("2026-08-01T00:00:00Z") },
	),
}));
vi.mock("@/lib/utils", () => ({
	convertToImageURL: vi.fn((value: string) => value),
}));
vi.mock("@/lib/sitemap", () => ({
	getSitemapPageCount: mocks.getSitemapPageCount,
	getSitemapShardUrl: (id: number | string, baseUrl: string) =>
		new URL(`/sitemap/${id}.xml`, baseUrl).toString(),
}));

import { GET as getItemRedirect } from "@/app/api/item/[key]/redirects/route";
import { GET as getNoteRedirect } from "@/app/api/redirects/[...path]/route";
import robots from "@/app/robots";
import sitemap, { generateSitemaps } from "@/app/sitemap";
import { GET as getSitemapIndex } from "@/app/sitemap-index.xml/route";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { cloneLibraryConfig } from "../fixtures/library-config";

function config({
	redirects = true,
	sitemap = true,
}: {
	redirects?: boolean;
	sitemap?: boolean;
} = {}) {
	const input = cloneLibraryConfig();
	input.identity.baseUrl =
		"https://runtime-generation.example.org";
	input.generation = { redirects, sitemap };
	return libraryConfigSchema.parse(input);
}

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.NEXT_PHASE;
	mocks.getSitemapPageCount.mockResolvedValue(2);
});

describe("runtime sitemap routes", () => {
	it("publishes the configured runtime sitemap origin", async () => {
		mocks.getLibraryConfig.mockResolvedValue(config());

		const result = await robots();
		const shards = await generateSitemaps();
		const indexResponse = await getSitemapIndex();

		expect(mocks.connection).toHaveBeenCalledTimes(2);
		expect(result.sitemap).toBe(
			"https://runtime-generation.example.org/sitemap.xml",
		);
		expect(shards).toEqual([{ id: 0 }, { id: 1 }]);
		expect(indexResponse.status).toBe(200);
		expect(await indexResponse.text()).toContain(
			"https://runtime-generation.example.org/sitemap/1.xml",
		);
	});

	it("removes every sitemap entry point when sitemap generation is disabled", async () => {
		mocks.getLibraryConfig.mockResolvedValue(
			config({ sitemap: false }),
		);

		await expect(generateSitemaps()).resolves.toEqual([]);
		await expect(
			sitemap({ id: Promise.resolve(0) }),
		).rejects.toThrow("NEXT_NOT_FOUND");

		const robotsResult = await robots();
		const indexResponse = await getSitemapIndex();

		expect(robotsResult).not.toHaveProperty("sitemap");
		expect(indexResponse.status).toBe(404);
		expect(mocks.getSitemapPageCount).not.toHaveBeenCalled();
		expect(mocks.getMeilisearchForConfig).not.toHaveBeenCalled();
	});
});

describe("runtime redirect routes", () => {
	it("uses configured redirect storage when redirects are enabled", async () => {
		const limit = vi.fn().mockResolvedValue([
			{ note: "legacy = /lib/NEWKEY01" },
		]);
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit })),
			})),
		}));
		const getDocument = vi.fn().mockResolvedValue({
			value: "NEWKEY01",
		});
		mocks.getLibraryConfig.mockResolvedValue(config());
		mocks.getDatabaseForConfig.mockResolvedValue({ select });
		mocks.getMeilisearchForConfig.mockResolvedValue({
			redirectsIndex: { getDocument },
		});

		const noteResponse = await getNoteRedirect(
			new Request(
				"https://library.example.org/api/redirects/legacy",
			) as never,
			{ params: Promise.resolve({ path: ["legacy"] }) },
		);
		const itemResponse = await getItemRedirect(
			new Request(
				"https://library.example.org/api/item/OLDKEY01/redirects",
			) as never,
			{ params: Promise.resolve({ key: "OLDKEY01" }) },
		);

		expect(await noteResponse.json()).toEqual({
			destination: "/lib/NEWKEY01",
		});
		expect(await itemResponse.json()).toEqual({
			value: "NEWKEY01",
		});
		expect(select).toHaveBeenCalledTimes(2);
		expect(limit).toHaveBeenCalledWith(1);
		expect(getDocument).toHaveBeenCalledOnce();
	});

	it("does not query redirect storage when redirects are disabled", async () => {
		mocks.getLibraryConfig.mockResolvedValue(
			config({ redirects: false }),
		);

		const noteResponse = await getNoteRedirect(
			new Request(
				"https://library.example.org/api/redirects/legacy",
			) as never,
			{ params: Promise.resolve({ path: ["legacy"] }) },
		);
		const itemResponse = await getItemRedirect(
			new Request(
				"https://library.example.org/api/item/OLDKEY01/redirects",
			) as never,
			{ params: Promise.resolve({ key: "OLDKEY01" }) },
		);

		expect(await noteResponse.json()).toEqual({
			destination: null,
		});
		expect(noteResponse.headers.get("cache-control")).toContain(
			"no-store",
		);
		expect(await itemResponse.json()).toEqual({
			value: "OLDKEY01",
		});
		expect(itemResponse.headers.get("cache-control")).toContain(
			"no-store",
		);
		expect(mocks.getDatabaseForConfig).not.toHaveBeenCalled();
		expect(mocks.getMeilisearchForConfig).not.toHaveBeenCalled();
	});
});
