import { NextRequest, NextResponse } from "next/server";
import { Item } from "@/app/api/item/types";
import { getDatabaseForConfig } from "@/db";
import { getPublicItemLinks } from "@/lib/links/item-links";
import {
	getSourceCitationMetrics,
	type SourceCitationMetric,
} from "@/lib/links/citation-metrics";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { isIndexOnly } from "@/lib/search-index/index-only";
import { hasAnyTag, publicTagRules } from "@/lib/tags";
import { publicFields, readSearchDocument, searchKeys } from "@/lib/search";

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
		const result = await readSearchDocument(libraryConfig, key);
		const { tags } = libraryConfig.content;

		if (!result || result.deleted || hasAnyTag(result.tags, tags.hidden)) {
			return null;
		}

		return { ...result, attachmentsData: filterPublicAttachments(result, publicTagRules(libraryConfig)) } as Item;
	} catch (error: any) {
		console.warn("Error fetching source item from search:", error);
		return null;
	}
}

/** An index-only library keeps a record's links and source totals on the record, and its database holds neither. */
async function readCitationLinks(item: Item, libraryConfig: LibraryServerConfig, hiddenTags: readonly string[]) {
	if (isIndexOnly(libraryConfig)) {
		return { citedByKeys: item.links?.citedBy ?? [], sourceCitationMetrics: item.citationMetrics ?? [] };
	}
	const database = await getDatabaseForConfig(libraryConfig);
	const [{ citedBy: citedByKeys }, sourceCitationMetrics] = await Promise.all([
		getPublicItemLinks(database, item.key, { hiddenTags }),
		getSourceCitationMetrics(database, item.key),
	]);
	return { citedByKeys, sourceCitationMetrics };
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
		const result = await searchKeys(libraryConfig, keys, { number: page, size: perPage }, {
			returned: publicFields(libraryConfig),
			facets: ["country", "year"],
		});
		const counts = result.facets;

		const { tags } = libraryConfig.content;
		const filteredItems = (result.hits as unknown as Item[])
			.filter((item) => !item.deleted && !hasAnyTag(item.tags, tags.hidden))
			.map((item) => ({ ...item, attachmentsData: filterPublicAttachments(item, publicTagRules(libraryConfig)) }));

		return {
			items: filteredItems,
			countryDistribution: counts.country ?? {},
			yearDistribution: counts.year ?? {},
			totalHits: result.total,
		};
	} catch (error: any) {
		console.warn("Error fetching citing items from search:", error);
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
	const { citedByKeys, sourceCitationMetrics } = await readCitationLinks(sourceItem, libraryConfig, hiddenTags);

	// Fetch citing items with pagination and facets
	const {
		items: paginatedItems,
		countryDistribution: rawCountryDistribution,
		yearDistribution: rawYearDistribution,
		totalHits,
	} = await getCitingItems(
		citedByKeys,
			page,
			perPage,
			libraryConfig,
		);
	// An index-only record lists every citer, hidden ones and ones a load refused too; the database leaves those out.
	const libraryCitationCount = isIndexOnly(libraryConfig) ? totalHits : citedByKeys.length;

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
