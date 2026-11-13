import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	connection: vi.fn(),
	getDatabaseForConfig: vi.fn(),
	getLibraryConfig: vi.fn(),
	getSearchForConfig: vi.fn(),
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
vi.mock("@/lib/elasticsearch", () => ({
	getSearchForConfig: mocks.getSearchForConfig,
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

import { drizzle } from "drizzle-orm/node-postgres";

import { GET as getItemRedirect } from "@/app/api/item/[key]/redirects/route";
import {
	buildRedirectsNoteQuery,
	GET as getNoteRedirect,
} from "@/app/api/redirects/[...path]/route";
import { schema } from "@/db/database-schema";
import robots from "@/app/robots";
import { GET as getIndexNowKey } from "@/app/indexnow-key.txt/route";
import { indexNowKey } from "@/lib/indexnow";
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

/** Whether robots.txt lets a crawler read an address, as Google reads it: the longest matching rule wins, and allow wins a tie. */
function mayRead(rule: { allow?: string | string[]; disallow?: string | string[] }, address: string) {
	const longest = (patterns: string | string[] | undefined) =>
		Math.max(-1, ...[patterns ?? []].flat()
			.filter((pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`).test(address))
			.map((pattern) => pattern.length));
	return longest(rule.allow) >= longest(rule.disallow);
}

describe("robots.txt", () => {
	it("opens what a search engine needs to draw and list a page, and closes addresses that repeat one", async () => {
		mocks.getLibraryConfig.mockResolvedValue(config());
		const rules = [(await robots()).rules].flat();
		const everyone = rules.find((rule) => rule.userAgent === "*")!;

		for (const open of [
			"/",
			"/lib/ABCD2345",
			"/de/lib/ABCD2345",
			"/lib/ABCD2345/download/EFGH2345",
			"/digests/2d8a5c1e-7b1f-4c55-9d0e-3f6a8b9c0d1e",
			"/_next/static/chunks/0abc.js",
			"/_next/static/chunks/0abc.css",
			"/_next/image?url=%2Fcovers%2Fa.jpg&w=256&q=75",
		]) expect(mayRead(everyone, open), open).toBe(true);
		for (const closed of [
			"/api/items",
			"/api/items?page=2",
			"/privacy?page=2",
			"/lib?page=2",
			"/lib?page=2&author=Jane%20Doe",
			"/lib?author=Jane%20Doe",
			"/de/lib?author=Jane%20Doe",
			"/map?scope=title&author=Jane%20Doe",
			"/evidence?paper=ABCD2345",
			"/lib/ABCD2345?referrer=%2Fbrowse%2F1988",
			"/citation/ABCD2345",
			"/de/citation/ABCD2345",
			"/lib/ABCD2345/export/bibtex",
		]) expect(mayRead(everyone, closed), closed).toBe(false);
		// The shield refuses training crawlers, so robots.txt tells them not to ask.
		expect(rules.find((rule) => [rule.userAgent].flat().includes("GoogleOther"))?.disallow).toBe("/");
	});
});

describe("the IndexNow key file", () => {
	it("is the community's key while IndexNow is on, and not found while it is off", async () => {
		const on = config();
		on.generation.indexNow = true;
		mocks.getLibraryConfig.mockResolvedValue(on);
		const served = await getIndexNowKey();
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toContain("text/plain");
		expect(await served.text()).toBe(indexNowKey(on));

		// Off is the default: a test community must not answer for a key.
		mocks.getLibraryConfig.mockResolvedValue(config());
		expect((await getIndexNowKey()).status).toBe(404);
	});
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
		expect(mocks.getSearchForConfig).not.toHaveBeenCalled();
	});
});

describe("runtime redirect routes", () => {
	it("uses configured redirect storage when redirects are enabled", async () => {
		// A stub PostgreSQL client so the real queries run through Drizzle: the note's redirect list, then the item's redirect.
		const query = vi
			.fn()
			.mockResolvedValueOnce({ rows: [["legacy = /lib/NEWKEY01"]] })
			.mockResolvedValueOnce({ rows: [["NEWKEY01"]] });
		mocks.getLibraryConfig.mockResolvedValue(config());
		mocks.getDatabaseForConfig.mockResolvedValue(
			drizzle({ query } as never, { schema }),
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
			destination: "/lib/NEWKEY01",
		});
		expect(await itemResponse.json()).toEqual({
			value: "NEWKEY01",
		});
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[1]?.[1]).toEqual(["OLDKEY01", 1]);
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
	});
});

describe("redirect note lookup query", () => {
	// Drizzle only touches the client when a query runs, so an empty client is
	// enough to compile a query to real SQL.
	const compiled = buildRedirectsNoteQuery(
		drizzle({} as never, { schema }) as never,
		["redirect-record"],
	).toSQL();

	it("matches the tag rows on their own record key", () => {
		expect(compiled.sql).toContain(`"itemToTag"."itemKey" = "item"."key"`);
		expect(compiled.sql).toContain(`"itemToTag"."tagName"`);
		expect(compiled.sql).not.toContain(`"item"."itemKey"`);
		expect(compiled.sql).not.toContain(`"item"."tagName"`);
	});

	it("reads one live note carrying a redirect tag", () => {
		expect(compiled.sql).toContain(`select "note" from "item"`);
		expect(compiled.params).toContain("redirect-record");
		expect(compiled.params).toContain("Note");
		expect(compiled.params).toContain(0);
		expect(compiled.params).toContain(1);
	});
});
