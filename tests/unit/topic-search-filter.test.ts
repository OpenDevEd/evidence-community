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
const nodes = [
	{ id: "domains/3", parent: null },
	{ id: "fields/17", parent: "domains/3" },
	{ id: "subfields/1702", parent: "fields/17" },
	{ id: "T12260", parent: "subfields/1702" },
	{ id: "T13565", parent: "subfields/1702" },
];

describe("topic search filters", () => {
	it("ORs only the most specific selected nodes and omits them from facet counts", () => {
		const request = resolveSearchRequest(
			{
				topics: [
					"domains/3",
					"fields/17",
					"subfields/1702",
					"T12260",
					"T13565",
				],
			},
			{ ...config, topics: { enabled: true } },
			nodes,
		);

		expect(request.finalFilters).toContainEqual({ field: "topicAncestors", in: ["T12260", "T13565"] });
		expect(request.facetFilters).not.toContainEqual({ field: "topicAncestors", in: ["T12260", "T13565"] });
	});

	it("matches nothing for a topic the library does not have, where no filter would match everything", () => {
		const request = resolveSearchRequest(
			{ topics: ["T999"] },
			{ ...config, topics: { enabled: true } },
			nodes,
		);

		expect(request.finalFilters).toContainEqual({ field: "topicAncestors", in: ["T999"] });
	});

	it("ignores topic URL state when the feature is disabled", () => {
		const request = resolveSearchRequest(
			{ topics: ["T12260"] },
			{ ...config, topics: { enabled: false } },
			nodes,
		);

		expect(request.finalFilters).not.toContainEqual(
			expect.objectContaining({ field: "topicAncestors" }),
		);
	});
});
