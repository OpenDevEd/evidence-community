# Plan 02: Wait for complete publishing in admin

## Goal

Keep each admin publishing action in progress until all of its exact receipts are indexed and Plan 01 has cleared their Next.js caches.

## Scope and design

1. Extend `useAdminSearchIndex()` with an action-specific promise that uses the existing receipt polling.
2. Resolve only when every supplied receipt is indexed.
3. Reject failed and unknown receipts with plain text explaining that PostgreSQL saved the change but public search did not finish.
4. Await the promise before showing final success for publish, restore, unpublish, PDF publish/unpublish, collection changes, parent changes, and bulk actions.
5. Keep the existing background indexing status and retry control.
6. Do not add a second polling request or change public browser caches.

## Test-first steps

1. Add failing hook tests for all-receipts completion, exactly-once resolution, failure, unknown receipt, retry, and newer revisions.
2. Change direct publish, restore, unpublish, PDF, collection, and bulk browser tests to prove no final success appears before indexing.
3. Prove retry can finish a saved action without repeating its database mutation.
4. Run the real worker lifecycle check in Chromium and WebKit.

## Files

- `src/components/admin/useAdminSearchIndex.ts`
- `src/components/admin/AdminWorkbench.tsx`
- `tests/unit/admin-search-index-hook.test.tsx`
- `tests/e2e/admin.spec.ts`
- `tools/verifySearchIndexerWorker.ts`
- `docs/search-indexing.md`

## Data migration

None.

## Deployability gate

After deployment, confirm both containers are healthy. In the live admin, publish a development record and confirm final success appears only after its receipt is indexed.

## Completion rules

- Final success means every receipt from that action is indexed and its Next.js tags were cleared.
- Failed or unknown receipts never produce final success.
- Retry can finish the same saved action without a second mutation.
- Existing public cache headers and SWR rules remain unchanged.
- Chromium, WebKit, and the real worker check pass.

## Risks

- One action can return parent, child, collection, or many bulk receipts. Wait for the complete returned set.
- A newer revision must not resolve a promise waiting for a different revision.
- Keep background queue health visible after action-specific waits are added.
