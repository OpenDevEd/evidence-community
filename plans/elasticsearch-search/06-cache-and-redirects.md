# Cache and redirects in PostgreSQL (plan 06)

Issue: [#716](https://github.com/OpenDevEd/new-el/issues/716).

## Goal

Meilisearch also stores two things that aren't search. Move them to
PostgreSQL so Meilisearch can go. This plan can land at any time.

- The `cache` index holds computed statistics
  (`withMeilisearchCache` and `peekMeilisearchCache` in `src/lib/cache-utils.ts`).
- The `redirects` index maps old record keys to new ones. `src/proxy.ts` and
  `src/app/api/item/[key]/redirects/route.ts` read it when
  `generation.redirects` is on.

## Scope

1. One additive migration adds a cache table (key, JSON value, computed time)
   and a redirect table (old key, new key).
2. `src/lib/cache-utils.ts` reads and writes the cache table and keeps its
   behaviour: one computation at a time per key, and stale values served while
   a fresh one is computed. Rename the two functions so their names no longer
   say Meilisearch.
3. The proxy and the redirect route read the redirect table, keeping the
   350 ms limit and the cache tags.
4. A one-time command copies each library's redirect documents (ids
   `<index>|<key>`) from Meilisearch into the redirect table and prints the
   count. Run it on every development library before plan 08 removes
   Meilisearch. The command skips the cache.

## Checks

- Unit tests cover one computation per key, stale values on the new table,
  and the redirect lookup and its timeout.
- Run twice against a Meilisearch holding sample redirects, the copy command
  gives the same rows.

## Done when

No code reads the Meilisearch `cache` or `redirects` index, and the copy has
run on every development library. This plan lists each library's count.
