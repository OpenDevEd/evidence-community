import { beforeEach, describe, expect, it, vi } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { cloneLibraryConfig } from "../fixtures/library-config";

const mocks = vi.hoisted(() => ({
	getDocuments: vi.fn(),
	convertItem: vi.fn(),
}));

vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: vi.fn(async () => ({
		index: { getDocuments: mocks.getDocuments },
	})),
}));

vi.mock("@/lib/search", () => ({
	getMainAttributes: vi.fn(async () => ["key", "title"]),
	getPublicRecordFilters: vi.fn(() => []),
}));

vi.mock("@/lib/actions", () => ({
	convertItem: mocks.convertItem,
}));

import {
	buildAtomFeed,
	buildLibraryExportFilename,
	convertRecordsToCitations,
	LIBRARY_EXPORT_PAGE_SIZE,
	LIBRARY_EXPORT_RECORD_CAP,
	streamLibraryCitations,
} from "@/lib/library-exports";

function config() {
	return libraryConfigSchema.parse(cloneLibraryConfig());
}

async function readAll(stream: ReadableStream<Uint8Array>) {
	return new Response(stream).text();
}

beforeEach(() => {
	mocks.convertItem.mockReset();
	mocks.convertItem.mockImplementation(
		async (item: { key: string }) => `entry-${item.key}`,
	);
	mocks.getDocuments.mockReset();
});

describe("whole-library citation stream", () => {
	it("stops at the documented record cap", async () => {
		let issued = 0;
		mocks.getDocuments.mockImplementation(
			async ({ limit }: { limit: number }) => ({
				results: Array.from({ length: limit }, () => ({
					key: `K${issued++}`,
				})),
			}),
		);

		const body = await readAll(
			await streamLibraryCitations(config(), "ris"),
		);

		expect(issued).toBe(LIBRARY_EXPORT_RECORD_CAP);
		expect(mocks.getDocuments).toHaveBeenCalledTimes(
			LIBRARY_EXPORT_RECORD_CAP / LIBRARY_EXPORT_PAGE_SIZE,
		);
		expect(body).toContain("entry-K0");
		expect(body).toContain(`entry-K${LIBRARY_EXPORT_RECORD_CAP - 1}`);
	});

	it("skips records the converter cannot read", async () => {
		mocks.convertItem.mockImplementation(
			async (item: { key: string }) =>
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
	it("falls back to the record key when a record has no title", () => {
		const feed = buildAtomFeed(
			config(),
			[{ key: "ABCD1234", title: null }] as never,
			new Date("2026-03-04T05:06:07.000Z"),
		);

		expect(feed).toContain("<title>ABCD1234</title>");
		expect(feed).toContain("<updated>2026-03-04T05:06:07.000Z</updated>");
		expect(feed).not.toContain("<summary");
	});
});

describe("export file names", () => {
	it.each([
		["Maximal Library", "ris", "maximal-library.ris"],
		["Évidence Café", "bib", "evidence-cafe.bib"],
		["!!!", "ris", "evidence-library.ris"],
	])("turns %s into a safe file name", (shortName, extension, expected) => {
		expect(buildLibraryExportFilename(shortName, extension)).toBe(
			expected,
		);
	});
});
