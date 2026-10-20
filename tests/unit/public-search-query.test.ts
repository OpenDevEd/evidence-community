import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: async () => config,
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { readPublicQuery, readPublicRequest } from "@/lib/public-query";
import { resolveSearchQuery } from "@/lib/search-query";
import { loadSearchParams } from "@/lib/searchParams";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const config = projectPublicLibraryConfig(
	libraryConfigSchema.parse(cloneLibraryConfig(maximalLibraryConfig)),
);
const items = { paged: true, perPage: true, includeHeavyFields: true } as const;
const read = (query: string, options: Parameters<typeof readPublicQuery>[2] = items) =>
	readPublicQuery(new URLSearchParams(query), config, options);
const named = (query: string, options?: Parameters<typeof readPublicQuery>[2]) =>
	read(query, options).issues.map(({ parameter }) => parameter);

describe("a request to a public list endpoint", () => {
	it("takes a search with every option the library offers and the page size asked for", () => {
		const query = read(
			"search=%22tutor+copilot%22&scope=title&range=2024-2026&country=QA&type=JournalArticle,Preprint&sort=mostCited&page=3&perPage=100&includeHeavyFields=false",
		);
		expect(query.issues).toEqual([]);
		expect(query).toMatchObject({
			perPage: 100,
			includeHeavyFields: false,
			params: {
				search: '"tutor copilot"',
				scope: "title",
				range: "2024-2026",
				country: ["QA"],
				type: ["JournalArticle", "Preprint"],
				sort: "mostCited",
				page: 3,
			},
		});
	});

	it("names an option the endpoint does not have", () => {
		expect(named("search=tutoring&paperLikeOnly=true")).toEqual(["paperLikeOnly"]);
		// The facets endpoint has no page, order or page size.
		expect(named("search=tutoring&perPage=50&page=2&sort=bogus", {})).toEqual([
			"perPage",
			"page",
			"sort",
		]);
		// Where a reader came from stays on the page; the API has no use for it.
		expect(named("search=tutoring&referrer=%2Flib&message=hello")).toEqual([
			"referrer",
			"message",
		]);
	});

	it("names a sort or scope the library does not offer, and lists the ones it does", () => {
		const { issues } = read("sort=newest&scope=documents");
		expect(issues.map(({ parameter }) => parameter)).toEqual(["sort", "scope"]);
		expect(issues[0]?.message).toContain("mostCited");
		expect(issues[1]?.message).toContain("title");
	});

	it("names a country it does not know, and takes a code or a region", () => {
		expect(named("country=Qatar")).toEqual(["country"]);
		// Not a place, though every object has one.
		expect(named("country=constructor")).toEqual(["country"]);
		expect(named("country=QA,Asia")).toEqual([]);
	});

	it("names a page or page size that is not a whole number in range", () => {
		expect(named("page=0")).toEqual(["page"]);
		expect(named("page=two")).toEqual(["page"]);
		// Past the last result any library can return.
		expect(named("page=1000000000000000000000")).toEqual(["page"]);
		// The last page depends on how many results a page holds.
		expect(named("page=100000&perPage=100")).toEqual([]);
		expect(named("page=100001&perPage=100")).toEqual(["page"]);
		expect(named("page=100001")).toEqual([]);
		expect(named("perPage=0")).toEqual(["perPage"]);
		expect(named("perPage=101")).toEqual(["perPage"]);
		expect(named("perPage=20.5")).toEqual(["perPage"]);
	});

	it("names a year range it cannot read", () => {
		expect(named("range=2020-2019")).toEqual(["range"]);
		expect(named("range=recent")).toEqual(["range"]);
		expect(named("range=2016")).toEqual([]);
	});

	it("names an option given twice, which would otherwise keep only the first", () => {
		expect(named("type=JournalArticle&type=Preprint")).toEqual(["type"]);
	});

	it("names a filter the library has switched off", () => {
		const off = { ...config, search: { ...config.search, country: false } };
		expect(
			readPublicQuery(new URLSearchParams("country=QA"), off, items).issues.map(
				({ parameter }) => parameter,
			),
		).toEqual(["country"]);
	});
});

describe("the sources filter", () => {
	const server = libraryConfigSchema.parse(cloneLibraryConfig(maximalLibraryConfig));
	const second = { ...server.sources[0]!, key: "zotero-second", groupId: "7743475" };

	it("is not offered by a library with one source, which it would not narrow", () => {
		expect(named("sources=zotero-maximal")).toEqual(["sources"]);
		expect(resolveSearchQuery({ sources: ["zotero-maximal"] }, server).params.sources).toEqual([]);
	});

	it("takes any of a library's sources once it has two", () => {
		const two = { ...server, sources: [...server.sources, second] };
		const resolved = resolveSearchQuery({ sources: ["zotero-maximal", "zotero-second"] }, two);
		expect(resolved.issues).toEqual([]);
		expect(resolved.params.sources).toEqual(["zotero-maximal", "zotero-second"]);
		expect(projectPublicLibraryConfig(two).filters.sources.enabled).toBe(true);
	});
});

describe("the answer to a request an endpoint cannot honour", () => {
	it("is a 400 that lists every problem and is never cached", async () => {
		const answer = await readPublicRequest(
			new Request("https://library.example.org/api/items?sort=newest&paperLikeOnly=true"),
			items,
		);
		if (!(answer instanceof Response)) throw new Error("The request was accepted");
		expect(answer.status).toBe(400);
		expect(answer.headers.get("cache-control")).toBe("no-store");
		const body = await answer.json();
		expect(body.error).toBe("Unknown parameter: paperLikeOnly.");
		expect(body.issues.map((issue: { parameter: string }) => issue.parameter)).toEqual([
			"paperLikeOnly",
			"sort",
		]);
	});

	it("is the search itself when the request is sound", async () => {
		const answer = await readPublicRequest(
			new Request("https://library.example.org/api/items?search=tutoring&perPage=50"),
			items,
		);
		expect(answer).toMatchObject({ perPage: 50, params: { search: "tutoring" } });
	});
});

describe("a page address", () => {
	it("is put right without an error, so an old or mistyped link still opens", () => {
		const { params } = resolveSearchQuery(
			loadSearchParams(
				new URLSearchParams("search=tutoring&sort=newest&scope=documents&country=Qatar,QA&range=recent"),
			),
			config,
		);
		expect(params).toMatchObject({
			search: "tutoring",
			sort: "relevance",
			scope: "title_abstract_author_and_keywords",
			country: ["QA"],
			range: "",
		});
	});

	it("opens on the first page when the page number is beyond any result", () => {
		const page = (query: string, perPage?: number) =>
			resolveSearchQuery(
				loadSearchParams(new URLSearchParams(query)),
				config,
				perPage,
			).params.page;
		expect(page("page=1000000000000000000000")).toBe(1);
		// A listing holds 20 a page, so its last page is 500,000: the same one the API accepts.
		expect(page("page=500000")).toBe(500000);
		expect(page("page=500001")).toBe(1);
		expect(named("page=500001")).toEqual(["page"]);
		// A smaller page reaches further.
		expect(page("page=500001", 1)).toBe(500001);
	});
});
