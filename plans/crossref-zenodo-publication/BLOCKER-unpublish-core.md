# Blocker: DOI withdrawal after record unpublication

## What is blocked

An Evidence Library record with an active Crossref or Zenodo target cannot yet be unpublished safely.

The current public record route returns not found after local unpublication. The pinned `@opendeved/doi-sync-core` version has no withdrawal operation, withdrawn identifier state, or target policy that describes a withdrawn record. Sending the old live metadata would leave the DOI pointing to a missing page. Reporting the job as complete would be false.

## Required shared-core work

1. Add a provider-neutral desired state for withdrawal.
2. Add explicit Crossref and Zenodo withdrawal plans and settlement results.
3. Add a durable withdrawn identifier state without deleting or reusing the DOI.
4. Add crash, retry, and provider-verification tests for both providers.
5. Pin the finished core revision here, then add an Evidence Library tombstone landing page and transactional unpublish queue hook.

## Work that can continue

Active record edits, file publication changes, Crossref verification wake-up, delivery, retries, nightly reconciliation, worker health, and the admin DOI controls are not blocked.

## Proof

- `src/app/[locale]/lib/[key]/ServerComponent.tsx` returns not found when the public record cannot be loaded.
- `src/lib/publication/crossref-adapter.ts` and `src/lib/publication/zenodo-adapter.ts` reject deleted records.
- `@opendeved/doi-sync-core` at `9816cde6f80e02c45ecd9242b03c1f2e3f1c698e` has no provider withdrawal operation.
