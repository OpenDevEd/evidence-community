import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { blockedTags } from "@/constants/misc";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import client from "@/lib/meilisearch";
import { getSearchEmbedder } from "@/lib/search-embedder";
import { MeiliSearchApiError } from "meilisearch";
import { NextRequest, NextResponse } from "next/server";

/** The records nearest this one's stored vector: no embedding call. */
export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ key: string }> },
) {
	const { key } = await props.params;
	const indexName = process.env.MEILI_INDEX || "items";

	try {
		const result = await client.index(indexName).searchSimilarDocuments({
			id: key,
			embedder: (await getSearchEmbedder(indexName)).name,
			filter: [
				`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
				"deleted != 1",
				`tags NOT IN ${JSON.stringify(blockedTags)}`,
			],
			limit: 6,
		});
		return NextResponse.json(result, {
			headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
		});
	} catch (error) {
		if (error instanceof MeiliSearchApiError && error.cause?.code === "not_found_similar_id") {
			return NextResponse.json({ error: "Item not found" }, { status: 404 });
		}
		throw error;
	}
}
