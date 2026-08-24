# 06 — Admin DOI publishing UI

## Goal

Add a small DOI publishing section to the existing item inspector. An administrator can activate Crossref or Zenodo, understand the current state, fix metadata, retry failed work, and open or copy identifiers without learning the worker's internal model.

## Scope

- One item-level publication status contract and SWR client.
- Manual Crossref and Zenodo activation.
- Durable progress, validation, retry, copy, and open actions.
- No separate DOI page, table column, browser-owned workflow, or production provider option.

## Design

### Placement

Add `DOI publishing` as the first section in the scrollable part of `AdminInspector`, before `Metadata`. This keeps it close to the item's publish controls and visible without crowding the fixed header.

The existing header status row gains one compact DOI status chip only after a target exists or action is needed. The chip scrolls the inspector to the DOI section. Do not add a default item-table column; publication filters or columns can be added later only after the item-level flow is proven.

Attachments do not show provider controls. Their published files affect their parent's Zenodo state, so an attachment shows only a short link back to the parent DOI section when needed.

### Server-built state

`GET /api/admin/items/[key]/publication` returns `AdminPublicationView`, built by the phase-02 `buildAdminPublicationView` service. React renders this contract directly and never joins targets, jobs, receipts, journals, or identifiers itself.

The response contains:

- `crossref` and `zenodo` provider views;
- exact machine facts for tests and activity details;
- one derived display state: `inactive`, `blocked`, `waiting`, `queued`, `working`, `verifying`, `retrying`, `repair_pending`, `synced`, or `failed`, plus `waitingOn: crossref | file` when needed;
- one plain-language title and description;
- allowed actions such as activate, retry, edit metadata, open, or copy;
- field-specific validation issues with inspector field targets;
- stable identifiers and provider links;
- the latest receipt, attempt count, next retry time, and last update;
- `shouldPoll`, derived by the server from durable transitional state.

The UI uses SWR. It polls quickly only when `shouldPoll` is true, revalidates after mutations, and stops fast polling in every stable state. Activation responses seed the same cache with the returned durable view. Local state is limited to whether a confirmation surface is open and the not-yet-submitted Zenodo policy choice.

### Visual design

The section is one quiet bordered group with two stacked provider rows, not two large cards.

Each row contains:

1. Provider name and one-line purpose.
2. A small icon plus plain status text.
3. The DOI or record identifier when it exists.
4. One primary action and compact icon actions for copy/open.

Validation issues appear directly below the affected provider row. Show at most the first three, then `Show all`. Clicking an issue focuses the existing metadata field. Failures stay visible in the row; do not use toast-only errors.

Use the existing inspector spacing, type scale, `Button`, `Popover`, `DialogModal`, `Chip`, and icon sizes. Confirmation dialogs use the shared compact width and equal padding. Spinners occupy the same fixed box as the icon they replace, so no row shifts.

### Crossref activation

The inactive row has one `Activate Crossref DOI` button.

The confirmation dialog shows:

- whether the item already has a DOI;
- for a new DOI, the configured prefix and suffix namespace, for example `10.1234/el.…`;
- for an existing owned DOI, the exact DOI that will be registered;
- any metadata fields that must be fixed first;
- a clear statement that reservation is permanent.

The browser never sends a prefix, suffix, counter, or DOI. `POST .../crossref/activate` allocates or classifies it on the server. If allocation is needed, the response returns the exact reserved DOI.

Reservation immediately makes that DOI canonical and public. The UI shows it at once as `Reserved`, with copy/open actions, while delivery moves through queued, working, and verifying. Only provider verification changes the label to `Synced`.

An external DOI is shown as bibliographic identity, with `Crossref registration unavailable` and a plain explanation that this library does not manage its prefix. Conflicting DOI sources block activation and link to the conflicting fields.

### Zenodo activation

The inactive row has one `Publish to Zenodo` button. Its compact confirmation dialog contains two radio rows:

- `Use the Crossref DOI` — recommended and preselected when an active or reserved managed Crossref DOI is available. It uses the same DOI and does not mint another DOI. If the DOI is only reserved, Zenodo activation succeeds locally and waits for Crossref verification before contacting Zenodo.
- `Create a Zenodo DOI too` — creates a separate Zenodo version DOI and concept DOI.

