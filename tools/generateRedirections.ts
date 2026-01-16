import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { item } from '@/db/schema/tables/item';
import { RelationsType } from '@/types/item';

dotenv.config();

const REDIRECTIONS_PATH = path.join(process.cwd(), 'src', 'constants', 'redirections.json');

function getKey(url: string) {
    return url.split('/').pop() || '';
}

(async () => {
    if (process.env.SHOULD_GENERATE_REDIRECTIONS !== 'true') {
        return;
    }

	 const { db } = await import('@/db');
     const reditectionsMap = new Map<string, string>();
     const allItems = await db.query.item.findMany({
        columns: {
            key: true,
            relations: true,
        }
     })

    for (const item of allItems) {
        const relations = (item.relations || {}) as RelationsType;
        if (!relations) continue;
        const value = relations['dc:replaces'];
        if (value) {
            if (Array.isArray(value)) {
                for (const v of value) {
                    reditectionsMap.set(getKey(v), item.key);
                }
            } else {
                reditectionsMap.set(getKey(value), item.key);
            }
        }
    }
    
    const mapToObject = Object.fromEntries(reditectionsMap);

    await fs.writeFile(REDIRECTIONS_PATH, JSON.stringify(mapToObject, null, 2));
})();
