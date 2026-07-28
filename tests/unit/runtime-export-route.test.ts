import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(),
}));

import { GET } from "@/app/api/exports/[format]/route";
import { getLibraryConfig } from "@/config/library-config/server";

const mockedGetLibraryConfig = vi.mocked(getLibraryConfig);

beforeEach(() => {
	mockedGetLibraryConfig.mockResolvedValue(
		libraryConfigSchema.parse(
			cloneLibraryConfig(maximalLibraryConfig),
		),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("runtime export route", () => {
	it("streams an approved configured export through the same origin", async () => {
		const fetchExport = vi
			.fn()
			.mockResolvedValue(
				new Response("TY  - JOUR", {
					headers: {
						"Content-Length": "10",
						"Content-Type":
							"application/x-research-info-systems",
					},
				}),
			);
		vi.stubGlobal("fetch", fetchExport);

		const response = await GET(
			new Request("https://library.example.org/api/exports/ris"),
			{ params: Promise.resolve({ format: "ris" }) },
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("TY  - JOUR");
		expect(response.headers.get("content-type")).toBe(
			"application/x-research-info-systems",
		);
		expect(response.headers.get("content-disposition")).toContain(
			'filename="maximal-library.ris"',
		);
		expect(response.headers.has("content-length")).toBe(false);
		expect(fetchExport).toHaveBeenCalledWith(
			"https://exports.example.org/library.ris",
			expect.objectContaining({
				cache: "no-store",
				redirect: "follow",
			}),
		);
	});

	it("returns 404 without contacting an absent or disabled endpoint", async () => {
		const config = libraryConfigSchema.parse(
			cloneLibraryConfig(maximalLibraryConfig),
		);
		delete config.exports.bibtex;
		config.features.downloads = false;
		mockedGetLibraryConfig.mockResolvedValue(config);
		const fetchExport = vi.fn();
		vi.stubGlobal("fetch", fetchExport);

		const response = await GET(
			new Request("https://library.example.org/api/exports/bibtex"),
			{ params: Promise.resolve({ format: "bibtex" }) },
		);

		expect(response.status).toBe(404);
		expect(fetchExport).not.toHaveBeenCalled();
	});

	it("rejects an upstream response with the wrong content type", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("<html>wrong</html>", {
					headers: { "Content-Type": "text/html" },
				}),
			),
		);

		const response = await GET(
			new Request("https://library.example.org/api/exports/atom"),
			{ params: Promise.resolve({ format: "atom" }) },
		);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: "LIBRARY_EXPORT_SOURCE_CONTENT_TYPE_INVALID",
		});
	});
});
