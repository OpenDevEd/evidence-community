import { Collection } from "@/app/api/collections/types";

export function buildHierarchy(
  collections: Collection[],
  parentKey: string | null = null,
  level: number = 0,
  ancestry: string[] = [],
  title: string | null = null,
  originalFacet: string | null = null
): Collection[] {
  const childrenMap = new Map<string | null, Collection[]>();
  
  for (const collection of collections) {
    const parent = collection.parentCollection;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(collection);
  }
  
  const getChildren = (parentKey: string | null) => childrenMap.get(parentKey) || [];
  
  const buildLevel = (
    parentKey: string | null,
    level: number,
    ancestry: string[],
    title: string | null,
    originalFacet: string | null
  ): Collection[] => {
    return getChildren(parentKey).map((collection) => ({
      ...collection,
      level,
      ancestry,
      title: title || collection.title || collection.key,
      originalFacet: originalFacet || collection.parentCollection || undefined,
      children: buildLevel(
        collection.key,
        level + 1,
        level !== 0 ? [...ancestry, collection.key] : [],
        title || collection.title || collection.key,
        originalFacet || collection.parentCollection
      ),
    }));
  };
  
  return buildLevel(parentKey, level, ancestry, title, originalFacet);
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
  const result: string[] = [];
  const stack: Collection[] = [...(collection.children || [])];
  
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current.key);
    
    if (current.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }
  
  return result;
}

export function recursiveFind(
  key: string,
  collections: Collection[]
): Collection | undefined {
  const collectionsMap = new Map<string, Collection>();
  
  const populateMap = (cols: Collection[]) => {
    for (const col of cols) {
      collectionsMap.set(col.key, col);
      if (col.children) {
        populateMap(col.children);
      }
    }
  };
  
  populateMap(collections);
  return collectionsMap.get(key);
}

export function flattenHierarchy(
  collections: Collection[]
): Collection[] {
  const result: Collection[] = [];
  const stack: Collection[] = [...collections];
  
  while (stack.length > 0) {
    const collection = stack.pop()!;
    result.push({
      ...collection,
      children: undefined,
      level: undefined,
    });
    
    if (collection.children && collection.children.length > 0) {
      stack.push(...collection.children);
    }
  }
  
  return result;
}


export function addDescendantsNamesToHierarchy(
  hierarchy: Collection[]
): Collection[] {
  const descendantsCache = new Map<string, string[]>();
  
  const getDescendantNames = (collection: Collection): string[] => {
    if (descendantsCache.has(collection.key)) {
      return descendantsCache.get(collection.key)!;
    }
    
    const names: string[] = [];
    if (!collection.children || collection.children.length === 0) {
      descendantsCache.set(collection.key, names);
      return names;
    }
    
    for (const child of collection.children) {
      names.push(child.name || child.key);
      names.push(...getDescendantNames(child));
    }
    
    descendantsCache.set(collection.key, names);
    return names;
  };
  
  return hierarchy.map(collection => ({
    ...collection,
    descendantsNames: collection.children ? getDescendantNames(collection) : [],
    children: collection.children 
      ? addDescendantsNamesToHierarchy(collection.children)
      : undefined
  }));
}