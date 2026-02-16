import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
	buildHierarchy,
	flattenHierarchy,
	recursiveFind,
} from "@/lib/collections";
import { Collection, CollectionsGetResponse } from "./types";
import config from "@/constants/config.json";
import { getCachedCollections } from "../cache";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function getCollections() {
	const configCollections =
		config.collections[
			(process.env.MEILI_INDEX ||
				config.index) as keyof typeof config.collections
		] || {};

	const collections = await db.query.collection.findMany();

	const hierarchy = buildHierarchy(collections);

	const filteredCollections = Object.entries(configCollections)
		.filter(([_, config]) => config.enabled)
		.map(([key, config]) => {
			const collection = recursiveFind(key, hierarchy);
			if (!collection) return undefined;
			return {
				...collection,
				...config,
				parentCollection: null,
				ancestry: undefined,
			};
		})
		.filter((c) => c !== undefined);

	const flattenedCollections = flattenHierarchy(
		buildHierarchy(flattenHierarchy(filteredCollections))
	);

	const uniqueCollections = flattenedCollections.filter(
		(c, index, self) => index === self.findIndex((t) => t.key === c.key)
	);

	return uniqueCollections;
}

export async function GET(request: NextRequest) {
	const uniqueCollections = await getCachedCollections();

	return NextResponse.json<CollectionsGetResponse>(
		{
			collections: uniqueCollections as Collection[],
		},
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
			},
		}
	);
}
