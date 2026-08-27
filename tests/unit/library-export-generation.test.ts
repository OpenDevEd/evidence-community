import { beforeEach, describe, expect, it, vi } from "vitest";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { LIBRARY_EXPORT_RECORD_CAP } from "@/config/library-config/exports";
import { cloneLibraryConfig } from "../fixtures/library-config";

const mocks = vi.hoisted(() => ({
	convertItem: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
	convertItem: mocks.convertItem,
}));

vi.mock("@/lib/library-export-records", () => ({
	readCitationRecordsPage: vi.fn(),
	readNewestRecords: vi.fn(),
}));

import {
	buildAtomFeed,
	buildLibraryExportFilename,
	convertRecordsToCitations,
	LIBRARY_EXPORT_PAGE_SIZE,
	streamCitationRecords,
	type CitationRecordReader,
} from "@/lib/library-exports";

function config() {
	return libraryConfigSchema.parse(cloneLibraryConfig());
}

async function readAll(stream: ReadableStream<Uint8Array>) {
	return new Response(stream).text();
}

function keysIn(body: string) {
	return [...body.matchAll(/entry-([A-Za-z0-9]+)/gu)].map(
		(match) => match[1],
	);
}

/**
 * A fake library whose records can change between reads, exactly as a real
 * library can while a large file is being written.
 */
function fakeLibrary(keys: string[]) {
	const store = [...keys].sort();
	const reader: CitationRecordReader = async (afterKey, limit) => {
		const page = store
			.filter((key) => (afterKey === null ? true : key > afterKey))
			.slice(0, limit);
		return page.map((key) => ({ key }) as never);
	};

	return {
		reader,
		add(key: string) {
			store.push(key);
			store.sort();
		},
		remove(key: string) {
			const index = store.indexOf(key);
			if (index >= 0) store.splice(index, 1);
		},
	};
}

beforeEach(() => {
	mocks.convertItem.mockReset();
	mocks.convertItem.mockImplementation(
		async (item: { key: string }) => `entry-${item.key}`,
	);
});

describe("whole-library citation stream", () => {
	it("stops at the documented record cap", async () => {
		let issued = 0;
		const readPage: CitationRecordReader = async (_afterKey, limit) =>
			Array.from(
				{ length: limit },
				() => ({ key: `K${String(issued++).padStart(6, "0")}` }) as never,
			);

		const body = await readAll(streamCitationRecords(readPage, "ris"));

		expect(issued).toBe(LIBRARY_EXPORT_RECORD_CAP);
		expect(keysIn(body)).toHaveLength(LIBRARY_EXPORT_RECORD_CAP);
		expect(body).toContain("entry-K000000");
	});

	it("reads the library in whole pages", async () => {
		const readPage = vi.fn<CitationRecordReader>(async () => []);

		await readAll(streamCitationRecords(readPage, "ris"));

		expect(readPage).toHaveBeenCalledWith(null, LIBRARY_EXPORT_PAGE_SIZE);
	});

	it("asks for records after the last key it wrote", async () => {
		const library = fakeLibrary(["AAAA1111", "BBBB2222", "CCCC3333"]);
		const readPage = vi.fn(library.reader);

		await readAll(streamCitationRecords(readPage, "ris"));

		expect(readPage.mock.calls.map((call) => call[0])).toEqual([
			null,
			"CCCC3333",
		]);
	});

	it("writes no record twice and skips none when the library changes mid-write", async () => {
		const library = fakeLibrary(
			Array.from({ length: 900 }, (_, index) =>
				`R${String(index * 2).padStart(7, "0")}`,
			),
		);
		let reads = 0;
		const readPage: CitationRecordReader = async (afterKey, limit) => {
			reads += 1;
			// A new record lands before the point already written, and an
			// unwritten record disappears, between the first and second page.
			if (reads === 1) {
				library.add("R0000001");
				library.remove("R0001798");
			}
			return library.reader(afterKey, limit);
		};

		const written = keysIn(await readAll(streamCitationRecords(readPage, "ris")));

		expect(new Set(written).size).toBe(written.length);
		expect([...written].sort()).toEqual(written);
		expect(written).not.toContain("R0001798");
		expect(written).toContain("R0000000");
		expect(written).toContain("R0001796");
	});

	it("skips records the converter cannot read", async () => {
		mocks.convertItem.mockImplementation(async (item: { key: string }) =>
			item.key === "BAD" ? "" : `entry-${item.key}`,
		);

		const entries = await convertRecordsToCitations(
			[{ key: "GOOD" }, { key: "BAD" }] as never,
			"bibtex",
		);

		expect(entries).toEqual(["entry-GOOD"]);
	});
});

