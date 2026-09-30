import { getCachedItemSmall } from "@/app/api/cache";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import type { Index } from "meilisearch";
import { NextRequest, NextResponse } from "next/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { Item } from "@/app/api/item/types";
import { LIST_ITEM_FIELDS, toLightweightItem } from "@/lib/search";
import { isEmbedderUnavailable } from "@/lib/search-index/embedder-settings";

function canRecommendSimilarResources(config: LibraryServerConfig) {
	return Boolean(
		config.search.embedder &&
		isLibraryFeatureEnabled(config.features, "relatedResources"),
	);
}

function itemTitle(item: Item) {
	return item.title ? `entitled '${item.title}'` : "(Untitled)";
}

function itemAuthors(item: Item) {
	return item.fullNames?.length
		? `was authored by ${item.fullNames.join(", ")}`
		: "has unknown authors";
}

function itemInstitution(item: Item) {
	const institutionValue = item.institution || "";
	const institution = Array.isArray(institutionValue)
		? institutionValue.join(", ")
		: institutionValue;
	return institution?.length ? ` while at ${institution}` : "";
}

function itemDate(item: Item) {
	return item.date ? `It was published on ${item.date}` : "";
}

function itemCollections(item: Item) {
	return item.collections?.length
		? ` and is categorized under ${item.collections.join(", ")}`
		: "";
}

function itemUrl(item: Item) {
	return item.url ? `. The work can be accessed at ${item.url}` : "";
}

function itemAbstract(item: Item) {
	return item.abstractNote
		? `. The authors provide the following abstract: '${item.abstractNote}'`
		: "";
}

function similarResourcesDescription(item: Item) {
	return [
		`This ${item.itemType || "document"} ${itemTitle(item)} ${itemAuthors(item)}`,
		`${itemInstitution(item)}. ${itemDate(item)}`,
		itemCollections(item),
		itemUrl(item),
		itemAbstract(item),
	].join("");
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> },
) {
	const config = await getLibraryConfig();
	if (!canRecommendSimilarResources(config)) {
		return NextResponse.json(
			{ hits: [], totalHits: 0 },
			{
				headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
			},
		);
	}

	const params = await props.params;
	const { key } = params;

	const itemResponse = await getCachedItemSmall(key);

	if (!itemResponse?.item) {
		return NextResponse.json(
			{ error: "Item not found" },
			{
				status: 404,
			},
		);
	}

	const { index } = await getMeilisearchForConfig(config);
	let result;
	try {
		result = await searchSimilar(
			index,
			similarResourcesDescription(itemResponse.item),
			key,
			config,
		);
	} catch (error) {
		if (isEmbedderUnavailable(error)) {
			return NextResponse.json(
				{ error: "Similar resources are not ready" },
				{ status: 503 },
			);
		}
		throw error;
	}

	// Similar records open the item page from this copy, so they carry the same fields as list results.
	const hits = (result.hits as Item[]).map((hit) => toLightweightItem(hit, config.content.tags));
	return NextResponse.json({ ...result, hits }, {
		headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
	});
}

function searchSimilar(
	index: Index,
	description: string,
	key: string,
	config: LibraryServerConfig,
) {
	return index.search("", {
		q: description,
		hybrid: {
			embedder: PLATFORM_SEARCH_EMBEDDER,
			semanticRatio: 0.7,
		},
		filter: [
			`key != ${key}`,
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			"deleted != 1",
			config.content.tags.hidden.length
				? `tags NOT IN ${JSON.stringify(config.content.tags.hidden)}`
				: null,
		].filter(Boolean) as string[],
		limit: 6,
		attributesToRetrieve: [...LIST_ITEM_FIELDS],
	});
}
