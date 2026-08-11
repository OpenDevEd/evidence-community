# 03 — Manual Crossref activation

## Goal

Implement an idempotent administrator action that reserves or classifies a DOI, queues Crossref test registration, exposes durable progress, and opts only that item into future Crossref synchronization.

## Scope

- Activation validation and DOI classification/allocation.
- Transactional canonical mutation, target creation, publication job, search outbox event, receipt, and ordinary source-writeback enqueueing.
- Crossref test execution, pending verification, retry, and status contracts.
- No Zenodo activation and no UI beyond contracts.

## Design

Add a publication service and admin routes:

- `POST /api/admin/items/[key]/publication/crossref/activate`
- `GET /api/admin/items/[key]/publication`
- `POST /api/admin/items/[key]/publication/crossref/retry`

Activation validates administrator access, parent/public item status, stable landing URL, supported item type, type-specific required fields, configured test credentials, and DOI ownership.

Before classification or allocation, reuse the pure `resolveBibliographicDoi` helper created in phase 02. It normalizes DOI URLs/prefixes and reads `item.DOI`, Zotero-style `extra`, and DOI link attachments tagged `_r:doi`, using the parsing behavior already established in `src/lib/utils.ts` and the current public display path. Matching values collapse to one DOI. Conflicting non-empty values block activation with a field-specific error. A DOI found in any source is an existing DOI and can never enter the allocation branch.

If the resolved item has no DOI, reserve the next configured human-readable DOI in a database transaction, update the canonical item and revision, insert the managed identifier and activated target, enqueue Crossref delivery, enqueue the search-index outbox event, enqueue normal source writeback when applicable, and return an exact receipt.

If the resolved item has a DOI, regardless of whether it came from `item.DOI`, `extra`, or a tagged DOI attachment:

- A configured owned prefix may be classified as managed after Crossref test lookup and conflict checks.
- A third-party DOI is classified external and blocks Crossref activation with an actionable response; it remains available for bibliographic display and may later be reused by a manually activated Zenodo target.

The worker builds a complete schema 5.5 document, validates locally, submits to Crossref test, parses deposit diagnostics, and stores either terminal failure, pending verification, or active state. Accepted-but-not-indexed submissions remain `verifying`; they are never reported active from a successful HTTP request alone.

## TDD sequence

1. Add route/contract tests for unsupported type, missing fields, private/draft item, missing config, direct-field DOI, Extra-only DOI, attachment-only DOI, matching multi-source DOI, conflicting DOI sources, external DOI, duplicate activation, and valid activation.
2. Add transactional tests proving item revision, identifier, target, publication job, search outbox event, receipt, and source writeback commit or roll back together.
3. Add concurrent activation tests proving one DOI allocation and one active target.
4. Add provider-fake tests for diagnostics success, pending verification, permanent rejection, transient retry, and conflict.
5. Implement service, routes, queue integration, and Crossref worker adapter.
6. Add local full-stack HTTP verifier without real provider calls.

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
- focused unit and HTTP tests
- `package.json`

## Migration stance

No legacy activation endpoint or status field is introduced. Existing unclassified DOI values from `item.DOI` or `extra` remain bibliographic identifiers until manual activation classifies them.

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
- Allocating or otherwise changing the canonical DOI reprojects the item into Meilisearch through the transactional outbox.

## Pitfalls

- DOI registration is irreversible; never reserve from browser state or outside a transaction.
- Never branch on `item.DOI` alone; Zotero item types without a native DOI field may carry it in `extra` or a DOI link attachment tagged `_r:doi`.
- A DOI resolver response alone does not prove the configured account owns the record.
- Complete Crossref redeposits must include all retained bibliographic metadata and increment timestamps.
- Do not make Zenodo activation an implicit side effect.
