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

// A real, valid library that offers downloads and has no ready-made
// whole-library file addresses at all.
function configWithoutExportFiles() {
	const draft = cloneLibraryConfig(maximalLibraryConfig);
	(draft.features as any).downloads = true;
	(draft.features as any).atomFeed = false;
	(draft as any).exports = {};
	return libraryConfigSchema.parse(draft);
}

function requestFor(key: string, format: "ris" | "bibtex") {
	return GET(
		new NextRequest(
			`https://library.example.org/api/item/${key}/export/${format}`,
		),
		{ params: Promise.resolve({ key, format }) },
	);
}

beforeEach(() => {
	mockedGetLibraryConfig.mockResolvedValue(configWithoutExportFiles());
	mockedGetCachedItemSmall.mockResolvedValue({
		item: { key: "ABCD1234", title: "A record" },
	} as never);
	mockedConvertItem.mockResolvedValue("TY  - JOUR");
});

describe("single-record export route", () => {
	it.each([
		["ris", "application/x-research-info-systems", "ABCD1234.ris"],
		["bibtex", "application/x-bibtex", "ABCD1234.bib"],
	] as const)(
		"builds the %s download without a whole-library file address",
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
		const config = configWithoutExportFiles();
		config.features.downloads = false;
		mockedGetLibraryConfig.mockResolvedValue(config);

		const response = await requestFor("ABCD1234", "ris");

		expect(response.status).toBe(404);
		expect(mockedConvertItem).not.toHaveBeenCalled();
	});
});
