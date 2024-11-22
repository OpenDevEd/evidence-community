import { collection } from "@/db/schema/tables/collection";
import { InferSelectModel } from "drizzle-orm";

export type CollectionWithChildren = InferSelectModel<typeof collection> & {
  level?: number;
  children?: CollectionWithChildren[];
};

export function buildHierarchy(
  collections: CollectionWithChildren[],
  parentKey: string | null = null,
  level: number = 0
): CollectionWithChildren[] {
  return collections
    .filter((collection) => collection.parentCollection === parentKey)
    .map((collection) => ({
      ...collection,
      level,
      children: buildHierarchy(collections, collection.key, level + 1),
    }));
}

export function calculateNumItemsRecursively(
  collection: CollectionWithChildren,
  collections: CollectionWithChildren[]
): number {
  const children = collections.filter(
    (c) => c.parentCollection === collection.key
  );
  return (
    (collection.numItems || 0) +
    children.reduce(
      (acc, child) => acc + calculateNumItemsRecursively(child, collections),
      0
    )
  );
}

export function getDescendantKeys(
  collection: CollectionWithChildren
): string[] {
  const children = collection.children || [];
  console.log("CHILDREN OF", collection.key, children);

  return children.flatMap((child) => [child.key, ...getDescendantKeys(child)]);
}

export function recursiveFind(
  key: string,
  collections: CollectionWithChildren[]
): CollectionWithChildren | undefined {
  for (const collection of collections) {
    if (collection.key === key) {
      return collection;
    }
    const found =
      collection.children && recursiveFind(key, collection.children);
    if (found) {
      return found;
    }
  }
  return undefined;
}
