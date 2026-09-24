import { NextRequest, NextResponse } from "next/server";
import { Item } from "@/app/api/item/types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { getDatabaseForConfig } from "@/db";
import { getPublicItemLinks } from "@/lib/links/item-links";
import {
	getSourceCitationMetrics,
	type SourceCitationMetric,
} from "@/lib/links/citation-metrics";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { filterPublicAttachments, hasAnyTag } from "@/lib/tags";
import { getMainAttributes, LIST_ITEM_FIELDS, toLightweightItem } from "@/lib/search";

export type CitationYearData = {
	year: string;
	count: number;
};

export type CitationsResponse = {
	sourceItem: Item | null;
	citingItems: Item[];
	libraryCitationCount: number;
	sourceCitationMetrics: SourceCitationMetric[];
	yearDistribution: CitationYearData[];
	countryDistribution: { country: string; count: number }[];
	page: number;
	perPage: number;
	totalPages: number;
};

async function getSourceItem(
	key: string,
	libraryConfig: LibraryServerConfig,
): Promise<Item | null> {
	try {
		const { index } = await getMeilisearchForConfig(libraryConfig);
		const result = await index.getDocument(key, {
			fields: await getMainAttributes(libraryConfig),
		});
		const { tags } = libraryConfig.content;

		if (!result || result.deleted || hasAnyTag(result.tags, tags.hidden)) {
			return null;
		}

		return { ...result, attachmentsData: filterPublicAttachments(result.attachmentsData, tags) } as Item;
	} catch (error: any) {
		if (error?.response?.status !== 404) {
			console.warn("Error fetching source item from meilisearch:", error);
		}
		return null;
	}
}

async function getCitingItems(
	keys: string[],
	page: number,
	perPage: number,
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
			attributesToRetrieve: [...LIST_ITEM_FIELDS],
		});

		const { tags } = libraryConfig.content;
		const filteredItems = (result.hits as Item[])
			.filter((item) => !item.deleted && !hasAnyTag(item.tags, tags.hidden))
			.map((item) => toLightweightItem(item, tags) as Item);

		return {
			items: filteredItems,
			countryDistribution: result.facetDistribution?.["country"] || {},
			yearDistribution: result.facetDistribution?.["year"] || {},
			totalHits: result.estimatedTotalHits || result.hits.length,
		};
	} catch (error: any) {
		if (error?.response?.status !== 404) {
			console.warn(
				"Error fetching citing items from meilisearch:",
				error,
			);
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
	props: { params: Promise<{ key: string }> },
) {
	const params = await props.params;
	const { searchParams } = new URL(request.url);
	const { key } = params;

	const page = parseInt(searchParams.get("page") || "1");
	const perPage = parseInt(searchParams.get("perPage") || "20");
	const libraryConfig = await getLibraryConfig();
	const hiddenTags = libraryConfig.content.tags.hidden;

	// Get the source item first
	const sourceItem = await getSourceItem(key, libraryConfig);

	if (!sourceItem) {
		return NextResponse.json<CitationsResponse>({
			sourceItem: null,
			citingItems: [],
			libraryCitationCount: 0,
			sourceCitationMetrics: [],
			yearDistribution: [],
			countryDistribution: [],
			page,
			perPage,
			totalPages: 0,
		});
	}

	// Records listed on this page are library links. Source-reported totals are
	// returned separately because the two sets overlap and cannot be combined.
	const linksDb = await getDatabaseForConfig(libraryConfig);
	const [{ citedBy: citedByKeys }, sourceCitationMetrics] = await Promise.all(
		[
			getPublicItemLinks(linksDb, key, { hiddenTags }),
			getSourceCitationMetrics(linksDb, key),
		],
	);
	const libraryCitationCount = citedByKeys.length;

	// Fetch citing items with pagination and facets
	const {
		items: paginatedItems,
		countryDistribution: rawCountryDistribution,
		yearDistribution: rawYearDistribution,
	} = await getCitingItems(
		citedByKeys,
			page,
			perPage,
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
	const itemsWithCountry = Object.values(rawCountryDistribution).reduce(
		(sum, count) => sum + count,
		0,
	);
	const itemsWithoutCountry = libraryCitationCount - itemsWithCountry;
	if (itemsWithoutCountry > 0) {
		countryDistribution.push({
			country: "UNKNOWN",
			count: itemsWithoutCountry,
		});
	}

	const totalPages = Math.ceil(libraryCitationCount / perPage);

	const response: CitationsResponse = {
		sourceItem,
		citingItems: paginatedItems,
		libraryCitationCount,
		sourceCitationMetrics,
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
