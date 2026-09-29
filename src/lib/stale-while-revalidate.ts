import "server-only";

type Entry = { value?: unknown; computedAt: number; refreshing?: Promise<unknown> };
type Store = { entries: Map<string, Entry>; generation: number };

// Enough for every library revision and locale one process serves; the oldest goes first.
const MAX_ENTRIES = 50;

// On globalThis, not in the module: Next bundles route handlers and pages separately, each with its own copy of this
// module, and clearing the public cache from a route handler must reach what the pages read.
const store: Store = ((globalThis as { __staleWhileRevalidate?: Store }).__staleWhileRevalidate ??= {
	entries: new Map(),
	generation: 0,
});

/**
 * The last value computed for `key`, returned at once, and computed again in the background once it is older than
 * `maxAgeMs`. Only the first call for a key waits, so after a quiet spell the first visitor still gets the old value
 * and the next one the new. Next's "use cache" rebuilds an entry past its revalidate time while the request waits,
 * which put a large library's counts in front of a page once a minute.
 */
export async function staleWhileRevalidate<T>(key: string, maxAgeMs: number, compute: () => Promise<T>): Promise<T> {
	const entry = store.entries.get(key);
	if (entry && "value" in entry) {
		if (Date.now() - entry.computedAt > maxAgeMs && !entry.refreshing) {
			refresh(key, compute).catch((error: unknown) => {
				console.error(`Refreshing ${key} failed; the last value stays`, error);
			});
		}
		return entry.value as T;
	}
	return ((entry?.refreshing as Promise<T> | undefined) ?? refresh(key, compute));
}

function refresh<T>(key: string, compute: () => Promise<T>): Promise<T> {
	const generation = store.generation;
	const refreshing: Promise<T> = compute()
		.then((value) => {
			// A value counted before the cache was cleared is not kept.
			if (store.generation === generation) put(key, { value, computedAt: Date.now() });
			return value;
		})
		.finally(() => {
			const current = store.entries.get(key);
			if (current?.refreshing === refreshing) delete current.refreshing;
		});
	const current = store.entries.get(key);
	put(key, { ...current, computedAt: current?.computedAt ?? 0, refreshing });
	return refreshing;
}

function put(key: string, entry: Entry) {
	store.entries.delete(key);
	store.entries.set(key, entry);
	while (store.entries.size > MAX_ENTRIES) store.entries.delete(store.entries.keys().next().value!);
}

/** Forgets every value, so each is computed afresh on its next use: the admin's "clear public cache". */
export function forgetStaleValues() {
	store.generation += 1;
	store.entries.clear();
}
