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
7. Keep every receipt in an active action wait as an exact status request, even when the background display keeps only the newest revision of the same record.
8. Keep waiting through one or two consecutive status-request failures. Stop after the third consecutive failure and show the existing saved-but-search-incomplete error.
9. Observe the batch completion promise immediately and await it even when the intermediate admin refresh fails.

## Test-first steps

1. Add failing hook tests for all-receipts completion, two revisions of one record, exactly-once resolution, failure, unknown receipt, bounded status-request retry, and newer revisions.
2. Change direct publish, restore, unpublish, PDF, collection, and bulk browser tests to prove no final success appears before indexing.
3. Prove retry can finish a saved action without repeating its database mutation.
4. Add a batch test proving the indexing wait still runs when the intermediate admin refresh fails.
5. Run the real worker lifecycle check in Chromium and WebKit.

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
- Two revisions of the same record are both checked by exact identity and cannot leave the action stuck.
- One or two temporary receipt-status failures keep polling; three consecutive failures stop the wait with a truthful error.
- A batch always observes and awaits its indexing promise, including when the intermediate admin refresh fails.
- Failed or unknown receipts never produce final success.
- Retry can finish the same saved action without a second mutation.
- Existing public cache headers and SWR rules remain unchanged.
- Chromium, WebKit, and the real worker check pass.

## Risks

- One action can return parent, child, collection, or many bulk receipts. Wait for the complete returned set, including multiple revisions of one entity.
- Keep action waits exact. Do not infer that a newer receipt proves an older receipt completed.
- Keep background queue health visible after action-specific waits are added.
