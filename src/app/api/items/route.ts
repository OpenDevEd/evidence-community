import { db } from "@/db";
import { count, InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { NextRequest, NextResponse } from "next/server";

const ITEMS_PER_PAGE = 20;

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

  const [items, [totalCount]] = await db.transaction(async (tx) => {
    return Promise.all([
      tx.query.item.findMany({
        offset: (pageNum - 1) * limitNum,
        limit: limitNum,
      }),
      tx.select({ count: count() }).from(item)
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
