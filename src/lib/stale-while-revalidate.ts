import "server-only";

type Entry = { value?: unknown; computedAt: number; refreshing?: Promise<unknown> };

const entries = new Map<string, Entry>();

/**
 * The last value computed for `key`, returned at once, and computed again in the background once it is older than
 * `maxAgeMs`. Only the first call for a key waits. Next's "use cache" rebuilds an entry past its revalidate time
 * while the request waits, which put a large library's counts in front of a page once a minute.
 */
export async function staleWhileRevalidate<T>(key: string, maxAgeMs: number, compute: () => Promise<T>): Promise<T> {
	const entry = entries.get(key);
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
	const refreshing: Promise<T> = compute()
		.then((value) => {
			entries.set(key, { value, computedAt: Date.now() });
			return value;
		})
		.finally(() => {
			const current = entries.get(key);
			if (current?.refreshing === refreshing) delete current.refreshing;
		});
	entries.set(key, { ...entries.get(key), computedAt: entries.get(key)?.computedAt ?? 0, refreshing });
	return refreshing;
}

/** Forgets every value, so each is computed afresh on its next use: the admin's "clear public cache". */
export function forgetStaleValues() {
	entries.clear();
}
