import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

async function getCachedNote(
	id: string,
	configRevision: string,
	descriptionTags: readonly string[],
	config: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 300 })
	cacheTag('collection-note-' + id)
	if (!descriptionTags.length) return null;
	const db = await getDatabaseForConfig(config);

	return db.query.item.findFirst({
		where: and(
			sql`exists (
				select 1 from ${itemToCollection}
				where ${itemToCollection.itemKey} = ${item.key}
					and ${itemToCollection.collectionKey} = ${id}
			)`,
			sql`exists (
				select 1 from ${itemToTag}
				where ${itemToTag.itemKey} = ${item.key}
					and ${inArray(itemToTag.tagName, [...descriptionTags])}
			)`,
			eq(item.itemType, "Note"),
			eq(item.deleted, 0),
		),
	});
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
	const params = await props.params;
	const { id } = params;
	const config = await getLibraryConfig();

	const note = await getCachedNote(
		id,
		config.revision,
		config.content.tags.description,
		config,
	);

	return NextResponse.json({ note }, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
