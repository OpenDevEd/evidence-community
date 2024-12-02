import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import toml from "toml";
import fs from "fs";
import {
  buildHierarchy,
  flattenHierarchy,
  recursiveFind,
} from "@/lib/collections";
import { Collection, CollectionsGetResponse } from "./types";
import { revalidateTag, unstable_cache } from "next/cache";
import config from "@/constants/config.json";


export const getCollections = unstable_cache(async () => {
  console.log("• Fetching new collections")

  const configCollections = config.collections;

  const collections = await db.query.collection.findMany();
  
  const hierarchy = buildHierarchy(collections);
  
  fs.writeFileSync("hierarchy.json", JSON.stringify(hierarchy, null, 2));

  const filteredCollections = Object.entries(configCollections)
    .filter(([_, config]) => config.enabled)
    .map(([key, config]) => {
      const collection = recursiveFind(
        key,
        hierarchy
      );
      if (!collection) return undefined;
      return {
        ...collection,
        ...config,
        parentCollection: null,
        ancestry: undefined,
      };
    })
    .filter((c) => c !== undefined);

  fs.writeFileSync(
    "filteredCollections.json",
    JSON.stringify(filteredCollections, null, 2)
  );

  const flattenedCollections = flattenHierarchy(buildHierarchy(flattenHierarchy(filteredCollections)));

  const uniqueCollections = flattenedCollections.filter(
    (c, index, self) =>
      index === self.findIndex((t) => t.key === c.key)
  );

  fs.writeFileSync(
    "facets.json",
    JSON.stringify(uniqueCollections, null, 2)
  );

  return uniqueCollections;
}, ["collections"], {
  tags: ["collections"],
});

export async function GET(request: NextRequest) {
  const uniqueCollections = await getCollections();

  return NextResponse.json<CollectionsGetResponse>({
    collections: uniqueCollections as Collection[],
  });
}
