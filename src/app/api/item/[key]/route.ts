import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Item } from "../types";
import { getCollections } from "../../collections/route";
import meilisearchClient from "@/lib/meilisearch";
import { item } from "@/db/schema/tables/item";
import { eq } from "drizzle-orm";
import { Collection } from "../../collections/types";
import config from "@/constants/config.json"

async function getMeilisearchItem(key: string) {
	const result = await (
		await meilisearchClient.getIndex(process.env.MEILI_INDEX || config.index)
	).getDocument(key);
	return result as Item;
}

async function getDatabaseItem(key: string) {
	const result = await db.query.item.findFirst({
		where: eq(item.key, key),
	});
	return result as Item;
}

export async function getItem(
	key: string,
	source: "db" | "meilisearch" = "meilisearch"
) {
	const [result, collections] = await Promise.all([
		source === "db" ? getDatabaseItem(key) : getMeilisearchItem(key),
		getCollections(),
	]);

	if (collections) {
		result.collectionsData = result.collections
			?.map((collection) => {
				const collectionData = collections.find(
					(c) => c.key === collection
				);
				return collectionData;
			})
			.filter(
				(collectionData) => collectionData !== undefined
			) as Collection[];
	}

	return {
		item: result,
	};
}

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ key: string; source: "db" | "meilisearch" }> }
) {
    const params = await props.params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "meilisearch";
    const { key } = params;

    const result = await getItem(key, source as "db" | "meilisearch");

    return NextResponse.json(result);
}
