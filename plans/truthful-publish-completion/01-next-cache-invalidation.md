# Plan 01: Clear Next.js caches after indexing

## Goal

Clear the affected Next.js data-cache tags only after Meilisearch reports success.

## Scope and design

1. Extend `src/lib/admin/cache.ts` with one receipt-based helper.
2. For indexed item receipts, clear item, small-item, citation-source, and citation-metadata tags with immediate expiry.
3. For indexed collection receipts, clear the collections tag. Affected item receipts already cover changed members and parents.
4. Call the helper in `src/app/api/admin/search-index/receipts/route.ts` after receipt states are loaded and before the indexed response is returned.
5. Remove premature cache invalidation calls from admin mutation routes. They can no longer clear a Meilisearch-backed cache before Meilisearch finishes.
6. Leave `Cache-Control` headers, SWR settings, and proxy caching unchanged.

## Test-first steps

1. Add a failing unit test for tag selection and exact immediate expiry.
2. Add a failing route test proving only indexed receipts trigger invalidation and invalidation finishes before the response.
3. Run the current receipt-service and search-worker checks.

## Files

- `src/lib/admin/cache.ts`
- `src/app/api/admin/search-index/receipts/route.ts`
- admin publish, unpublish, batch, and file mutation routes that currently invalidate early
- focused unit and route tests
- `tools/verifySearchIndexerWorker.ts`

## Data migration

None.

## Deployability gate

After deployment, confirm both Compose containers are healthy, `/api/library-config/health` is active, and the search worker is idle with no error.

## Completion rules

- Queued, processing, retrying, failed, and unknown receipts never clear Next.js tags.
- Indexed receipts clear every affected tag before the status response returns.
- No admin mutation route clears Meilisearch-backed tags early.
- No public cache header changes.
- Focused tests and the real worker check pass.

## Risks

- Status polling can repeat an invalidation. The operation is safe and the hook removes indexed receipts after the successful response.
- One action can return several item and collection receipts. Deduplicate tags before calling Next.js.
- Do not include unrelated publication-worker work in this plan's commits.
