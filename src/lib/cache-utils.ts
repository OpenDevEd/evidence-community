import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getMeilisearchForConfig } from "@/lib/meilisearch";

export async function withMeilisearchCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
): Promise<T> {
	const { cacheIndex, indexName } =
		await getMeilisearchForConfig(libraryConfig);
	const docId = indexName + "-" + key;

	try {
		const result = await cacheIndex.getDocument(docId);
		return JSON.parse(result.content);
	} catch {
		// Cache miss — compute fresh data
	}

	const data = await compute();

	try {
		await cacheIndex.addDocuments([
			{ id: docId, content: JSON.stringify(data) },
		]);
	} catch {
		// Cache write failure is non-fatal
	}

	return data;
}
