import { beforeEach, describe, expect, it, vi } from "vitest";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	readCitationRecordsPage: vi.fn(),
	readNewestRecords: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));

vi.mock("@/lib/library-export-records", () => ({
	readCitationRecordsPage: mocks.readCitationRecordsPage,
	readNewestRecords: mocks.readNewestRecords,
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

/** Serves the given record keys through the keyset reader the route uses. */
function libraryHolding(...keys: string[]) {
	const sorted = [...keys].sort();
	mocks.readCitationRecordsPage.mockImplementation(
		async (
			_config: unknown,
			afterKey: string | null,
			limit: number,
		) =>
			sorted
				.filter((key) => (afterKey === null ? true : key > afterKey))
				.slice(0, limit)
				.map((key) => ({ key, title: `Record ${key}` })),
	);
}

beforeEach(() => {
	mocks.getLibraryConfig.mockResolvedValue(configWith({}));
	libraryHolding("ABCD1234");
	mocks.readNewestRecords.mockResolvedValue([]);
});

describe("whole-library citation files", () => {
	it("builds the RIS file from the library's own records", async () => {
		libraryHolding("ABCD1234", "EFGH5678");

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

	it("walks the record key instead of counting from an offset", async () => {
		libraryHolding("ABCD1234", "EFGH5678");

		await (await requestFor("ris")).text();

		expect(
			mocks.readCitationRecordsPage.mock.calls.map((call) => call[1]),
		).toEqual([null, "EFGH5678"]);
	});

	it.each([
		["the format switch is off", { ris: false }],
		["downloads are off", { downloads: false, atomFeed: false }],
	])("returns 404 when %s", async (_name, changes) => {
		mocks.getLibraryConfig.mockResolvedValue(configWith(changes));
		mocks.readCitationRecordsPage.mockClear();

		const response = await requestFor("ris");

		expect(response.status).toBe(404);
		expect(mocks.readCitationRecordsPage).not.toHaveBeenCalled();
	});

	it("returns 404 for a format the library does not publish", async () => {
		expect((await requestFor("csv")).status).toBe(404);
	});
});

describe("whole-library Atom feed", () => {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@",
	});

	it("serves a valid Atom 1.0 feed of the newest records", async () => {
		mocks.readNewestRecords.mockResolvedValue([
			{
				key: "ABCD1234",
				title: "First record",
				abstractNote: "A short summary.",
				updatedAt: "2026-02-01T10:00:00.000Z",
			},
		]);

		const response = await requestFor("atom");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/atom+xml; charset=utf-8",
		);
		expect(response.headers.has("content-disposition")).toBe(false);

		const xml = await response.text();
		expect(XMLValidator.validate(xml)).toBe(true);

		const { feed } = parser.parse(xml);
		expect(feed["@xmlns"]).toBe("http://www.w3.org/2005/Atom");
		expect(feed.entry.id).toBe("https://maximal.example.org/lib/ABCD1234");
		expect(feed.entry.title).toBe("First record");
		expect(feed.entry.updated).toBe("2026-02-01T10:00:00.000Z");
		expect(feed.entry.summary["#text"]).toBe("A short summary.");
	});

	it("asks for fifty records", async () => {
		await requestFor("atom");

		expect(mocks.readNewestRecords).toHaveBeenCalledWith(
			expect.anything(),
			50,
		);
	});

	it.each([
		["the Atom switch is off", { atom: false, atomFeed: false }],
		["the Atom feed feature is off", { atomFeed: false }],
	])("returns 404 when %s", async (_name, changes) => {
		mocks.getLibraryConfig.mockResolvedValue(configWith(changes));
		mocks.readNewestRecords.mockClear();

		const response = await requestFor("atom");

		expect(response.status).toBe(404);
		expect(mocks.readNewestRecords).not.toHaveBeenCalled();
	});
});