describe("Atom feed content", () => {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@",
	});

	it("produces a feed an independent parser accepts as Atom 1.0", () => {
		const xml = buildAtomFeed(
			config(),
			[
				{
					key: "ABCD1234",
					title: "First & best record",
					abstractNote: "  A short   summary. ",
					updatedAt: "2026-02-01T10:00:00.000Z",
				},
				{
					key: "EFGH5678",
					title: "Second record",
					updatedAt: "2026-01-05T09:00:00.000Z",
				},
			] as never,
			new Date("2026-03-04T05:06:07.000Z"),
		);

		expect(XMLValidator.validate(xml)).toBe(true);

		const { feed } = parser.parse(xml);
		expect(feed["@xmlns"]).toBe("http://www.w3.org/2005/Atom");
		expect(feed.id).toBe("https://maximal.example.org/lib");
		expect(feed.title).toBe("Maximal Evidence Library");
		expect(feed.updated).toBe("2026-02-01T10:00:00.000Z");
		expect(feed.author.name).toBe("Maximal Evidence Library");
		expect(feed.link.map((link: any) => link["@rel"])).toEqual([
			"self",
			"alternate",
		]);
		expect(feed.link[0]["@href"]).toBe(
			"https://maximal.example.org/lib/atom.xml",
		);

		expect(feed.entry).toHaveLength(2);
		expect(feed.entry[0].id).toBe(
			"https://maximal.example.org/lib/ABCD1234",
		);
		expect(feed.entry[0].title).toBe("First & best record");
		expect(feed.entry[0].link["@href"]).toBe(
			"https://maximal.example.org/lib/ABCD1234",
		);
		expect(feed.entry[0].updated).toBe("2026-02-01T10:00:00.000Z");
		expect(feed.entry[0].summary["#text"]).toBe("A short summary.");
		expect(feed.entry[1].summary).toBeUndefined();
	});

	it("falls back to the record key and the current time", () => {
		const xml = buildAtomFeed(
			config(),
			[{ key: "ABCD1234", title: null }] as never,
			new Date("2026-03-04T05:06:07.000Z"),
		);

		const { feed } = parser.parse(xml);
		expect(feed.entry.title).toBe("ABCD1234");
		expect(feed.entry.updated).toBe("2026-03-04T05:06:07.000Z");
	});

	it("stays valid with no records at all", () => {
		const xml = buildAtomFeed(config(), [], new Date("2026-03-04T00:00:00.000Z"));

		expect(XMLValidator.validate(xml)).toBe(true);
		const { feed } = parser.parse(xml);
		expect(feed.entry).toBeUndefined();
		expect(feed.updated).toBe("2026-03-04T00:00:00.000Z");
	});
});

describe("export file names", () => {
	it.each([
		["Maximal Library", "ris", "maximal-library.ris"],
		["Évidence Café", "bib", "evidence-cafe.bib"],
		["!!!", "ris", "evidence-library.ris"],
	])("turns %s into a safe file name", (shortName, extension, expected) => {
		expect(buildLibraryExportFilename(shortName, extension)).toBe(expected);
	});
});
