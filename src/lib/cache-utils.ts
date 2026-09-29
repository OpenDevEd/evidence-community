import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getMeilisearchForConfig } from "@/lib/meilisearch";

type Cached<T> = { value: T; computedAt: number };

/** Computes running now, by cache document, so concurrent callers share one instead of each starting their own. */
const computing = new Map<string, Promise<unknown>>();
/** The last value this process computed or read, by cache document: it still answers while a write is indexing or failed. */
const remembered = new Map<string, Cached<unknown>>();

async function cachedDocument<T>(libraryConfig: LibraryServerConfig, key: string) {
	const { cacheIndex, indexName } = await getMeilisearchForConfig(libraryConfig);
	const docId = indexName + "-" + key;
	let cached = remembered.get(docId) as Cached<T> | undefined;
	if (!cached) {
		try {
			const result = await cacheIndex.getDocument(docId);
			// Documents written before `computedAt` was stored count as just written.
			cached = { value: JSON.parse(result.content) as T, computedAt: Number(result.computedAt) || Date.now() };
			remembered.set(docId, cached);
		} catch {
			// Cache miss
		}
	}
	return { docId, cacheIndex, cached };
}

function computeOnce<T>(
	docId: string,
	cacheIndex: Awaited<ReturnType<typeof getMeilisearchForConfig>>["cacheIndex"],
	compute: () => Promise<T>,
): Promise<T> {
	const running = computing.get(docId);
	if (running) return running as Promise<T>;
	const run = (async () => {
		const value = await compute();
		const computedAt = Date.now();
		remembered.set(docId, { value, computedAt });
		try {
			await cacheIndex.addDocuments([{ id: docId, content: JSON.stringify(value), computedAt }]);
		} catch (error) {
			// The value still answers from memory; another process computes its own.
			console.error(`Cache: writing ${docId} failed`, error);
		}
		return value;
	})().finally(() => computing.delete(docId));
	computing.set(docId, run);
	return run;
}

export async function withMeilisearchCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
): Promise<T> {
	const { docId, cacheIndex, cached } = await cachedDocument<T>(libraryConfig, key);
	return cached ? cached.value : computeOnce(docId, cacheIndex, compute);
}

/**
 * The cached value, or null straight away while one compute fills the cache in the background, for a page that
 * shows without the value rather than wait for it. A value older than `maxAgeMs` still answers while a fresh one is
 * computed behind it.
 */
export async function peekMeilisearchCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
	{ maxAgeMs }: { maxAgeMs?: number } = {},
): Promise<T | null> {
	const { docId, cacheIndex, cached } = await cachedDocument<T>(libraryConfig, key);
	const stale = cached && maxAgeMs !== undefined && Date.now() - cached.computedAt > maxAgeMs;
	if (!cached || stale) {
		computeOnce(docId, cacheIndex, compute).catch((error: unknown) => {
			console.error(`Cache: computing ${key} failed`, error);
		});
	}
	return cached ? cached.value : null;
}
