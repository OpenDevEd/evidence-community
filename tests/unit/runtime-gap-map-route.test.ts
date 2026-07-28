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

import { GET } from "@/app/api/gapmaps/[slug]/route";
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

describe("runtime gap-map route", () => {
	it("streams configured HTML through the same origin", async () => {
		const fetchGapMap = vi.fn().mockResolvedValue(
			new Response("<html>configured map</html>", {
				headers: {
					"Content-Length": "27",
					"Content-Type": "text/html; charset=utf-8",
				},
			}),
		);
		vi.stubGlobal("fetch", fetchGapMap);

		const response = await GET(
			new Request(
				"https://library.example.org/gapmaps/gap-map-one.html",
			),
			{ params: Promise.resolve({ slug: "gap-map-one" }) },
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(
			"<html>configured map</html>",
		);
		expect(response.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(response.headers.has("content-length")).toBe(false);
		expect(fetchGapMap).toHaveBeenCalledWith(
			"https://assets.example.org/gapmaps/gap-map-one.html",
			expect.objectContaining({
				cache: "no-store",
				redirect: "follow",
			}),
		);
	});

	it.each(["unknown", "disabled-map"])(
		"returns 404 without fetching the %s slug",
		async (slug) => {
			const config = cloneLibraryConfig(maximalLibraryConfig);
			config.gapMaps!.push({
				id: "disabled-map",
				slug: "disabled-map",
				label: "Disabled map",
				sourceUrl:
					"https://assets.example.org/gapmaps/disabled-map.html",
				enabled: false,
			});
			mockedGetLibraryConfig.mockResolvedValue(
				libraryConfigSchema.parse(config),
			);
			const fetchGapMap = vi.fn();
			vi.stubGlobal("fetch", fetchGapMap);

			const response = await GET(
				new Request(
					`https://library.example.org/gapmaps/${slug}.html`,
				),
				{ params: Promise.resolve({ slug }) },
			);

			expect(response.status).toBe(404);
			expect(fetchGapMap).not.toHaveBeenCalled();
		},
	);

	it("rejects a configured source that is not HTML", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("not html", {
					headers: { "Content-Type": "text/plain" },
				}),
			),
		);

		const response = await GET(
			new Request(
				"https://library.example.org/gapmaps/gap-map-one.html",
			),
			{ params: Promise.resolve({ slug: "gap-map-one" }) },
		);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: "GAP_MAP_SOURCE_CONTENT_TYPE_INVALID",
		});
	});
});
