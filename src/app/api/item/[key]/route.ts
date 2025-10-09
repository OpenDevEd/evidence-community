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
import { getCachedCollections } from "../../cache";
import { convertItem, getCitationFromCSL, getCSL } from "@/lib/actions";
import { blockedTags } from "@/constants/misc";
import { transformItem } from "@/lib/utils";

async function getMeilisearchItem(key: string) {
	try {
		const result = await (
			await meilisearchClient.getIndex(process.env.MEILI_INDEX || config.index)
		).getDocument(key);
		return result as Item;
	} catch (error) {
		console.warn("Error fetching item from meilisearch:", error);
		return null;
	}
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
	const [result, collections] = (await Promise.all([
		source === "db" ? getDatabaseItem(key) : getMeilisearchItem(key),
		getCachedCollections(),
	]));

	if (!result || result.deleted || result?.tags?.some((tag) => blockedTags.includes(tag.toLowerCase()))) {
		return {
			item: null,
		};
	}

	if (collections) {
		result.collectionsData = result.collectionsAncestry
			?.map((collection) => {
				const collectionData = collections.find(
					(c: Collection) => c.key === collection
				);
				return collectionData;
			})
			.filter(
				(collectionData) => collectionData !== undefined
			) as Collection[];
	}

	result.attachmentsData = result.attachmentsData?.filter((attachment: any) => attachment.deleted === 0);

	if (result) {
		const csl = await getCSL(transformItem(result) as Item);
		const citation = await getCitationFromCSL(csl);
		result.citation = citation;
		// result.citation = await convertItem(result, "citation");
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
