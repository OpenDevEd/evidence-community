import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("undici", () => ({ Agent: class {}, fetch: fetchMock }));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: async () => ({
		revision: "r5",
		identity: { assets: { logoLight: "https://assets.example.org/brand/logo.png", logoDark: "https://assets.example.org/brand/logo-dark.svg" } },
		services: { storage: { url: "https://store.example.org", publicBucket: "library-public" } },
	}),
}));

import { GET as getLogo } from "@/app/brand/[revision]/[logo]/route";
import { GET as getCover } from "@/app/covers/[...path]/route";

const image = (type: string) => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type } });
const logo = (revision: string, file: string, search = "") => getLogo(new Request(`https://library.example.org/brand/${revision}/${file}${search}`), { params: Promise.resolve({ revision, logo: file }) });
const cover = (...path: string[]) => getCover(new Request(`https://library.example.org/covers/${path.join("/")}`), { params: Promise.resolve({ path }) });

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
	lookup.mockReset();
	lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("logo route", () => {
	it("serves the active revision's raster logo, unsniffable", async () => {
		fetchMock.mockResolvedValue(image("image/png"));
		const response = await logo("r5", "logo-light.png");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("answers nothing with a query string, which would be a new cache entry each time", async () => {
		fetchMock.mockResolvedValue(image("image/png"));
		expect((await logo("r5", "logo-light.png", "?nonce=1")).status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
		const response = await getCover(new Request("https://library.example.org/covers/store.example.org/library-public/cover.png?nonce=1"), { params: Promise.resolve({ path: ["store.example.org", "library-public", "cover.png"] }) });
		expect(response.status).toBe(404);
	});

	it("answers nothing for another revision, another extension, or an SVG", async () => {
		fetchMock.mockResolvedValue(image("image/png"));
		expect((await logo("r6", "logo-light.png")).status).toBe(404);
		expect((await logo("r5", "logo-light.webp")).status).toBe(404);
		fetchMock.mockResolvedValue(image("image/svg+xml"));
		expect((await logo("r5", "logo-dark.svg")).status).toBe(404);
		expect((await logo("r5", "logo-light.png")).status).toBe(404);
	});

	it("never follows a redirect into a private network", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://internal.example/secret.png" } }));
		// A redirect to a literal private address is refused too.
		lookup.mockImplementation(async (host: string) => [{ address: host === "internal.example" ? "10.0.0.5" : "93.184.216.34", family: 4 }]);
		expect((await logo("r5", "logo-light.png")).status).toBe(404);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("cover route", () => {
	it("serves a raster cover from the library's own public bucket", async () => {
		fetchMock.mockResolvedValue(image("image/png"));
		const response = await cover("store.example.org", "library-public", "sources", "ABCD1234", "cover.png");
		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledWith("https://store.example.org/storage/v1/object/public/library-public/sources/ABCD1234/cover.png", expect.anything());
	});

	it("answers nothing for other storage, other buckets, escaping paths or non-raster files", async () => {
		fetchMock.mockResolvedValue(image("image/png"));
		expect((await cover("other.example.org", "library-public", "cover.png")).status).toBe(404);
		expect((await cover("store.example.org", "library-private", "cover.png")).status).toBe(404);
		expect((await cover("store.example.org", "library-public", "..", "library-private", "cover.png")).status).toBe(404);
		fetchMock.mockResolvedValue(image("image/svg+xml"));
		expect((await cover("store.example.org", "library-public", "cover.svg")).status).toBe(404);
	});
});
