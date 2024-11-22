import { db } from "@/db";
import { count, InferSelectModel, asc, desc, notInArray, inArray, arrayOverlaps, and, or, sql } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { NextRequest, NextResponse } from "next/server";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";

const ITEMS_PER_PAGE = 20;
const EXCLUDED_ITEM_TYPES = ["Note", "Attachment"] as any[];

export type ItemsGetResponse = {
  items: InferSelectModel<typeof item>[] | any[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pageNum = Math.max(1, Number(searchParams.get("page")) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || ITEMS_PER_PAGE));
  const sort = searchParams.get("sort") || "asc";
  const collections = searchParams.get("collections")?.split(",") || [];

  const [items, [totalCount]] = await db.transaction(async (tx) => {
    return Promise.all([
      tx.query.item.findMany({
        where: (item) => and(
          notInArray(item.itemType, EXCLUDED_ITEM_TYPES),
          collections.length > 0 ? arrayOverlaps(item.collections || [], collections) : sql`1 = 1`
        ),
        offset: (pageNum - 1) * limitNum,
        limit: limitNum,
        orderBy:
          sort === "desc"
            ? (item) => [asc(item.dateAdded)]
            : (item) => [desc(item.dateAdded)],
      }),
      tx.select({ count: count() })
        .from(item)
        .where(and(
          notInArray(item.itemType, EXCLUDED_ITEM_TYPES),
          collections.length > 0 ? arrayOverlaps(item.collections || [], collections) : sql`1 = 1`
        )),
    ]);
  });

  return NextResponse.json<ItemsGetResponse>({
    items,
    currentPage: pageNum,
    totalItems: totalCount.count,
    perPage: limitNum,
    totalPages: Math.ceil(totalCount.count / limitNum),
  });
}
