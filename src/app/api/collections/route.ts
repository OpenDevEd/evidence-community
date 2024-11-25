import { db } from "@/db";
import { collection } from "@/db/schema/tables/collection";
import { inArray, InferSelectModel } from "drizzle-orm";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import toml from "toml";
import fs from "fs";
import {
  buildHierarchy,
  flattenHierarchy,
  recursiveFind,
} from "@/lib/collections";

let facets: {
  kerko?: {
    facets?: Record<string, any>;
  };
} = {};


export type CollectionsGetResponse = {
  collections: InferSelectModel<typeof collection>[];
};

export async function GET(request: NextRequest) {
  try {
    facets = toml.parse(fs.readFileSync("config.toml", "utf8"));
  } catch (error) {
    console.error(error);
  }
  
  const configCollections = Object.entries(facets?.kerko?.facets || {})
    .filter(([key, facet]) => facet.type === "collection")
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
      };
    })
    .filter((c) => c !== undefined);

  fs.writeFileSync(
    "filteredCollections.json",
    JSON.stringify(filteredCollections, null, 2)
  );

  const flattenedCollections = flattenHierarchy(filteredCollections);

  const uniqueCollections = flattenedCollections.filter(
    (c, index, self) =>
      index === self.findIndex((t) => t.key === c.key)
  );

  fs.writeFileSync(
    "facets.json",
    JSON.stringify(uniqueCollections, null, 2)
  );

  return NextResponse.json<CollectionsGetResponse>({
    collections: uniqueCollections as InferSelectModel<typeof collection>[],
  });
}
