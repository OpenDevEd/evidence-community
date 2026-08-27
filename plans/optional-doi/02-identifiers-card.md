# Plan 02 — Identifiers card

## Goal

Replace the two provider cards with one accordion card that is calm by
default and only shows readiness when the editor asks for an action.

## Scope

Change the admin presentation and navigation only. Reuse the existing
activation dialogs and publication hook.

## Design

`AdminIdentifiersCard` (new) renders from `view.identifiers`:

- Closed (default): a button with `aria-expanded` and a chevron. Glance
  line: DOI value in monospace with an origin pill, or "No DOI · optional";
  second line: archive state ("Not archived", "Archived · record 1234",
  "Publishing…", "Failed"). Nothing red unless `attention`.
- Open: DOI row with copy/open; archive and registration rows with their
  status and links; an actions area with one button per available action.
  Picking an action reveals its readiness checklist (✓/○ with "Go to field"
  linking through `validationTargetId`); the confirm button is disabled
  until `ready` and then opens the existing activation dialog.
- Header chip (`AdminPublicationChip`): "No DOI" quiet, "DOI" when a DOI
  exists, red "Needs attention" only when `attention`. Clicking scrolls to
  and opens the card.
- The open/closed state is local component state. Auto-open when
  `attention` becomes true, and reset local state when the selected record
  changes.
- "Go to field" opens a draft before focusing the field. The header chip opens
  the card before scrolling to it. Every blocker for the active provider stays
  visible.

Remove `ProviderRow` and the "Show all issues" list. Keep the activation
dialogs and polling hook unchanged.

## Test-first steps

1. Unit (testing-library): closed by default, `aria-expanded=false`,
   glance text for no DOI / external DOI / archived; nothing with
   `role="alert"` when `attention` is false.
2. Unit: opening shows actions; picking "Register with Crossref" shows the
   checklist with the blocker labels and a disabled confirm.
3. Unit: `attention: true` renders the red status and opens the card.
4. Implement; run the admin unit tests, lint, types.
5. Real browser on the local stack: a published record with no DOI, one
   with an external DOI, and one with an activated Crossref target.
   Screenshot each.

## Files

- `src/components/admin/AdminIdentifiersCard.tsx` (new)
- `src/components/admin/AdminPublicationStatus.tsx` (chip; remove provider rows)
- `src/components/admin/AdminInspector.tsx` (mount the card)
- `tests/unit/admin-identifiers-card.test.tsx` (new)

## Data migration choice

None.

## Exact tests

Run `npm test -- tests/unit/admin-identifiers-card.test.tsx
tests/unit/admin-publication-view.test.ts` and `npm run typecheck`.

## Runtime check

In the real admin, check the three planned records. Also click the header chip,
click "Go to field" on a record without an open draft, switch records while a
checklist is open, and confirm a later failure opens the card.

## Done when

No red appears on a published record until something activated fails; the
card is closed by default; the e2e admin publication spec still passes.

## Risks

Local accordion state can leak between records. Readiness links can focus
missing read-only fields unless opening the draft happens first.
