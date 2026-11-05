import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ config: vi.fn(), facets: vi.fn(), authors: vi.fn(), places: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: mocks.config }));
vi.mock("@/lib/search", () => ({ getPublicFacets: mocks.facets }));
vi.mock("@/db", () => ({
	getDatabase: async () => ({
		selectDistinct: () => ({ from: () => ({ where: mocks.authors }) }),
		select: () => ({ from: () => ({ where: mocks.places }) }),
	}),
}));

import { GET } from "@/app/api/institution-locations/route";

const place = (key: string) => ({ key, longitude: 32.57, latitude: 0.33, city: "Kampala", country: "UG" });
const search = (extra: object) => ({ search: {}, services: { search: { engine: "elasticsearch", ...extra } } });

describe("the map's institution locations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.facets.mockResolvedValue({ facetDistribution: { institutionsWithAuthors: { "Makerere University": 9, "A Publisher": 2 } } });
		mocks.places.mockResolvedValue([place("makerere university")]);
	});

	it("place every institution of an index-only library, which has no records in its database to ask", async () => {
		mocks.config.mockResolvedValue(search({ indexOnly: true }));

		await expect((await GET()).json()).resolves.toEqual({ "makerere university": [32.57, 0.33, "Kampala", "UG"] });

		expect(mocks.authors).not.toHaveBeenCalled();
		expect(mocks.places).toHaveBeenCalledOnce();
	});

	it("leave out an institution no author works at, in any other library", async () => {
		mocks.config.mockResolvedValue(search({}));
		mocks.authors.mockResolvedValue([{ name: "Other University" }]);
		mocks.places.mockResolvedValue([]);

		await expect((await GET()).json()).resolves.toEqual({});

		expect(mocks.places).not.toHaveBeenCalled();
	});
});
