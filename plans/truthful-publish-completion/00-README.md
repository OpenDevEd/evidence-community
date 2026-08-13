# Truthful publish completion

## Problem

The admin currently says a record is published as soon as PostgreSQL saves it. Meilisearch finishes later. The app also clears some Next.js caches before Meilisearch has the new record, while public HTTP caches can keep old responses for almost two minutes.

Publishing must mean the complete public flow is done: PostgreSQL saved the change, Meilisearch accepted it, and new public reads cannot select an older cache entry.

## Fixed decisions

1. Keep PostgreSQL as the real record store and the existing outbox receipts as the exact search progress contract.
2. Add a counter to the singleton status row. Increment it in the same database transaction that marks a completed outbox batch as processed.
3. Include that counter in every server and browser cache key that depends on public search data. Old cache entries then become unreachable when a receipt becomes `indexed`.
4. Stop shared HTTP caching for mutable library pages and APIs. The app cannot purge already shared proxy responses safely.
5. Keep admin actions busy until every receipt they returned is indexed. A failed or missing receipt is not success.

The worker will not call a private Next.js endpoint. No deployment secret or one-off server setting is needed.

## Plan

1. [Search completion and cache version](01-search-completion-and-cache-version.md)
2. [Admin completion and public browser refresh](02-admin-completion-and-browser-refresh.md)

## Existing code to reuse

- `src/lib/search-index/consumer.ts`: real Meilisearch task waiting, leases, retries, and outbox acknowledgement.
- `src/lib/admin/search-index-service.ts`: exact receipt state lookup.
- `src/components/admin/useAdminSearchIndex.ts`: existing receipt polling and retry flow.
- `src/db/schema/tables/status.ts`: existing singleton public status row.
- `src/components/layout/Base.tsx` and `src/context/Providers.tsx`: existing server-to-browser status handoff.
- `tools/verifySearchOutbox.ts` and `tools/verifySearchIndexerWorker.ts`: real PostgreSQL, Meilisearch, Next.js, Chromium, and WebKit checks.

## Tests

- Write red tests before each plain-logic change.
- Prove the counter stays unchanged while work is queued, retrying, or failed.
- Prove Meilisearch succeeds before the counter advances and the receipts become indexed.
- Prove publish, restore, unpublish, PDF changes, parent updates, collections, and bulk actions wait for every receipt.
- Warm the same public URL before a change and read the same URL after completion. Do not add cache-busting query parameters.
- Check visible text, API data, headers, database rows, and real Meilisearch state. Do not test CSS strings.

## Data migration

Add `publicSearchVersion` and `publicSearchUpdatedAt` to the disposable development status row through one checked-in Drizzle migration. No compatibility reads or backfill tool will be added.

## Agent use

Read-only agents mapped the architecture and the exact existing test seams. The main session owns the plan, test-first edits, commits, deployment, and live checks.

## Sources

- Installed Next.js 16 docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`
- `docs/search-indexing.md`
- OpenScholar Outline: Evidence Library current state and Architecture and data ownership
