# 03 — Manual Crossref activation

## Goal

Implement an idempotent administrator action that reserves or classifies a DOI, exposes the reserved DOI immediately, queues Crossref test registration, and opts only that item into future Crossref synchronization.

## Scope

- Activation validation and DOI classification/allocation.
- Transactional canonical DOI mutation, target creation, identifier reservation, publication job, search outbox event, receipt, and ordinary source-writeback enqueueing.
- Verified settlement that changes publication state from reserved/in progress to active without pretending reservation was verification.
- Crossref test execution, pending verification, retry, and status contracts.
- No Zenodo activation and no UI beyond contracts.

## Design

Add a publication service and admin routes:

- `POST /api/admin/items/[key]/publication/crossref/activate`
- `GET /api/admin/items/[key]/publication`
- `POST /api/admin/items/[key]/publication/crossref/retry`

Activation validates administrator access, parent/public item status, stable landing URL, supported item type, type-specific required fields, configured test credentials, and DOI ownership.

Before classification or allocation, reuse the pure `resolveBibliographicDoi` helper created in phase 02. It normalizes DOI URLs/prefixes and reads `item.DOI`, Zotero-style `extra`, and DOI link attachments tagged `_r:doi`, using the parsing behavior already established in `src/lib/utils.ts` and the current public display path. Matching values collapse to one DOI. Conflicting non-empty values block activation with a field-specific error. A DOI found in any source is an existing DOI and can never enter the allocation branch.

If the resolved item has no DOI, the confirmation view says that Crossref will assign a DOI under the configured prefix/namespace; it does not guess the next sequence. The activation transaction locks `doiNamespace`, reserves the exact next DOI, inserts the managed `reserved` identifier and target, copies the DOI into `item.DOI`, increments the item revision, enqueues Crossref delivery, adds the search-index outbox event, adds ordinary source writeback when allowed, and returns the exact DOI and receipt.

The Crossref prefix is assigned to the member account and comes from `services.publication.crossref.prefix`. The suffix namespace also comes from server-only library configuration. PostgreSQL appends a zero-padded counter while holding the namespace row lock. The browser cannot submit a prefix, suffix, counter, or complete DOI.

If the resolved item has a DOI in metadata but this library has no matching managed `publicationIdentifier` row for the item, the DOI is external regardless of prefix. It remains available for bibliographic display and blocks Crossref activation with an actionable response. It does not satisfy the managed Crossref DOI option for Zenodo.

Reuse is valid only when this item already has a matching managed `publicationIdentifier` row created by the local reservation transaction. Delete the prefix-only reuse branch from `classifyCrossrefActivationDoi`; the configured prefix alone never proves local ownership.

The worker builds a complete schema 5.5 document, validates locally, submits to Crossref test, parses deposit diagnostics, and stores either terminal failure, pending verification, or active state. Accepted-but-not-indexed submissions remain `verifying`; they are never reported active from a successful HTTP request alone.

When verification succeeds, settlement changes the identifier lifecycle to `verified` and the UI state to `synced`. A permanent failure leaves the DOI canonical, public, and reserved for retry; it is never removed or returned to the counter.

Manual retry follows the existing writeback donor: it resets the latest dead-lettered publication job to due, clears its terminal marker and lease, preserves its attempt history, and does not create a second job for the same idempotency key.

## TDD sequence

1. Add route/contract tests for unsupported type, missing fields, private/draft item, missing config, server-owned prefix/namespace, ignored client DOI input, direct-field DOI, Extra-only DOI, attachment-only DOI, matching multi-source DOI, conflicting DOI sources, same-prefix metadata DOI classified external, managed identifier reuse, duplicate activation, and valid activation.
2. Add activation transaction tests proving the canonical DOI/revision, identifier reservation, target, publication job, search outbox event, source writeback, and receipt commit or roll back together.
3. Add concurrent activation tests proving one DOI allocation and one active target.
4. Add settlement tests proving verification changes the identifier lifecycle and enqueues exactly one parent search reprojection in the same transaction, without creating a second item revision or source-writeback job.
5. Add provider-fake tests for diagnostics success, pending verification, permanent rejection, transient retry, and conflict.
6. Implement service, routes, queue integration, and Crossref worker adapter.
7. Add local full-stack HTTP verifier without real provider calls.

## Files touched

- new `src/lib/publication/crossref-activation-service.ts`
- new `src/lib/publication/crossref-adapter.ts`
- extend/reuse `src/lib/publication/bibliographic-doi.ts` from phase 02
- new `src/lib/publication/contracts.ts`
- new `src/lib/publication/queue.ts`
- new API routes under `src/app/api/admin/items/[key]/publication/`
- `src/lib/admin/errors.ts` and `src/lib/admin/http.ts` only if shared error mapping needs extension
- canonical item/search/source-writeback transaction donors in `src/lib/admin/native-item-service.ts`, the search outbox repository used there, and `src/lib/source-writeback/queue.ts`
- new `tools/verifyCrossrefActivation.ts`
- new provisional `tools/runPublicationJobsOnce.ts` used only by phases 03-04 before the long-running phase-05 worker replaces it
- focused unit and HTTP tests
- `package.json`

## Migration stance

No legacy activation endpoint or status field is introduced. Existing DOI values from `item.DOI`, `extra`, or tagged DOI attachments remain external bibliographic identifiers unless this library already has a matching managed `publicationIdentifier` row for the item.

## Exact test plan

```sh
npm run test:publication-model
npm run test:crossref-activation
npm run test:source-writeback
npm run test:search-index
npm run test:native-lifecycle
npm run test:linked-item-lifecycle
npm run test:unit
npx tsc --noEmit
npm run lint
```

## Deployability/runtime gate

- Local activation with a fake provider produces a durable receipt and reaches active only after verification.
- Restarting between submission and verification resumes from stored pending state.
- Test environment is encoded in every row and response.
- Crossref production endpoints remain unrepresentable in configuration.

## Acceptance criteria

- Nothing is scheduled before the manual action.
- Every valid manual action returns the same target on repeated clicks.
- Unsupported types and invalid metadata produce field-specific human errors.
- DOI allocation is collision-safe and cannot be recycled.
- Source-linked and native items use the same Crossref publication path.
- Zotero writeback occurs only through existing configured source writeback.
- A reserved DOI is immediately reprojected into Meilisearch through the transactional outbox and remains clearly marked unverified until Crossref settles it.

## Pitfalls

- DOI registration is irreversible; never reserve from browser state or outside a transaction.
- Do not preview the exact next DOI before reservation; another activation may win the counter lock.
- Never branch on `item.DOI` alone; Zotero item types without a native DOI field may carry it in `extra` or a DOI link attachment tagged `_r:doi`.
- A DOI resolver response alone does not prove the configured account owns the record.
- Complete Crossref redeposits must include all retained bibliographic metadata and increment timestamps.
- Do not make Zenodo activation an implicit side effect.
