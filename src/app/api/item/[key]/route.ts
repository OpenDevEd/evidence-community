import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { getPublicItemCard } from "@/lib/public-item-card";
import { getDatabase, getDatabaseForConfig } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Item } from "../types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { item } from "@/db/schema/tables/item";
import { eq } from "drizzle-orm";
import { Collection } from "../../collections/types";
import { getCachedCollections } from "../../cache";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { hasAnyTag } from "@/lib/tags";
import { getPublicItemLinks } from "@/lib/links/item-links";
import { getSourceCitationMetrics } from "@/lib/links/citation-metrics";

async function getMeilisearchItem(
	key: string,
	libraryConfig: LibraryServerConfig,
) {
	try {
		const { index } = await getMeilisearchForConfig(libraryConfig);
		const result = await index.getDocument(key);
		return result as Item;
	} catch (error: any) {
		if (error?.response?.status !== 404) {
			console.warn("Error fetching item from meilisearch:", error);
		}
		return null;
	}
}

async function getDatabaseItem(
	key: string,
	libraryConfig?: LibraryServerConfig,
) {
	const db = libraryConfig
		? await getDatabaseForConfig(libraryConfig)
		: await getDatabase();
	const result = await db.query.item.findFirst({
		where: eq(item.key, key),
	});
	return result as Item;
}

export async function getItemRaw(
	key: string,
	source: "db" | "meilisearch" = "meilisearch",
	config?: LibraryServerConfig,
) {
	const libraryConfig = config ?? (await getLibraryConfig());
	const result =
		source === "db"
			? await getDatabaseItem(key, libraryConfig)
			: await getMeilisearchItem(key, libraryConfig);
	const { content } = libraryConfig;

	if (
		!result ||
		result.deleted ||
		hasAnyTag(result.tags, content.tags.hidden)
	) {
		return {
			item: null,
		};
	}

	result.attachmentsData = result.attachmentsData?.filter(
		(attachment: any) => attachment.deleted === 0,
	);
	const linksDb = await getDatabaseForConfig(libraryConfig);
	[result.links, result.citationMetrics] = await Promise.all([
		getPublicItemLinks(linksDb, key, {
			hiddenTags: content.tags.hidden,
		}),
		getSourceCitationMetrics(linksDb, key),
	]);

	return {
		item: result,
	};
}

export async function getItem(
	key: string,
	source: "db" | "meilisearch" = "meilisearch",
) {
	const libraryConfig = await getLibraryConfig();
	const [rawResult, collections] = await Promise.all([
		getItemRaw(key, source, libraryConfig),
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
	props: { params: Promise<{ key: string; source: "db" | "meilisearch" }> },
) {
	const params = await props.params;
	const { searchParams } = new URL(request.url);
	const source = searchParams.get("source") || "meilisearch";
	const { key } = params;

	if (searchParams.get("view") === "card") {
		if (!isCanonicalRecordKey(key)) {
			return NextResponse.json({ error: "Invalid item key" }, { status: 400 });
		}
		try {
			const config = await getLibraryConfig();
			const database = await getDatabaseForConfig(config);
			const card = await getPublicItemCard(database, key, config.content.tags.hidden);
			return NextResponse.json({ item: card }, {
				status: card ? 200 : 404,
				headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
			});
		} catch (error) {
			console.error("Public item card read failed", { key, error });
			return NextResponse.json({ error: "Unable to load publication" }, {
				status: 503, headers: { "Cache-Control": "no-store" },
			});
		}
	}

	const result = await getItem(key, source as "db" | "meilisearch");

	return NextResponse.json(result, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
