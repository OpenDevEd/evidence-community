import { describe, expect, it } from "vitest";

import {
	getRuntimeSearchAttributes,
	getRuntimeSearchFacets,
	getRuntimeSearchScopeOptions,
	getRuntimeYears,
	normalizeRuntimeYearRange,
	resolveRuntimeSearchScope,
} from "@/config/library-config/search";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

function getPublicConfig() {
	return projectPublicLibraryConfig(
		libraryConfigSchema.parse(
			cloneLibraryConfig(maximalLibraryConfig),
		),
	);
}

describe("runtime search configuration", () => {
	it("exposes only configured scopes and falls back to the runtime default", () => {
		const { search } = getPublicConfig();

		expect(
			getRuntimeSearchScopeOptions(search).map(
				(option) => option.key,
			),
		).toEqual([
			"title_abstract_author_and_keywords",
			"title",
			"authors",
		]);
		expect(resolveRuntimeSearchScope("invalid", search)).toBe(
			"title_abstract_author_and_keywords",
		);
	});

	it("removes disabled full-text and tag attributes from broad searches", () => {
		const config = getPublicConfig();
		const search = {
			...config.search,
			fullText: false,
			tags: false,
			scopes: ["everywhere" as const, "title" as const],
			defaultScope: "everywhere" as const,
		};

		expect(
			getRuntimeSearchAttributes("everywhere", search),
		).toEqual(["metadataSearch"]);
		expect(
			getRuntimeSearchAttributes("everywhere", {
				...search,
				fullText: true,
				tags: true,
			}),
		).toEqual([
			"metadataSearch",
			"tags",
			"fullTextPDFs.fullTextPDF.text",
		]);
	});

	it("derives facets from enabled runtime filters and capabilities", () => {
		const config = getPublicConfig();

		expect(
			getRuntimeSearchFacets(
				{
					...config.search,
					country: false,
					authorCountry: false,
				},
				{
					...config.filters,
					institution: {
						mode: "hidden",
						label: "Institutions",
					},
				},
			),
		).toEqual(["collectionsAncestry"]);
	});

	it("generates and validates only the configured year range", () => {
		const { filters } = getPublicConfig();

		expect(getRuntimeYears(filters)).toHaveLength(27);
		expect(getRuntimeYears(filters).slice(0, 2)).toEqual([
			"2026",
			"2025",
		]);
		expect(normalizeRuntimeYearRange("2001-2024", filters)).toBe(
			"2001-2024",
		);
		expect(normalizeRuntimeYearRange("1999", filters)).toBe("");
		expect(normalizeRuntimeYearRange("2024-2001", filters)).toBe("");
	});
});
