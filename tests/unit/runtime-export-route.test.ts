vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	readPublicLibraryKeys: vi.fn(),
	readCitationRecordsByKeys: vi.fn(),
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
	readPublicLibraryKeys: mocks.readPublicLibraryKeys,
	readCitationRecordsByKeys: mocks.readCitationRecordsByKeys,
	readNewestRecords: mocks.readNewestRecords,
}));

vi.mock("@/lib/actions", () => ({
	convertItem: vi.fn(async (item: { key: string }, format: string) =>
		format === "ris"
			? `TY  - JOUR\nID  - ${item.key}\nER  -`
			: `@article{${item.key},\n\ttitle = {A record}\n}`,
	),
}));

import { GET, POST } from "@/app/api/exports/[format]/route";

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

function requestFor(format: string, query = "") {
	return GET(
		new Request(`https://library.example.org/api/exports/${format}?${query}`),
		{ params: Promise.resolve({ format }) },
	);
}

/** The database boundary returns public keys and their saved metadata. */
function libraryHolding(...keys: string[]) {
	const sorted = [...keys].sort();
	mocks.readPublicLibraryKeys.mockImplementation(async (_config: unknown, limit: number) => sorted.slice(0, limit));
	mocks.readCitationRecordsByKeys.mockImplementation(
		async (
			_config: unknown,
			selected: string[],
		) =>
			sorted
				.filter((key) => selected.includes(key))
				.map((key) => ({ key, itemType: "Report", title: `Record ${key}`, date: "2026", creators: [{ firstName: "Jane", lastName: "Smith", creatorType: "author" }] })),
	);
}

beforeEach(() => {
	mocks.getLibraryConfig.mockResolvedValue(configWith({}));
	libraryHolding("ABCD1234");
	mocks.readNewestRecords.mockResolvedValue([]);
});

describe("whole-library citation files", () => {
	it.each(["ris", "bibtex", "atom"])("accepts a HEAD probe for %s", async format => {
		const response = await GET(new Request(`https://library.example.org/api/exports/${format}`, { method: "HEAD" }), { params: Promise.resolve({ format }) });
		expect(response.status).toBe(200);
		await response.body?.cancel();
	});

	it("refuses a file when the displayed count no longer matches the selected records", async () => {
		const response = await POST(new Request("https://library.example.org/api/exports/ris", { method: "POST", body: JSON.stringify({ scope: "library", expectedCount: 2 }) }), { params: Promise.resolve({ format: "ris" }) });
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: "exportChanged" });
	});
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

	it("reports the complete captured count and scope", async () => {
		libraryHolding("ABCD1234", "EFGH5678");

		const response = await requestFor("ris");
		expect(response.headers.get("X-Export-Count")).toBe("2");
		expect(response.headers.get("X-Export-Scope")).toBe("library");
		expect((await response.text()).match(/ID  - /g)).toHaveLength(2);
	});

	it.each([
		["the format switch is off", { ris: false }],
		["downloads are off", { downloads: false, atomFeed: false }],
	])("returns 404 when %s", async (_name, changes) => {
		mocks.getLibraryConfig.mockResolvedValue(configWith(changes));
		mocks.readPublicLibraryKeys.mockClear();

		const response = await requestFor("ris");

		expect(response.status).toBe(404);
		expect(mocks.readPublicLibraryKeys).not.toHaveBeenCalled();
	});

	it("returns 404 for a format the library does not publish", async () => {
		expect((await requestFor("csv")).status).toBe(404);
	});
});

describe("whole-library Atom feed", () => {
	it("allows feed-reader tracking parameters without treating them as export filters", async () => {
		const response = await requestFor("atom", "utm_source=reader");
		expect(response.status).toBe(200);
		expect(XMLValidator.validate(await response.text())).toBe(true);
	});
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


describe("formatted bibliography downloads", () => {
 it("numbers a POST selection in one Vancouver bibliography after reading its body", async () => {
  libraryHolding("AAAA1111", "BBBB2222");
  const response = await POST(new Request("https://library.example.org/api/exports/citation?style=vancouver&format=txt", { method: "POST", body: JSON.stringify({ scope: "library" }) }), { params: Promise.resolve({ format: "citation" }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toMatch(/^1\. Smith J\. Record AAAA1111[\s\S]*\n\n2\. Smith J\. Record BBBB2222/);
 });
 it("downloads an additional numeric style from its bundled asset", async () => {
  libraryHolding("AAAA1111", "BBBB2222");
  const response = await requestFor("citation", "style=ieee&format=html");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const html = await response.text();
  expect(html).toContain("[1]");
  expect(html).toContain("[2]");
  expect(html).toContain("Record AAAA1111");
  expect(html).toContain("Record BBBB2222");
 });
 it("rejects unknown styles and disabled citation downloads", async () => {
  expect((await requestFor("citation", "style=../../secret&format=html")).status).toBe(404);
  expect((await requestFor("citation", "style=apa&format=pdf")).status).toBe(404);
  const config = configWith({});
  config.citations.enabled = false;
  mocks.getLibraryConfig.mockResolvedValue(config);
  expect((await requestFor("citation", "style=apa&format=txt")).status).toBe(404);
 });
});
