import { eq, lt, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig, type Database } from "@/db";
import { computedCache } from "@/db/schema/tables/computedCache";

type Cached<T> = { value: T; computedAt: number };

type Store = {
	/** Computes running now, by cache key, so concurrent callers share one instead of each starting their own. */
	computing: Map<string, Promise<unknown>>;
	/** The last value this process computed or read, by cache key: it still answers while a write is in flight or failed. */
	remembered: Map<string, Cached<unknown>>;
};

// On globalThis, not in the module: Next bundles route handlers and pages separately, each with its own copy of this
// module, and a count the health check starts must be the one the pages wait for and read.
const { computing, remembered }: Store = ((globalThis as { __computedCache?: Store }).__computedCache ??= {
	computing: new Map(),
	remembered: new Map(),
});

async function cachedValue<T>(libraryConfig: LibraryServerConfig, key: string) {
	const database = await getDatabaseForConfig(libraryConfig);
	let cached = remembered.get(key) as Cached<T> | undefined;
	if (!cached) {
		try {
			const [row] = await database
				.select({ value: computedCache.value, computedAt: computedCache.computedAt })
				.from(computedCache)
				.where(eq(computedCache.key, key))
				.limit(1);
			// A compute may have finished while this read was in flight; the newer value wins.
			const current = remembered.get(key) as Cached<T> | undefined;
			const read = row ? { value: row.value as T, computedAt: row.computedAt.getTime() } : undefined;
			cached = read && (!current || current.computedAt < read.computedAt) ? read : current;
			if (cached) remembered.set(key, cached);
		} catch (error) {
			// The caller computes the value itself; the page waits for it or shows without it.
			console.error(`Cache: reading ${key} failed`, error);
			cached = remembered.get(key) as Cached<T> | undefined;
		}
	}
	return { database, cached };
}

function computeOnce<T>(database: Database, key: string, compute: () => Promise<T>): Promise<T> {
	const running = computing.get(key);
	if (running) return running as Promise<T>;
	const run = (async () => {
		const value = await compute();
		const computedAt = Date.now();
		remembered.set(key, { value, computedAt });
		try {
			// Another process may have saved a newer value meanwhile; it stays.
			await database
				.insert(computedCache)
				.values({ key, value, computedAt: new Date(computedAt) })
				.onConflictDoUpdate({
					target: computedCache.key,
					set: { value: sql`excluded."value"`, computedAt: sql`excluded."computedAt"` },
					setWhere: lt(computedCache.computedAt, sql`excluded."computedAt"`),
				});
		} catch (error) {
			// The value still answers from memory; another process computes its own.
			console.error(`Cache: writing ${key} failed`, error);
		}
		return value;
	})().finally(() => computing.delete(key));
	computing.set(key, run);
	return run;
}

function computeBehind<T>(database: Database, key: string, compute: () => Promise<T>) {
	computeOnce(database, key, compute).catch((error: unknown) => {
		console.error(`Cache: computing ${key} failed`, error);
	});
}

function isOld(cached: Cached<unknown>, maxAgeMs: number | undefined) {
	return maxAgeMs !== undefined && Date.now() - cached.computedAt > maxAgeMs;
}

/**
 * The cached value, or the wait for one compute to make it. A value older than `maxAgeMs` still answers while a fresh
 * one is computed behind it.
 */
export async function withComputedCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
	{ maxAgeMs }: { maxAgeMs?: number } = {},
): Promise<T> {
	const { database, cached } = await cachedValue<T>(libraryConfig, key);
	if (!cached) return computeOnce(database, key, compute);
	if (isOld(cached, maxAgeMs)) computeBehind(database, key, compute);
	return cached.value;
}

/**
 * The cached value, or null straight away while one compute fills the cache in the background, for a page that
 * shows without the value rather than wait for it. A value older than `maxAgeMs` still answers while a fresh one is
 * computed behind it.
 */
export async function peekComputedCache<T>(
	libraryConfig: LibraryServerConfig,
	key: string,
	compute: () => Promise<T>,
	{ maxAgeMs }: { maxAgeMs?: number } = {},
): Promise<T | null> {
	const { database, cached } = await cachedValue<T>(libraryConfig, key);
	if (!cached || isOld(cached, maxAgeMs)) computeBehind(database, key, compute);
	return cached ? cached.value : null;
}
