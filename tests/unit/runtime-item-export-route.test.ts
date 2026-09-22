vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(),
}));

vi.mock("@/app/api/cache", () => ({
	getCachedItemSmall: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({
	convertItem: vi.fn(),
}));

import { GET } from "@/app/api/item/[key]/export/[format]/route";
import { getCachedItemSmall } from "@/app/api/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import { convertItem } from "@/lib/actions";

const mockedGetLibraryConfig = vi.mocked(getLibraryConfig);
const mockedGetCachedItemSmall = vi.mocked(getCachedItemSmall);
const mockedConvertItem = vi.mocked(convertItem);

// A real, valid library that offers downloads with both citation switches on.
function configWithBothFormats() {
	const draft = cloneLibraryConfig(maximalLibraryConfig);
	(draft.features as any).downloads = true;
	(draft.features as any).atomFeed = false;
	(draft as any).exports = { ris: true, bibtex: true, atom: false };
	return libraryConfigSchema.parse(draft);
}

function requestFor(key: string, format: string, query = "") {
	return GET(
		new NextRequest(
			`https://library.example.org/api/item/${key}/export/${format}?${query}`,
		),
		{ params: Promise.resolve({ key, format }) },
	);
}

beforeEach(() => {
	mockedGetLibraryConfig.mockResolvedValue(configWithBothFormats());
	mockedGetCachedItemSmall.mockResolvedValue({
		item: { key: "ABCD1234", title: "A record" },
	} as never);
	mockedConvertItem.mockResolvedValue("TY  - JOUR");
});

describe("single-record export route", () => {
	it.each([
		[
			"ris",
			"application/x-research-info-systems; charset=utf-8",
			"ABCD1234.ris",
		],
		["bibtex", "application/x-bibtex; charset=utf-8", "ABCD1234.bib"],
	] as const)(
		"builds the %s download from the record itself",
		async (format, contentType, filename) => {
			const response = await requestFor("ABCD1234", format);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("TY  - JOUR");
			expect(response.headers.get("content-type")).toBe(contentType);
			expect(response.headers.get("content-disposition")).toBe(
				`attachment; filename="${filename}"`,
			);
		},
	);

	it("refuses when downloads are switched off", async () => {
		const config = configWithBothFormats();
		config.features.downloads = false;
		mockedGetLibraryConfig.mockResolvedValue(config);

		const response = await requestFor("ABCD1234", "ris");

		expect(response.status).toBe(404);
		expect(mockedConvertItem).not.toHaveBeenCalled();
	});

	it("refuses a format whose switch is off", async () => {
		const config = configWithBothFormats();
		config.exports.bibtex = false;
		mockedGetLibraryConfig.mockResolvedValue(config);

		const response = await requestFor("ABCD1234", "bibtex");

		expect(response.status).toBe(404);
		expect(mockedConvertItem).not.toHaveBeenCalled();
	});

	it("still serves the format whose switch is on", async () => {
		const config = configWithBothFormats();
		config.exports.bibtex = false;
		mockedGetLibraryConfig.mockResolvedValue(config);

		expect((await requestFor("ABCD1234", "ris")).status).toBe(200);
	});
});


it("downloads a standalone citation without a reference number", async () => {
 mockedGetCachedItemSmall.mockResolvedValue({ item: {
  key: "ABCD1234", itemType: "Report", title: "2026 evidence", date: "2026",
  creators: [{ firstName: "Jane", lastName: "Smith", creatorType: "author" }],
 } } as never);
 const response = await requestFor("ABCD1234", "citation", "style=vancouver&format=txt");
 expect(response.status).toBe(200);
 expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
 expect(await response.text()).toMatch(/^Smith J\. 2026 evidence/);
});
