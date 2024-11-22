import { collection } from "@/db/schema/tables/collection";
import { InferSelectModel } from "drizzle-orm";

export type ColllectionHierarchy = InferSelectModel<typeof collection> & {
  level?: number;
  children?: ColllectionHierarchy[];
  title?: string;
};

export function buildHierarchy(
  collections: ColllectionHierarchy[],
  parentKey: string | null = null,
  level: number = 0
): ColllectionHierarchy[] {
  return collections
    .filter((collection) => collection.parentCollection === parentKey)
    .map((collection) => ({
      ...collection,
      level,
      children: buildHierarchy(collections, collection.key, level + 1),
    }));
}

export function calculateNumItemsRecursively(
  collection: ColllectionHierarchy,
  collections: ColllectionHierarchy[]
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
  collection: ColllectionHierarchy
): string[] {
  const children = collection.children || [];

  return children.flatMap((child) => [child.key, ...getDescendantKeys(child)]);
}

export function recursiveFind(
  key: string,
  collections: ColllectionHierarchy[]
): ColllectionHierarchy | undefined {
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

export function flattenHierarchy(collections: ColllectionHierarchy[]): ColllectionHierarchy[] {
  return collections.flatMap((collection) => [{
      ...collection,
      children: undefined,
      level: undefined,
    },
    ...flattenHierarchy(collection.children || [])
  ]);
}
