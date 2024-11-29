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

let facets: {
  kerko?: {
    facets?: Record<string, any>;
  };
} = {};

try {
  facets = toml.parse(fs.readFileSync("config.toml", "utf8"));
} catch (error) {
  console.error(error);
}

export const getCollections = unstable_cache(async () => {
  console.log("• Fetching new collections")

  const configCollections = Object.entries(facets?.kerko?.facets || {})
    .filter(([_, facet]) => facet.type === "collection")
    .map(([key, facet]: [string, any]) => {
      return {
        key,
        ...facet,
      };
    });


  const collections = await db.query.collection.findMany();
  
  const hierarchy = buildHierarchy(collections);
  
  fs.writeFileSync("hierarchy.json", JSON.stringify(hierarchy, null, 2));

  const filteredCollections = configCollections
    .filter((configCollection) => configCollection.enabled && configCollection.collection_key)
    .map((configCollection) => {
      const collection = recursiveFind(
        configCollection.collection_key,
        hierarchy
      );
      if (!collection) return undefined;
      return {
        title: collection.name,
        ...configCollection,
        ...collection,
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
}, ["collections"]);

export async function GET() {
  const uniqueCollections = await getCollections();
  
  return NextResponse.json<CollectionsGetResponse>({
    collections: uniqueCollections as Collection[],
  });
}
