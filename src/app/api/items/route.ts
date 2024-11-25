import { db } from "@/db";
import {
  count,
  InferSelectModel,
  asc,
  desc,
  notInArray,
  inArray,
  arrayOverlaps,
  and,
  or,
  sql,
} from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { NextRequest, NextResponse } from "next/server";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { MeiliSearch } from "meilisearch";

const ITEMS_PER_PAGE = 20;
const EXCLUDED_ITEM_TYPES = ["Note", "Attachment"] as any[];

const meilisearchClient = new MeiliSearch({
  host: "http://localhost:7700",
  apiKey: process.env.MASTER_KEY,
});

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
  const limitNum = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit")) || ITEMS_PER_PAGE)
  );

  const sort = searchParams.get("sort") || "asc";
  const collections = searchParams.get("collections")?.split(",") || [];
  const search = searchParams.get("search") || "";

  const searchIndex = meilisearchClient.index("items");

  const searchResults = await searchIndex.search(search, {
    offset: (pageNum - 1) * limitNum,
    limit: limitNum,
    sort: [`dateAdded:${sort}`],
    filter: [
      `itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
      collections.length > 0
        ? `collections IN ${JSON.stringify(collections)}`
        : null,
    ].filter((f): f is string => f !== null),
  });

  const items = searchResults.hits;
  const totalCount = searchResults.estimatedTotalHits;

  return NextResponse.json<ItemsGetResponse>({
    items,
    currentPage: pageNum,
    totalItems: totalCount,
    perPage: limitNum,
    totalPages: Math.ceil(totalCount / limitNum),
  });
}
