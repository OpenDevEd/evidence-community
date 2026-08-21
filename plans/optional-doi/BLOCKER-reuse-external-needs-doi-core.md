# Blocker — Plan 03 needs a change in `doi-sync-core` first

Date: 2026-08-21. Branch: `feat/optional-doi` (plans 01 and 02 are done).

## What is blocked

Plan 03, "Zenodo reuses an existing DOI" (`reuse-external`).

## Why

The Zenodo identifier policy is owned by the shared package
`@opendeved/doi-sync-core` (pinned in `package.json` to
`6765bad50488fdc731136862780b76e6582d2b35`). These places in the package
hard-code the two existing policies, so this repository cannot add a third
one on its own:

- `publication/targets.js:11` and `publication/state.js:22` — zod enums
  `['reuse-crossref', 'mint-zenodo']`.
- `planner.js:16,56,80,99,179,274` — decides when Crossref must be verified
  first, which identifiers go to Zenodo, and when a Zenodo version change
  must be pushed back to Crossref. For `reuse-external` it must pass the
  record's own DOI as the Zenodo identifier and never schedule a Crossref
  write.
- `executor/live-executor.js:254` — maps the target policy to the Zenodo
  `doiPolicy`. `reuse-external` must use the existing `external-crossref`
  record policy in `zenodo/records.js:47`, which already sends
  `metadata.doi` and skips prereservation.
- `settlement.js` — must store the external DOI as the version DOI without
  writing a managed identifier.

## What the core change looks like

1. Add `'reuse-external'` to both zod enums.
2. Planner: treat `reuse-external` like `reuse-crossref` for "send this DOI"
   but take the DOI from `input.identifiers.externalDoi` (new optional
   field) and never wait on or write to Crossref.
3. Executor: `reuse-external` → `doiPolicy: 'external-crossref'` with that
   DOI.
4. Settlement: record the version DOI from the Zenodo response; assert it
   equals the external DOI; no concept DOI handling change.
5. Tests in the core for plan, execute, and settle with an external DOI.

## What this repository does after that

- Bump the pin in `package.json` and `package-lock.json`.
- Add `'reuse-external'` to `ZENODO_IDENTIFIER_POLICIES` and the check
  constraint (one additive migration).
- Activation: allow the policy when the record has an external DOI and no
  managed Crossref DOI; resolve-check the DOI at activation.
- `buildIdentifiersView`: `archive-zenodo` becomes available for external
  DOIs; the Zenodo dialog offers "Use the record's existing DOI".
- Sandbox proof in `tools/publicationSandboxQualification.ts`.

## Decision needed

Whether to make the `doi-sync-core` change now (repository
`OpenDevEd/doi-sync-core`, branch `openscholar`) or to ship plans 01 and 02
first and schedule plan 03 with that change.
