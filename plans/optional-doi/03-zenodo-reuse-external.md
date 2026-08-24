# Plan 03 — Zenodo reuses an existing DOI

## Goal

Let Zenodo archive a record and its PDF under the DOI the record already
has, without minting or registering anything.

## Scope

Add one clean `reuse-external` path from activation through the worker and
Zenodo Sandbox. Do not add general DOI editing or release management.

## Design

- Add identifier policy `reuse-external` to the Zenodo target (schema enum,
  additive migration), the activation request, and `planPublicationSync`.
- Activation requires the record DOI to resolve outside the database
  transaction: one `HEAD
  https://doi.org/<doi>` with a short timeout; a non-2xx/3xx answer blocks
  with "This DOI does not resolve yet".
- The worker passes the DOI through the DOI core's `external-crossref`
  record policy, which sends `metadata.doi` and skips prereservation.
- No `publicationIdentifier` row with `ownership: managed` is written.
- Activation rejects a DOI already assigned to another local record. It stores
  the checked DOI on the target and verifies it again before every worker run,
  including jobs that first waited for a PDF. A mismatch fails permanently.
- While such a target is active, the record's DOI field is read-only in the
  editor with the reason shown.
- `identifiers.actions` gains `archive-zenodo` as available for external
  DOIs; readiness includes the PDF and abstract checks already computed.

## Test-first steps

1. Unit: view offers `archive-zenodo` for an external DOI.
2. Unit: plan/payload for `reuse-external` sends the DOI and never
   prereserves.
3. Unit: activation rejects a DOI that does not resolve (mocked fetch).
4. Unit/integration: activation rejects a local DOI collision; a changed DOI
   is rejected before a worker writes remotely and is not retried.
5. Real: `tools/publicationSandboxQualification.ts` gains one external-DOI
   deposit to Zenodo Sandbox and reads back the record's DOI.
6. Browser: archive a record with an external DOI on the local stack.

## Files

- `src/db/schema/publication.ts`, new migration
- `src/lib/publication/zenodo-adapter.ts`, `admin-publication-view.ts`
- activation route and dialog
- `tools/publicationSandboxQualification.ts`

## Data migration choice

Add `publicationTarget.lockedExternalDoi` with a database check: it is required
only for active or inactive `reuse-external` Zenodo targets and forbidden for
other policies. Development data may be reset instead of backfilled.

## Exact tests

Run the Zenodo activation, adapter, route, publication view, and migration
tests; then `npm run check:changed` and the full acceptance suite once.

## Runtime check

Run the repeatable Sandbox qualification against the configured development
account. Read back the published DOI, remove the test deposit and local fixture,
and confirm the tool exits with no abandoned Docker environment.

## Done when

A record with an outside DOI can be archived on Zenodo, the Zenodo record
shows that DOI, and the identifier stays external in the database.

## Risks

Never perform DOI network I/O while holding a database transaction. Never let a
stale tab, waiting job, or retry substitute a different DOI after activation.
