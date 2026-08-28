import { and, eq, exists, inArray, sql } from "drizzle-orm";
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
	"use cache";
	cacheLife({ revalidate: 300 });
	cacheTag("collection-note-" + id);
	if (!descriptionTags.length) return null;
	const db = await getDatabaseForConfig(config);

	const [note] = await db
		.select()
		.from(item)
		.where(
			and(
				exists(
					db
						.select({ value: sql`1` })
						.from(itemToCollection)
						.where(
							and(
								eq(itemToCollection.itemKey, item.key),
								eq(itemToCollection.collectionKey, id),
							),
						),
				),
				exists(
					db
						.select({ value: sql`1` })
						.from(itemToTag)
						.where(
							and(
								eq(itemToTag.itemKey, item.key),
								inArray(itemToTag.tagName, [
									...descriptionTags,
								]),
							),
						),
				),
				eq(item.itemType, "Note"),
				eq(item.deleted, 0),
			),
		)
		.limit(1);

	return note ?? null;
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ id: string }> },
) {
	const params = await props.params;
	const { id } = params;
	const config = await getLibraryConfig();

	const note = await getCachedNote(
		id,
		config.revision,
		config.content.tags.description,
		config,
	);

	return NextResponse.json(
		{ note },
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
			},
		},
	);
}
