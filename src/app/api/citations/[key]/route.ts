import { NextRequest, NextResponse } from "next/server";
import { Item } from "@/app/api/item/types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { RelationsType } from "@/types/item";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { hasAnyTag } from "@/lib/tags";

export type CitationYearData = {
	year: string;
	count: number;
};

export type CitationsResponse = {
	sourceItem: Item | null;
	citingItems: Item[];
	totalCitations: number;
	yearDistribution: CitationYearData[];
	countryDistribution: { country: string; count: number }[];
	page: number;
	perPage: number;
	totalPages: number;
};

async function getSourceItem(
	key: string,
	hiddenTags: readonly string[],
	libraryConfig: LibraryServerConfig,
): Promise<Item | null> {
	try {
		const { index } = await getMeilisearchForConfig(libraryConfig);
		const result = await index.getDocument(key);

		if (
			!result ||
			result.deleted ||
			hasAnyTag(result.tags, hiddenTags)
		) {
			return null;
		}

		return result as Item;
	} catch (error: any) {
		if (error?.response?.status !== 404) {
			console.warn("Error fetching source item from meilisearch:", error);
		}
		return null;
	}
}

function extractCitedByKeys(relations: RelationsType): string[] {
	const obj = relations || {};
	const citedBy = obj["citedBy"] || [];
	return Array.isArray(citedBy) ? citedBy : [];
}

async function getCitingItems(
	keys: string[],
	page: number,
	perPage: number,
	hiddenTags: readonly string[],
	libraryConfig: LibraryServerConfig,
): Promise<{
	items: Item[];
	countryDistribution: Record<string, number>;
	yearDistribution: Record<string, number>;
	totalHits: number;
}> {
	if (keys.length === 0)
		return {
			items: [],
			countryDistribution: {},
			yearDistribution: {},
			totalHits: 0,
		};

	try {
		const { index } = await getMeilisearchForConfig(libraryConfig);

		const offset = (page - 1) * perPage;

		const result = await index.search("", {
			filter: `key IN [${keys.map((k) => `"${k}"`).join(", ")}]`,
			limit: perPage,
			offset: offset,
			facets: ["country", "year"],
		});

		const filteredItems = (result.hits as Item[]).filter(
			(item) =>
				!item.deleted &&
				!hasAnyTag(item.tags, hiddenTags)
		);

		return {
			items: filteredItems,
			countryDistribution: result.facetDistribution?.["country"] || {},
			yearDistribution: result.facetDistribution?.["year"] || {},
			totalHits: result.estimatedTotalHits || result.hits.length,
		};
	} catch (error: any) {
		if (error?.response?.status !== 404) {
			console.warn("Error fetching citing items from meilisearch:", error);
		}
		return {
			items: [],
			countryDistribution: {},
			yearDistribution: {},
			totalHits: 0,
		};
	}
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const { searchParams } = new URL(request.url);
	const { key } = params;

	const page = parseInt(searchParams.get("page") || "1");
	const perPage = parseInt(searchParams.get("perPage") || "20");
	const libraryConfig = await getLibraryConfig();
	const hiddenTags = libraryConfig.content.tags.hidden;

	// Get the source item first
	const sourceItem = await getSourceItem(
		key,
		hiddenTags,
		libraryConfig,
	);

	if (!sourceItem) {
		return NextResponse.json<CitationsResponse>({
			sourceItem: null,
			citingItems: [],
			totalCitations: 0,
			yearDistribution: [],
			countryDistribution: [],
			page,
			perPage,
			totalPages: 0,
		});
	}

	// Extract citedBy keys from the source item's relations
	const relations = sourceItem.relations as RelationsType;
	const citedByKeys = extractCitedByKeys(relations);
	const citedByCount = relations?.cited_by || 0;

	// Total citations = max of citedBy array length and cited_by count
	const totalCitations = Math.max(citedByKeys.length, citedByCount);

	// Fetch citing items with pagination and facets
	const {
		items: paginatedItems,
		countryDistribution: rawCountryDistribution,
		yearDistribution: rawYearDistribution,
	} = await getCitingItems(
		citedByKeys,
			page,
			perPage,
			hiddenTags,
			libraryConfig,
		);

	// Format year distribution
	const yearDistribution = Object.entries(rawYearDistribution)
		.map(([year, count]) => ({ year, count }))
		.sort((a, b) => parseInt(a.year) - parseInt(b.year));

	// Format country distribution
	const countryDistribution = Object.entries(rawCountryDistribution)
		.map(([country, count]) => ({ country, count }))
		.sort((a, b) => b.count - a.count);

	// Calculate items without country focus
	const itemsWithCountry = Object.values(rawCountryDistribution).reduce((sum, count) => sum + count, 0);
	const itemsWithoutCountry = totalCitations - itemsWithCountry;
	if (itemsWithoutCountry > 0) {
		countryDistribution.push({ country: "UNKNOWN", count: itemsWithoutCountry });
	}

	const totalPages = Math.ceil(totalCitations / perPage);

	const response: CitationsResponse = {
		sourceItem,
		citingItems: paginatedItems,
		totalCitations,
		yearDistribution,
		countryDistribution,
		page,
		perPage,
		totalPages,
	};

	return NextResponse.json(response, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
