# Plan 02: Admin completion and public browser refresh

## Goal

Keep each admin action in progress until all of its exact search receipts are indexed, then make open public screens request the new search version.

## Scope and design

1. Extend `useAdminSearchIndex()` with a promise-based wait method keyed by the existing receipt identity.
2. Resolve only when every receipt is indexed. Reject failed and unknown receipts with plain instructions that the database change was saved but public search did not finish.
3. Use that method for publish, restore, unpublish, PDF publish/unpublish, collection changes, parent changes, and bulk actions.
4. Show the final success message only after the wait resolves. Keep the action busy while waiting.
5. Poll the no-store public search version through the existing provider. Include it in all public SWR keys that read items, lists, facets, collections, relations, citations, and navbar results.
6. Key the existing manual pathname item cache by version and remove stale saved recent-item data when the version changes.

No state-sync effect will be added. The version is part of the fetch key, and each action awaits the promise returned by the receipt waiter.

## Test-first steps

1. Add failing hook tests for all-receipts completion, exactly-once resolution, failure, retry, unknown receipt, and a newer revision.
2. Change the direct publish, restore, unpublish, PDF, parent, collection, and bulk browser tests to prove no success appears before indexing.
3. Add browser checks that a completed version change refetches public list, facet, item, relation, and citation data without a hard reload.
4. Extend the real worker test to cover one direct action, one parent/child action, one collection action, bulk work, failure, and retry.

## Files

- `src/components/admin/useAdminSearchIndex.ts`
- `src/components/admin/AdminWorkbench.tsx`
- `src/context/Providers.tsx`
- `src/hooks/useItemsList.ts`
- `src/hooks/useFilters.ts`
- public item, citation, relation, and navbar SWR consumers
- `tests/unit/admin-search-index-hook.test.tsx`
- `tests/e2e/admin.spec.ts`
- `tools/verifySearchIndexerWorker.ts`
- `docs/search-indexing.md`

## Data migration

No additional migration. This plan consumes the status fields from Plan 01.

## Deployability gate

After deployment, confirm both containers are healthy. In the live browser, publish a development record, confirm success appears only after the receipt is indexed, then open the same public item and list URLs and confirm the new data appears.

## Completion rules

- “Published,” “Restored,” “Unpublished,” and matching PDF/bulk success messages mean every returned receipt is indexed.
- A failed or unknown receipt never produces a success message.
- Retrying can finish the same pending action without a second database mutation.
- Open public screens switch to versioned keys and show the completed search state.
- Chromium and WebKit checks pass.

## Risks

- One mutation can return parent, child, collection, or many bulk receipts. Wait for the whole returned set.
- A newer revision can supersede an older tracked revision. Do not resolve the wrong action.
- Keep background queue health visible even after action-specific waits are added.
