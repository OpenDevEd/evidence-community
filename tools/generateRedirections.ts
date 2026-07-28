import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { createPostgresDatabaseResource } from '@/db/postgres';
import { loadLibraryConfig } from '@/config/library-config/source';
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

	const config = await loadLibraryConfig();
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	try {
		const redirectionsMap = new Map<string, string>();
		const allItems = await databaseResource.database.query.item.findMany({
			columns: {
				key: true,
				relations: true,
			},
		});

		for (const item of allItems) {
			const relations = (item.relations || {}) as RelationsType;
			if (!relations) continue;
			const value = relations['dc:replaces'];
			if (value) {
				if (Array.isArray(value)) {
					for (const replacement of value) {
						redirectionsMap.set(getKey(replacement), item.key);
					}
				} else {
					redirectionsMap.set(getKey(value), item.key);
				}
			}
		}

		const mapToObject = Object.fromEntries(redirectionsMap);
		await fs.writeFile(
			REDIRECTIONS_PATH,
			JSON.stringify(mapToObject, null, 2),
		);
	} finally {
		await databaseResource.dispose();
	}
})();
