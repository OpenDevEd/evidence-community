# Optional DOI: identifiers card

## The gap

The admin DOI panel treats every published record as a Crossref and Zenodo
candidate. It runs the readiness checks up front and shows the failures in
red ("Fix item details", "DOI needs attention") even when nobody asked for a
DOI. A record that already has a DOI from Zotero or by hand was shown as
blocked. Zenodo cannot archive a record that brought its own DOI.

Agreed with the owner on 2026-08-21 (mockups reviewed):

1. DOIs are optional. Nothing is red before an editor activates something.
2. One "Identifiers" card replaces the two provider cards. It is an
   accordion, closed by default, with the facts at a glance (DOI value and
   origin, archive state). The chevron opens actions and details.
3. Readiness is shown only after the editor picks an action, as a checklist
   with "Go to field" links, never as errors.
4. A record with its own DOI shows that DOI as a fact. Crossref is not
   offered. Zenodo can archive under that DOI (`reuse-external`).
5. Red appears only when an activated target failed.

## Fixed decisions

- Keep `AdminPublicationView.providers` as the source of exact provider
  state; add a derived `identifiers` view next to it rather than rewriting
  the worker or planner.
- A DOI found only in record metadata stays external. It is never written
  to `publicationIdentifier` as managed.
- No schema change for plans 01 and 02. Plan 03 adds the policy and stores the
  outside DOI selected at activation so later edits cannot change it silently.
- Header chip: quiet "No DOI" when there is none; red only on a failed
  activated target.
- Both minting routes stay available when there is no DOI: Crossref
  registers; Zenodo archives and gives its own DOI.

## Plans

1. [Identifiers view model](01-identifiers-view-model.md)
2. [Identifiers card](02-identifiers-card.md)
3. [Zenodo reuses an existing DOI](03-zenodo-reuse-external.md)

02 depends on 01. 03 depends on 01 and 02.

## Code to reuse

- `src/lib/publication/admin-publication-view.ts` (`buildAdminPublicationViewFromSnapshot`, blockers, links, `externalDoi`)
- `src/lib/publication/admin-publication-state.ts` (`external` state added 2026-08-21)
- `src/components/admin/AdminPublicationStatus.tsx`, `AdminPublicationActivation.tsx`, `useAdminPublication.ts`
- `src/components/admin/admin-validation.ts` (`validationTargetId`) for "Go to field"
- `@opendeved/doi-sync-core` `zenodo/records.js` `external-crossref` policy (sends a client DOI)
- Tests: `tests/unit/admin-publication-view.test.ts`, `admin-publication-state.test.ts`, `admin-publication-hook.test.tsx`, `tools/publicationSandboxQualification.ts`

## Tests

Unit tests on the view model and the card's behaviour (roles, labels, text).
Real browser check on the local stack for: no DOI, external DOI, activated
and failed. Plan 03 runs the Zenodo sandbox tool with an external DOI.

## Data migration

None for 01 and 02. Plan 03 adds `lockedExternalDoi` to
`publicationTarget`. Development data is disposable; there is no compatibility
path for old `reuse-external` targets.

## Agent use

One agent may implement each numbered plan after its dependencies are merged.
Use a separate reviewer for the database and worker changes in plan 03. Do not
split one plan across agents because the tests and implementation must change
together.

## Sources

- Current repository code and tests named above.
- `@opendeved/doi-sync-core` at the commit pinned in `package.json`.
- Zenodo Sandbox responses captured by `tools/publicationSandboxQualification.ts`.
