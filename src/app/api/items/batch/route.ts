import { NextRequest, NextResponse } from "next/server";
import { Item } from "@/app/api/item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { blockedTags } from "@/constants/misc";

async function getMeilisearchItems(keys: string[]): Promise<Item[]> {
	if (keys.length === 0) return [];
	
	try {
		const index = await meilisearchClient.getIndex(
			process.env.MEILI_INDEX || config.index
		);
		
		const result = await index.getDocuments({
			filter: `key IN [${keys.map((k) => `"${k}"`).join(", ")}]`,
			limit: keys.length,
		});
		
		return result.results as Item[];
	} catch (error) {
		console.warn("Error fetching items from meilisearch:", error);
		return [];
	}
}

export type ItemsBatchResponse = {
	items: Item[];
};

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const keysParam = searchParams.get("keys");
	
	if (!keysParam) {
		return NextResponse.json<ItemsBatchResponse>({ items: [] });
	}
	
	const keys = keysParam.split(",").filter(Boolean);
	
	if (keys.length === 0) {
		return NextResponse.json<ItemsBatchResponse>({ items: [] });
	}
	
	// Limit to prevent abuse
	const limitedKeys = keys.slice(0, 50);
	
	const items = await getMeilisearchItems(limitedKeys);
	
	// Filter out deleted items and items with blocked tags
	const filteredItems = items.filter(
		(item) =>
			!item.deleted &&
			!item.tags?.some((tag) => blockedTags.includes(tag.toLowerCase()))
	);
	
	return NextResponse.json<ItemsBatchResponse>({ items: filteredItems });
}


