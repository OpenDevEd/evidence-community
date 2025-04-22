import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
	addDescendantsNamesToHierarchy,
	buildHierarchy,
	flattenHierarchy,
	recursiveFind,
} from "@/lib/collections";
import { Collection, CollectionsGetResponse } from "./types";
import { revalidateTag, unstable_cache } from "next/cache";
import config from "@/constants/config.json";
import fs from "fs";
import { getCachedCollections } from "../cache";

import collectionsDataJSON from "@/../public/collections.json";

export async function getCollections() {
	// const configCollections =
	// 	config.collections[
	// 		(process.env.MEILI_INDEX ||
	// 			config.index) as keyof typeof config.collections
	// 	] || {};

	// const collections = await db.query.collection.findMany();

	// const hierarchy = buildHierarchy(collections);

	// const filteredCollections = Object.entries(configCollections)
	// 	.filter(([_, config]) => config.enabled)
	// 	.map(([key, config]) => {
	// 		const collection = recursiveFind(key, hierarchy);
	// 		if (!collection) return undefined;
	// 		return {
	// 			...collection,
	// 			...config,
	// 			parentCollection: null,
	// 			ancestry: undefined,
	// 		};
	// 	})
	// 	.filter((c) => c !== undefined);

	// const flattenedCollections = flattenHierarchy(
	// 	addDescendantsNamesToHierarchy(
	// 		buildHierarchy(flattenHierarchy(filteredCollections))
	// 	)
	// );

	// const uniqueCollections = flattenedCollections.filter(
	// 	(c, index, self) => index === self.findIndex((t) => t.key === c.key)
	// );

	// return uniqueCollections;

	return collectionsDataJSON as unknown as Collection[];
}

export async function GET() {
	const uniqueCollections = await getCachedCollections();

	return NextResponse.json<CollectionsGetResponse>({
		collections: uniqueCollections as Collection[],
	});
}