If no DOI exists, `Use the Crossref DOI` is disabled with an `Activate Crossref first` action and `Create a Zenodo DOI too` remains available. If an external bibliographic DOI exists, both choices are blocked in this version so the UI cannot create a duplicate DOI. The chosen policy is saved with activation and becomes read-only after the first Zenodo publication.

If no PDF is published, activation still succeeds but the row becomes `Waiting for a PDF`. Its action opens the existing Attachments section; it does not create another upload control.

### Human-facing state copy

| Durable condition | UI label | Main action |
|---|---|---|
| No target | Not activated | Activate |
| Validation or DOI conflict | Fix item details | Open first field |
| Zenodo uses a reserved Crossref DOI | Waiting for Crossref | Open Crossref status |
| Zenodo target has no published file | Waiting for a PDF | Open attachments |
| Job queued | Queued | None |
| Worker lease or Zenodo journal active | Publishing | None |
| Crossref deposit pending | Checking Crossref | None |
| Delayed retry | Retrying automatically | Retry now only when safe |
| Current data needs work but no job exists | Waiting for nightly repair | Retry now |
| Last-success hashes match current record | Synced | Copy/open |
| Dead letter or permanent provider failure | Needs attention | Retry when allowed |

Technical details such as job ID, attempt, environment, and provider message live under `Details`; they are not the main label.

## TDD sequence

1. Add contract tests for every state precedence, capability, link, action, and `shouldPoll` value.
2. Add hook tests for cache seeding, conditional polling, item switching, mutation errors, and duplicate-click prevention.
3. Add component tests for Crossref allocation, existing/external/conflicting DOI, both Zenodo policies, missing PDF, every progress group, field links, retry, copy, and open actions.
4. Add keyboard, focus-return, accessible-name, live-region, and disabled-state tests.
5. Add Playwright flows against the real local stack and deterministic provider fakes, then inspect screenshots and computed styles at desktop/narrow widths in dark and light themes.

## Files touched

- `src/components/admin/AdminInspector.tsx`
- new `src/components/admin/AdminPublicationStatus.tsx`
- new `src/components/admin/AdminPublicationActivation.tsx`
- new `src/components/admin/useAdminPublication.ts`
- `src/components/admin/admin-api.ts`
- `src/components/admin/admin-schema.ts`
- new/updated admin component tests
- new `tests/e2e/admin-publication.spec.ts`
- extend `tests/acceptance/compose.yaml`
- extend `tests/acceptance/fixture/runtime-provider-fake.mjs`
- `playwright.config.ts`
- `docs/admin-item-list.md`

## Migration stance

No hidden legacy controls and no automatic activation on item creation or ordinary item publication. Delete any provisional DOI controls once this section replaces them.

## Exact test plan

```sh
npm run test:unit
npm run test:acceptance
npm run test:acceptance
npx tsc --noEmit
npm run lint
```

Browser verification records:

- computed width, padding, height, alignment, overflow, and spinner/icon dimensions for the section and both confirmation dialogs;
- screenshots for inactive, reserved, transitional, synced, validation-error, waiting-for-file, and failed states;
- keyboard-only completion of both activation paths;
- no layout shift while polling or switching between provider states.

## Deployability/runtime gate

- The full local stack includes the publication worker and deterministic provider fakes.
- Progress survives page reload, browser restart, and worker restart.
- The DOI appears on the public item and in search as soon as reservation commits.
- No browser path can select a production environment or see provider credentials.

## Acceptance criteria

- The controls live in one predictable inspector section.
- An administrator explicitly activates each provider.
- The exact reserved DOI appears immediately and is never called active before verification.
- Crossref prefix and suffix construction never come from the browser.
- Zenodo DOI choice is made once, explained in one sentence, and saved durably.
- Every displayed state comes from the one server read model.
- Users can fix fields, retry eligible failures, and copy/open identifiers.
- The interface is accessible, responsive, visually stable, and checked from computed CSS.

## Pitfalls

- Do not expose provider secrets or raw payloads.
- Do not show a hopeful `Active` state after reservation or HTTP success.
- Do not duplicate the PDF uploader inside DOI publishing.
- Do not mirror publication status into `AdminItemDetail` or React component state.
- Do not copy the existing effect-based writeback polling hook; use SWR.
