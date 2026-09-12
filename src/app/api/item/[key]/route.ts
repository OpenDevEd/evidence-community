import { readPublicItem } from "@/lib/search-index/projection";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { getPublicItemCard } from "@/lib/public-item-card";
import { getDatabaseForConfig } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Collection } from "../../collections/types";
import { getCachedCollections } from "../../cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export async function getItemRaw(key: string, config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
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

	const result = rawResult.item;

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

	return {
		item: result,
	};
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
		if (searchParams.get("view") === "card") {
			const config = await getLibraryConfig();
			const database = await getDatabaseForConfig(config);
			result = { item: await getPublicItemCard(database, key, config.content.tags.hidden) };
		} else {
			result = await getItem(key);
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
