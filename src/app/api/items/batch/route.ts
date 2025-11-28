import { NextRequest, NextResponse } from "next/server";
import { Item } from "@/app/api/item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { blockedTags } from "@/constants/misc";

async function getPaginatedItems(
	keys: string[],
	page: number,
	perPage: number
): Promise<{ items: Item[]; total: number }> {
	if (keys.length === 0) return { items: [], total: 0 };

	try {
		const index = await meilisearchClient.getIndex(
			process.env.MEILI_INDEX || config.index
		);

		const offset = (page - 1) * perPage;

		const result = await index.search("", {
			filter: `key IN [${keys.map((k) => `"${k}"`).join(", ")}]`,
			limit: perPage,
			offset: offset,
		});

		return {
			items: result.hits as Item[],
			total: result.estimatedTotalHits || result.hits.length,
		};
	} catch (error) {
		console.warn("Error fetching items from meilisearch:", error);
		return { items: [], total: 0 };
	}
}

export type ItemsBatchResponse = {
	items: Item[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
};

export async function POST(request: NextRequest) {
	const body = await request.json();
	const keys = body.keys;
	const page = body.page || 1;
	const perPage = body.perPage || 20;

	if (!keys || !Array.isArray(keys) || keys.length === 0) {
		return NextResponse.json<ItemsBatchResponse>({
			items: [],
			page,
			perPage,
			total: 0,
			totalPages: 0,
		});
	}

	const { items, total } = await getPaginatedItems(keys, page, perPage);

	// Filter out deleted items and items with blocked tags
	const filteredItems = items.filter(
		(item) =>
			!item.deleted &&
			!item.tags?.some((tag) => blockedTags.includes(tag.toLowerCase()))
	);

	const totalPages = Math.ceil(total / perPage);

	return NextResponse.json<ItemsBatchResponse>({
		items: filteredItems,
		page,
		perPage,
		total,
		totalPages,
	});
}
