import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { resolveSearchRequest } from "@/lib/search";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

const config = libraryConfigSchema.parse(
	cloneLibraryConfig(maximalLibraryConfig),
);

describe("item type filter", () => {
	it("keeps results of any chosen type, in the results and in the counts beside them", () => {
		const request = resolveSearchRequest({ type: ["Thesis", "Report"] }, config);
		const filter = 'itemType IN ["Thesis","Report"]';
		expect(request.finalFilters).toContain(filter);
		expect(request.facetFilters).toContain(filter);
	});

	it("filters by no type when none is chosen", () => {
		const request = resolveSearchRequest({}, config);
		expect(request.finalFilters.some((filter) => filter.startsWith("itemType IN"))).toBe(false);
	});
});
