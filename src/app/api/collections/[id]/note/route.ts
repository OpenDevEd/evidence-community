import { and, eq, arrayContains } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { DESCRIPTION_TAG } from "@/constants/items";

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
	const params = await props.params;
	const { id } = params;

    const note = await db.query.item.findFirst({
        where: and(arrayContains(item.collections, [id]), arrayContains(item.tags, [DESCRIPTION_TAG]), eq(item.itemType, "Note"), and(eq(item.deleted, 0))),
    });

	return NextResponse.json({ note });
}