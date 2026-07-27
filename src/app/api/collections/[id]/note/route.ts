import { and, eq, arrayContains, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";

async function getCachedNote(
	id: string,
	configRevision: string,
	descriptionTags: readonly string[],
) {
	'use cache'
	cacheLife({ revalidate: 300 })
	cacheTag('collection-note-' + id)
	if (!descriptionTags.length) return null;

	return db.query.item.findFirst({
		where: and(
			arrayContains(item.collections, [id]),
			or(
				...descriptionTags.map((tag) =>
					arrayContains(item.tags, [tag]),
				),
			),
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
	);

	return NextResponse.json({ note }, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
