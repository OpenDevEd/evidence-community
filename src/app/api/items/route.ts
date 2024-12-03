import { NextRequest, NextResponse } from "next/server";
import { EXCLUDED_ITEM_TYPES, ITEMS_PER_PAGE, SCOPE_OPTIONS, SORT_OPTIONS } from "@/constants/items";
import { ItemsGetResponse } from "./types";
import { Item } from "../item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pageNum = Math.max(1, Number(searchParams.get("page")) || 1);
  const limitNum = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit")) || ITEMS_PER_PAGE)
  );
  const sort = searchParams.get("sort") || SORT_OPTIONS[0].key;
  const collections = searchParams.get("collections")?.split(",") || [];
  const search = searchParams.get("search") || "";
  const scope = searchParams.get("scope") || SCOPE_OPTIONS[0].key;
  const searchIndex = meilisearchClient.index(config.index);
  const sortOption = SORT_OPTIONS.find((option) => option.key === sort)?.sort || SORT_OPTIONS[0].sort;

  console.log(sortOption);

  const searchResults = await searchIndex.search(search, {
    offset: (pageNum - 1) * limitNum,
    limit: limitNum,
    attributesToSearchOn: SCOPE_OPTIONS.find((option) => option.key === scope)?.attributesToSearchOn || SCOPE_OPTIONS[0].attributesToSearchOn,
    filter: [
      `itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
      collections.length > 0
        ? `collections IN ${JSON.stringify(collections)}`
        : null,
    ].filter((f): f is string => f !== null),
    sort: [sortOption],
  });

  const items = searchResults.hits;
  const totalCount = searchResults.estimatedTotalHits;

  return NextResponse.json<ItemsGetResponse>({
    items: items as Item[],
    currentPage: pageNum,
    totalItems: totalCount,
    perPage: limitNum,
    totalPages: Math.ceil(totalCount / limitNum),
  });
}
