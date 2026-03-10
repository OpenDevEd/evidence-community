import { and, eq, arrayContains } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { DESCRIPTION_TAG } from "@/constants/items";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

async function getCachedNote(id: string) {
	'use cache'
	cacheLife({ revalidate: 300 })
	cacheTag('collection-note-' + id)
	return db.query.item.findFirst({
		where: and(
			arrayContains(item.collections, [id]),
			arrayContains(item.tags, [DESCRIPTION_TAG]),
			eq(item.itemType, "Note"),
			eq(item.deleted, 0),
		),
	});
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
	const params = await props.params;
	const { id } = params;

	const note = await getCachedNote(id);

	return NextResponse.json({ note }, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}