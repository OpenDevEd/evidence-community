# Plan 01: Search completion and cache version

## Goal

Make “indexed” and “new public cache version” one database result that happens only after Meilisearch succeeds.

## Scope and design

1. Add the two public-search fields to `src/db/schema/tables/status.ts` and generate the next Drizzle migration.
2. Change `acknowledgeEvents()` in `src/lib/search-index/consumer.ts` to update the outbox rows and increment the singleton counter in one database transaction.
3. Increment the same counter after a full search rebuild finishes.
4. Add one shared server reader for the public search version.
5. Pass the version into cached collections, item, small item, citation source, and pagination metadata helpers.
6. Remove the early route-level tag invalidation path and its dead helper.
7. Change mutable public API and library-page responses from shared caching to no-store. Keep static policy, config, and citation-style caches unchanged.

## Test-first steps

1. Add a failing real outbox check for a counter that changes only after Meilisearch success and receipt acknowledgement.
2. Add failure and retry checks. A failed batch must not advance the counter.
3. Add a full-rebuild counter check.
4. Add focused tests for the public version reader, endpoint, cached helper keys, and no-store headers.
5. Run the real search outbox and worker checks.

## Files

- `src/db/schema/tables/status.ts`
- `drizzle/0029_*.sql`, `drizzle/meta/0029_snapshot.json`, `drizzle/meta/_journal.json`
- `src/lib/search-index/consumer.ts`
- `src/lib/public-search-version.ts`
- `src/app/api/search-index/version/route.ts`
- `src/app/api/cache.ts`
- `src/lib/citations.ts`
- `src/app/[locale]/lib/page.tsx`
- affected public API routes and `src/proxy.ts`
- affected admin mutation routes and `src/lib/admin/cache.ts`
- `tools/verifySearchOutbox.ts`
- `tools/verifySearchIndexerWorker.ts`
- focused unit and browser tests

## Deployability gate

This repository is deployed through the checked-in Coolify Compose app. After deployment, confirm both containers are healthy, `/api/library-config/health` is active, `/api/search-index/version` is no-store, and the search worker is idle with no error.

## Completion rules

- Meilisearch success, receipt completion, and version advance use one completion boundary.
- Queued, retrying, failed, and dead-lettered work never advances the version.
- A rebuild advances the version only after its final Meilisearch task succeeds.
- The same public URL returns new data after indexed completion.
- No old invalidation helper or shared mutable-response cache remains.

## Risks

- Workers can finish out of order. Use an atomic increment, never a maximum event ID.
- The version read can race with Meilisearch, but a result saved under version V becomes unreachable when completion commits version V+1.
- Do not include unrelated Crossref or Zenodo work in this plan's commits.
