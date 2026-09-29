import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getMeilisearchForConfig } from "@/lib/meilisearch";

/** Computes running now, by cache document, so concurrent callers share one instead of each starting their own. */
const computing = new Map<string, Promise<unknown>>();

async function cachedDocument<T>(libraryConfig: LibraryServerConfig, key: string) {
	const { cacheIndex, indexName } = await getMeilisearchForConfig(libraryConfig);
	const docId = indexName + "-" + key;
	try {
		const result = await cacheIndex.getDocument(docId);
		return { docId, cacheIndex, value: JSON.parse(result.content) as T };
	} catch {
		return { docId, cacheIndex, value: undefined };
	}
}

function computeOnce<T>(
	docId: string,
	cacheIndex: Awaited<ReturnType<typeof getMeilisearchForConfig>>["cacheIndex"],
	compute: () => Promise<T>,
): Promise<T> {
	const running = computing.get(docId);
	if (running) return running as Promise<T>;
	const run = (async () => {
		const data = await compute();
		try {
			await cacheIndex.addDocuments([{ id: docId, content: JSON.stringify(data) }]);
		} catch {
			// Cache write failure is non-fatal
		}
		return data;
	})().finally(() => computing.delete(docId));
	computing.set(docId, run);
	return run;
}

export async function withMeilisearchCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
): Promise<T> {
	const { docId, cacheIndex, value } = await cachedDocument<T>(libraryConfig, key);
	return value !== undefined ? value : computeOnce(docId, cacheIndex, compute);
}

/**
 * The cached value, or null straight away while one compute fills the cache in the background, for a page that
 * shows without the value rather than wait for it.
 */
export async function peekMeilisearchCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
): Promise<T | null> {
	const { docId, cacheIndex, value } = await cachedDocument<T>(libraryConfig, key);
	if (value !== undefined) return value;
	computeOnce(docId, cacheIndex, compute).catch((error: unknown) => {
		console.error(`Cache: computing ${key} failed`, error);
	});
	return null;
}
