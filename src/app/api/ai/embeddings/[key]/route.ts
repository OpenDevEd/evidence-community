import { getCachedItem, getCachedItemSmall } from "@/app/api/cache";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import { getItem } from "@/app/api/item/[key]/route";
import { Item } from "@/app/api/item/types";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { MeilisearchApiError, type Index } from "meilisearch";
import { NextRequest, NextResponse } from "next/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";

// Meilisearch reports a missing embedder with the first code and a failing
// embedding provider with the second. Both mean "not ready", not a bug.
const EMBEDDER_NOT_READY_CODES = new Set([
	"invalid_search_embedder",
	"vector_embedding_error",
]);

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> },
) {
	const config = await getLibraryConfig();
	if (
		!config.search.embedder ||
		!isLibraryFeatureEnabled(config.features, "relatedResources")
	) {
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

	if (!itemResponse) {
		return NextResponse.json(
			{ error: "Item not found" },
			{
				status: 404,
			},
		);
	}

	const item: any = itemResponse.item;
	const institutionValue = item.institution || "";

	const institution = Array.isArray(institutionValue)
		? institutionValue.join(", ")
		: institutionValue;

	const description = `This ${item.itemType || "document"} ${
		item.title ? `entitled '${item.title}'` : "(Untitled)"
	} ${
		item.fullNames?.length > 0
			? `was authored by ${item.fullNames.join(", ")}`
			: "has unknown authors"
	}${institution?.length > 0 ? ` while at ${institution}` : ""}. ${
		item.date ? `It was published on ${item.date}` : ""
	}${
		item.collections?.length > 0
			? ` and is categorized under ${item.collections.join(", ")}`
			: ""
	}${item.url ? `. The work can be accessed at ${item.url}` : ""}${
		item.abstractNote
			? `. The authors provide the following abstract: '${item.abstractNote}'`
			: ""
	}`;

	const { index } = await getMeilisearchForConfig(config);
	let result;
	try {
		result = await searchSimilar(index, description, key, config);
	} catch (error) {
		if (
			error instanceof MeilisearchApiError &&
			error.cause?.code &&
			EMBEDDER_NOT_READY_CODES.has(error.cause.code)
		) {
			return NextResponse.json(
				{ error: "Similar resources are not ready" },
				{ status: 503 },
			);
		}
		throw error;
	}

	return NextResponse.json(result, {
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
	});
}
