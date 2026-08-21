# Plan 01 — Identifiers view model

## Goal

Give the admin one server-built summary that answers: does this record have
a DOI, where did it come from, is it archived, what can the editor do next,
and what would they need to add first.

## Design

Add `identifiers` to `AdminPublicationView`, built in
`buildAdminPublicationViewFromSnapshot` from values it already computes:

```ts
identifiers: {
  doi: { value: string; origin: "crossref" | "zenodo" | "source" | "record"; url: string } | null;
  archive:
    | { state: "none" }
    | { state: "active"; provider: "zenodo"; displayState; status; links; recordId: string | null };
  registration:
    | { state: "none" }
    | { state: "active"; provider: "crossref"; displayState; status; links };
  attention: boolean; // an activated target is failed
  actions: Array<{
    id: "register-crossref" | "archive-zenodo" | "mint-zenodo";
    label: string;
    available: boolean;       // configured and not already active
    readiness: Array<{ label: string; ok: boolean; field: string | null }>;
    ready: boolean;           // every readiness item ok
  }>;
}
```

- `origin`: managed Crossref → `crossref`; managed Zenodo version DOI →
  `zenodo`; a metadata DOI on a source-linked record → `source`; otherwise
  `record`.
- `readiness` maps each blocker string to an item with `ok: false`, plus a
  `field` when the blocker names a record field (use the existing
  `recordErrors` field paths). When there are no blockers, one item
  `{ label: "Record details", ok: true }`.
- `actions` never include Crossref when `doi` exists and is not managed by
  Crossref. Until plan 03, `archive-zenodo` on an external DOI is `available:
  false` with one readiness item explaining why.
- `attention` is true only when a provider view is `failed`.

## Test-first steps

1. Unit: no DOI → `doi: null`, both mint actions, readiness lists blockers.
2. Unit: external DOI → origin `record`/`source`, no Crossref action, Zenodo
   archive listed but unavailable (until 03).
3. Unit: managed Crossref verified → origin `crossref`, registration active.
4. Unit: failed Zenodo job → `attention: true`.
5. Implement; `npm run test:unit`, `npx tsc --noEmit`, lint.

## Files

- `src/lib/publication/admin-publication-view.ts`
- `tests/unit/admin-publication-view.test.ts`

## Done when

`identifiers` is present on every view, tests above pass, no other behaviour
changes.
