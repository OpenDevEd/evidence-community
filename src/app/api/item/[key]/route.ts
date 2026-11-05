import { isIndexOnly } from "@/lib/search-index/index-only";
import { readIndexedItem } from "@/lib/search-index/index-only-read";
import { readPublicItem } from "@/lib/search-index/projection";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { getPublicItemCard } from "@/lib/public-item-card";
import { getDatabaseForConfig } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Collection } from "../../collections/types";
import { getCachedCollections, getCachedItemPage } from "../../cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Item } from "../types";

export async function getItemRaw(key: string, config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	if (isIndexOnly(libraryConfig)) return { item: await readIndexedItem(key, libraryConfig) };
	const database = await getDatabaseForConfig(libraryConfig);
	return { item: await readPublicItem(database, key, libraryConfig) };
}

export async function getItem(key: string) {
	const libraryConfig = await getLibraryConfig();
	const [rawResult, collections] = await Promise.all([
		getItemRaw(key, libraryConfig),
		getCachedCollections(libraryConfig),
	]);

	if (!rawResult.item) {
		return rawResult;
	}

	return {
		item: withCollectionsData(rawResult.item, collections),
	};
}

/** Adds the data of the collections a record sits in, as its page shows them. */
export function withCollectionsData(result: Item, collections: Collection[] | undefined) {
	if (collections) {
		result.collectionsData = result.collectionsAncestry
			?.map((collection) => {
				const collectionData = collections.find(
					(c: Collection) => c.key === collection,
				);
				return collectionData;
			})
			.filter(
				(collectionData) => collectionData !== undefined,
			) as Collection[];
	}
	return result;
}

/** Browsers never show PDF full text, so public reads leave it out. */
export function withoutFullText<T extends { item?: { fullTextPDFs?: unknown } | null }>(result: T): T {
	if (!result.item) return result;
	const { fullTextPDFs: _fullText, ...item } = result.item;
	return { ...result, item };
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> },
) {
	const { key } = await props.params;
	if (!isCanonicalRecordKey(key)) {
		return NextResponse.json({ error: "Invalid item key" }, { status: 400 });
	}
	try {
		const { searchParams } = new URL(request.url);
		let result;
		const view = searchParams.get("view");
		if (view === "page") {
			// What the record's page draws, for a page that has to read its record again.
			result = await getCachedItemPage(key);
		} else if (view === "card") {
			const config = await getLibraryConfig();
			result = isIndexOnly(config)
				? await getItemRaw(key, config)
				: { item: await getPublicItemCard(await getDatabaseForConfig(config), key, config) };
		} else {
			result = withoutFullText(await getItem(key));
		}
		return NextResponse.json(result, {
			status: result.item ? 200 : 404,
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		console.error("Public item read failed", { key, error });
		return NextResponse.json({ error: "Unable to load publication" }, {
			status: 503, headers: { "Cache-Control": "no-store" },
		});
	}
}
