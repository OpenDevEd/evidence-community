import { beforeEach, describe, expect, it, vi } from "vitest";

import { create } from "xmlbuilder2";

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const mocks = vi.hoisted(() => ({
	getDocuments: vi.fn(),
	getLibraryConfig: vi.fn(),
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));

vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: vi.fn(async () => ({
		index: { getDocuments: mocks.getDocuments },
	})),
}));

vi.mock("@/lib/search", () => ({
	getMainAttributes: vi.fn(async () => [
		"key",
		"title",
		"abstractNote",
		"updatedAt",
		"attachmentsData",
		"fullTextPDFs",
	]),
	getPublicRecordFilters: vi.fn(() => ["deleted != 1"]),
}));

vi.mock("@/lib/actions", () => ({
	convertItem: vi.fn(async (item: { key: string }, format: string) =>
		format === "ris"
			? `TY  - JOUR\nID  - ${item.key}\nER  -`
			: `@article{${item.key},\n\ttitle = {A record}\n}`,
	),
}));

import { GET } from "@/app/api/exports/[format]/route";

function configWith(changes: {
	ris?: boolean;
	bibtex?: boolean;
	atom?: boolean;
	downloads?: boolean;
	atomFeed?: boolean;
}) {
	const draft = cloneLibraryConfig(maximalLibraryConfig);
	Object.assign(draft.exports as Record<string, boolean>, {
		ris: changes.ris ?? true,
		bibtex: changes.bibtex ?? true,
		atom: changes.atom ?? true,
	});
	Object.assign(draft.features as Record<string, boolean>, {
		downloads: changes.downloads ?? true,
		atomFeed: changes.atomFeed ?? true,
	});
	return libraryConfigSchema.parse(draft);
}

function requestFor(format: string) {
	return GET(
		new Request(`https://library.example.org/api/exports/${format}`),
		{ params: Promise.resolve({ format }) },
	);
}

function pagesOf(...pages: Array<Array<Record<string, unknown>>>) {
	mocks.getDocuments.mockReset();
	for (const page of pages) {
		mocks.getDocuments.mockResolvedValueOnce({ results: page });
	}
	mocks.getDocuments.mockResolvedValue({ results: [] });
}

beforeEach(() => {
	mocks.getLibraryConfig.mockResolvedValue(configWith({}));
	pagesOf([{ key: "ABCD1234", title: "A record" }]);
});

describe("whole-library citation files", () => {
	it("builds the RIS file from the library's own records", async () => {
		pagesOf(
			[{ key: "ABCD1234", title: "First" }],
			[{ key: "EFGH5678", title: "Second" }],
		);

		const response = await requestFor("ris");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/x-research-info-systems; charset=utf-8",
		);
		expect(response.headers.get("content-disposition")).toContain(
			'filename="maximal-library.ris"',
		);

		const body = await response.text();
		expect(body).toContain("ID  - ABCD1234");
		expect(body).toContain("ID  - EFGH5678");
	});

	it("names the BibTeX file after the library short name", async () => {
		const response = await requestFor("bibtex");

		expect(response.headers.get("content-disposition")).toContain(
			'filename="maximal-library.bib"',
		);
		expect(await response.text()).toContain("@article{ABCD1234,");
	});

	it("never reads stored full text or cover images", async () => {
		await (await requestFor("ris")).text();

		expect(mocks.getDocuments).toHaveBeenCalledWith(
			expect.objectContaining({
				fields: ["key", "title", "abstractNote", "updatedAt"],
				filter: ["deleted != 1"],
			}),
		);
	});

	it.each([
		["the format switch is off", { ris: false }],
		["downloads are off", { downloads: false, atomFeed: false }],
	])("returns 404 when %s", async (_name, changes) => {
		mocks.getLibraryConfig.mockResolvedValue(configWith(changes));
		mocks.getDocuments.mockClear();

		const response = await requestFor("ris");

		expect(response.status).toBe(404);
		expect(mocks.getDocuments).not.toHaveBeenCalled();
	});

	it("returns 404 for a format the library does not publish", async () => {
		expect((await requestFor("csv")).status).toBe(404);
	});
});

describe("whole-library Atom feed", () => {
	it("serves a valid Atom 1.0 feed of the newest records", async () => {
		pagesOf([
			{
				key: "ABCD1234",
				title: "First record",
				abstractNote: "  A short   summary. ",
				updatedAt: "2026-02-01T10:00:00.000Z",
			},
		]);

		const response = await requestFor("atom");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/atom+xml; charset=utf-8",
		);
		expect(response.headers.has("content-disposition")).toBe(false);

		const feed = create(await response.text()).end({ format: "object" }) as {
			feed: Record<string, any>;
		};

		expect(feed.feed["@xmlns"]).toBe("http://www.w3.org/2005/Atom");
		expect(feed.feed.id).toBe("https://maximal.example.org/lib");
		expect(feed.feed.updated).toBe("2026-02-01T10:00:00.000Z");
		expect(feed.feed.entry.id).toBe(
			"https://maximal.example.org/lib/ABCD1234",
		);
		expect(feed.feed.entry.title).toBe("First record");
		expect(feed.feed.entry.updated).toBe("2026-02-01T10:00:00.000Z");
		expect(feed.feed.entry.summary["#"]).toBe("A short summary.");
		expect(feed.feed.entry.link["@href"]).toBe(
			"https://maximal.example.org/lib/ABCD1234",
		);
	});

	it("asks for the newest records first", async () => {
		await requestFor("atom");

		expect(mocks.getDocuments).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 50,
				offset: 0,
				sort: ["dateAdded:desc"],
			}),
		);
	});

	it.each([
		["the Atom switch is off", { atom: false, atomFeed: false }],
		["the Atom feed feature is off", { atomFeed: false }],
	])("returns 404 when %s", async (_name, changes) => {
		mocks.getLibraryConfig.mockResolvedValue(configWith(changes));
		mocks.getDocuments.mockClear();

		const response = await requestFor("atom");

		expect(response.status).toBe(404);
		expect(mocks.getDocuments).not.toHaveBeenCalled();
	});
});
