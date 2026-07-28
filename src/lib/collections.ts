import { Collection } from "@/app/api/collections/types";
import type { LibraryPublicConfig } from "@/config/library-config/schema";

export class RuntimeCollectionConfigurationError extends Error {
	readonly missingIds: readonly string[];

	constructor(missingIds: readonly string[]) {
		const sortedIds = [...missingIds].sort();
		super(
			`Configured collection IDs do not exist: ${sortedIds.join(", ")}`,
		);
		this.name = "RuntimeCollectionConfigurationError";
		this.missingIds = sortedIds;
	}
}

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

export function applyRuntimeCollectionConfiguration(
	collections: readonly Collection[],
	configuredCollections: readonly LibraryPublicConfig["collections"][number][],
): Collection[] {
	const collectionIds = new Set(
		collections.map((collection) => collection.key),
	);
	const missingIds = configuredCollections
		.map((collection) => collection.id)
		.filter((id) => !collectionIds.has(id));

	if (missingIds.length) {
		throw new RuntimeCollectionConfigurationError(missingIds);
	}

	const hierarchy = buildHierarchy([...collections]);
	const disabledKeys = new Set(
		configuredCollections
			.filter((configuration) => !configuration.enabled)
			.flatMap((configuration) => {
				const collection = recursiveFind(
					configuration.id,
					hierarchy,
				);

				return collection
					? [
							collection.key,
							...getDescendantKeys(collection),
						]
					: [];
			}),
	);
	const configuredRoots = configuredCollections
		.map((configuration, index) => ({
			configuration,
			index,
		}))
		.sort((left, right) => {
			const leftOrder =
				left.configuration.order ?? left.index;
			const rightOrder =
				right.configuration.order ?? right.index;

			return (
				leftOrder - rightOrder ||
				left.configuration.id.localeCompare(
					right.configuration.id,
				)
			);
		})
		.filter(({ configuration }) => configuration.enabled)
		.map(({ configuration }) => {
			const collection = recursiveFind(
				configuration.id,
				hierarchy,
			);

			if (!collection) {
				throw new RuntimeCollectionConfigurationError([
					configuration.id,
				]);
			}

			return {
				...collection,
				title:
					configuration.title ??
					collection.name ??
					collection.title ??
					collection.key,
				parentCollection: null,
				ancestry: undefined,
			};
		});

	const flattenedCollections = flattenHierarchy(
		buildHierarchy(flattenHierarchy(configuredRoots)),
	).filter((collection) => !disabledKeys.has(collection.key));

	return flattenedCollections.filter(
		(collection, index, allCollections) =>
			index ===
			allCollections.findIndex(
				(candidate) => candidate.key === collection.key,
			),
	);
}
