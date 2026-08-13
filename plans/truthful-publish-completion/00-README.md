# Truthful publish completion

## Problem

The admin says a record is published as soon as PostgreSQL saves it. Meilisearch finishes later. The app also clears its Next.js item caches before Meilisearch contains the new record, so the next request can cache the old search result again.

Publishing must mean PostgreSQL saved the change, Meilisearch succeeded, and the affected Next.js caches were cleared.

## Fixed decisions

1. Keep the existing outbox receipts as the exact search progress contract.
2. Reuse the existing receipt-status request. When it sees an indexed receipt, it clears the affected Next.js cache tags before returning that indexed result.
3. Keep the admin action busy until every receipt it returned is indexed and its cache tags are cleared.
4. Do not add a version counter, version endpoint, browser polling, database migration, worker callback, or deployment setting.
5. Do not change any public API or proxy cache header. Browser and proxy caching is outside this work.

## Plan

1. [Clear Next.js caches after indexing](01-next-cache-invalidation.md)
2. [Wait for complete publishing in admin](02-admin-publish-completion.md)

## Existing code to reuse

- `src/lib/search-index/consumer.ts`: waits for the real Meilisearch task before setting `processedAt`.
- `src/lib/admin/search-index-service.ts`: converts `processedAt` into an indexed receipt.
- `src/app/api/admin/search-index/receipts/route.ts`: the existing Next.js receipt-status request.
- `src/lib/admin/cache.ts`: the existing item and citation cache-tag list.
- `src/components/admin/useAdminSearchIndex.ts`: existing receipt polling and retry flow.
- `tools/verifySearchIndexerWorker.ts`: existing full PostgreSQL, Meilisearch, Next.js, Chromium, and WebKit check.

## Tests

- Prove no cache invalidation runs for queued, processing, retrying, failed, or unknown receipts.
- Prove indexed item and collection receipts clear the right Next.js tags before the response returns.
- Prove publish, restore, unpublish, PDF changes, parents, collections, and bulk actions wait for every returned receipt.
- Prove two revisions of the same record remain exact status requests until both finish.
- Prove one or two temporary status-request failures keep waiting and retry, while three consecutive failures stop with a truthful error.
- Prove the batch wait remains observed and runs even when the intermediate admin refresh fails.
- Check visible text, API responses, and real Meilisearch state. Do not test CSS strings.

## Data migration

None.

## Agent use

Read-only agents mapped the existing code and tests. The main session owns plan changes, test-first edits, commits, deployment, and live checks.

## Sources

- Installed Next.js 16 guide: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`
- `docs/search-indexing.md`
- OpenScholar Outline: Evidence Library current state and Architecture and data ownership
