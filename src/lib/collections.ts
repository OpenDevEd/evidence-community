import { Collection } from "@/app/api/collections/types";

export function buildHierarchy(
  collections: Collection[],
  parentKey: string | null = null,
  level: number = 0,
  ancestry: string[] = [],
  title: string | null = null,
  originalFacet: string | null = null
): Collection[] {
  return collections
    .filter((collection) => collection.parentCollection === parentKey)
    .map((collection) => ({
      ...collection,
      level,
      ancestry,
      title: title || collection.title || collection.key,
      originalFacet: originalFacet || collection.parentCollection || undefined,
      children: buildHierarchy(
        collections, 
        collection.key, 
        level + 1,
        level !== 0 ? [...ancestry, collection.key] : [],
        title || collection.title || collection.key,
        originalFacet || collection.parentCollection
      ),
    }));
}

export function calculateNumItemsRecursively(
  collection: Collection,
  collections: Collection[]
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
  collection: Collection
): string[] {
  const children = collection.children || [];

  return children.flatMap((child) => [child.key, ...getDescendantKeys(child)]);
}

export function recursiveFind(
  key: string,
  collections: Collection[]
): Collection | undefined {
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

export function withoutCollections(
  collection: Collection,
  keys: string[]
): Collection {
  return {
    ...collection,
    children: collection.children
      ?.filter((child) => !keys.includes(child.key))
      .map((child) => withoutCollections(child, keys)),
  };
}

export function flattenHierarchy(
  collections: Collection[]
): Collection[] {
  return collections.flatMap((collection) => [
    {
      ...collection,
      children: undefined,
      level: undefined,
    },
    ...flattenHierarchy(collection.children || [])
  ]);
}
