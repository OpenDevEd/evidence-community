import dotenv from 'dotenv';
import path from 'path';
import config from "@/constants/config.json";
import { promises as fs } from 'fs';

dotenv.config();

const COLLECTIONS_PATH = path.join(process.cwd(), 'public', 'collections.json');
const HIERARCHY_PATH = path.join(process.cwd(), 'public', 'hierarchy.json');

(async () => {
    const { db } = await import('@/db');
    const { buildHierarchy, flattenHierarchy, recursiveFind } = await import('@/lib/collections');
    const collections = await db.query.collection.findMany();

    const configCollections =
        config.collections[
        (process.env.MEILI_INDEX ||
            config.index) as keyof typeof config.collections
        ] || {};

    const initialHierarchy = buildHierarchy(collections);

    const filteredCollections = Object.entries(configCollections)
        .filter(([_, config]) => config.enabled)
        .map(([key, config]) => {
            const collection = recursiveFind(key, initialHierarchy);
            if (!collection) return undefined;
            return {
                ...collection,
                ...config,
                parentCollection: null,
                ancestry: undefined,
            };
        })
        .filter((c) => c !== undefined);

    const hierarchy = buildHierarchy(flattenHierarchy(filteredCollections))
    
    const flattened = flattenHierarchy(
        hierarchy
    );

    await fs.writeFile(COLLECTIONS_PATH, JSON.stringify(flattened, null, 2));
    await fs.writeFile(HIERARCHY_PATH, JSON.stringify(hierarchy, null, 2));
})();

