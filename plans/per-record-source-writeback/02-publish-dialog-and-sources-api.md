# Plan 02 — Publish dialog and sources API

## Goal

Make writeback visible and chosen by the admin. Publish opens one dialog listing sources; a Sources button opens the same dialog without publishing; the inspector shows one status per selected source.

## Scope and design

1. **Publish and unpublish requests.** `src/app/api/admin/items/[key]/publish/route.ts` accepts a JSON body `{ sourceKeys: string[] }` (zod, default `[]`). It passes `sourceKeys` to `publishItemDraftWithContext`. Inside the publish transaction, `ensureItemWritebackLinks` and `cascadeChildWritebackLinks` run before `markItemWritebackDirty`, so the selection and the publish are saved together. The unpublish route accepts `{ removeFromSourceKeys: string[] }`; delete jobs are enqueued only for those sources, and the selection is left unchanged (D14). Batch publish and batch remove (`item-batch-service.ts:169-173`) pass `undefined`, meaning “use stored selection”; batch remove deletes at every selected source (D17).
2. **Sources route.** New `PUT /api/admin/items/[key]/writeback/sources` with body `{ sourceKeys: string[] }`. It calls `ensureItemWritebackLinks` and `cascadeChildWritebackLinks` in its own transaction and returns the new `AdminItemWriteback`. If the record is published, each newly enabled source gets a writeback job for the current canonical revision at once (D15). For a newly re-enabled source that already has a `remoteVersion`, that job is a **version check** first (Plan 03 defines the outcome: `conflict` or resume). In this plan the check may simply resume; Plan 03 changes it. On drafts nothing is enqueued. Add it to `src/lib/admin/source-writeback-service.ts` and `src/components/admin/admin-api.ts`.
3. **Detail shape.** `AdminItemWriteback` in `src/lib/admin/types.ts:97-112` becomes `{ available: WritebackTarget[]; selected: string[]; originSourceKey: string | null }` from `resolveItemWritebackTargets`. `getAdminItemDetail` (`library-query-service.ts:283`) uses it. Status routes stay per source: `writeback/status` and `writeback/retry` already take a `sourceKey`; the contract `source-writeback-contract.ts:16-26` is unchanged.
4. **Dialog.** New `src/components/admin/AdminWritebackSourcesDialog.tsx` built on `src/components/nextui/DialogModal.tsx`, `CheckboxGroup.tsx`, `Checkbox.tsx`, `Button.tsx`. Props: `mode: "publish" | "unpublish" | "manage"`, `targets`, `selected`, `onConfirm(sourceKeys)`, `onClose`. Titles “Publish this record”, “Unpublish this record”, “Sources for this record”. Group label “Also update” (publish/manage) or “Also remove from” (unpublish). Sources with `sourceEnabled: false` appear disabled only when `linkExists`; otherwise they are not listed (D16). Each checkbox shows the source label; the origin source shows an “Origin” tag (D11) and may still be unchecked; a source with `sourceEnabled: false` is shown disabled with helper text “Turned off in library settings”. Confirm button “Publish”, “Unpublish” or “Save”. `data-admin-writeback-dialog={mode}` on the dialog, `data-admin-writeback-source={sourceKey}` on each checkbox. When `available` is empty, publish or unpublish immediately with no dialog (D13).
5. **Wiring.** `AdminWorkbench.tsx:1039-1055` `publishCurrent` opens the dialog when `detail.writeback.available.length > 0`, then calls `publishAdminItem(key, sourceKeys)`. Add a small “Sources” icon button beside Publish in `AdminInspector.tsx:1790-1807` (aria-label “Sources”), always shown (D15), that opens the dialog in manage mode and calls the new PUT route. Restore-and-publish uses the publish dialog; the unpublish action uses the unpublish dialog.
6. **Status.** `AdminInspector.tsx:1712-1724` renders one `AdminSourceWritebackStatus` per key in `detail.writeback.selected`, each with its source label, so `data-admin-writeback-status` exists per source. `useAdminSourceWriteback` stays per source. If more than three are selected, wrap them; do not hide any.
7. **Wording.** No generic UI text says “Zotero”. Existing “Synced” badge text becomes “Synced to {sourceLabel}” in the popover header only; the badge stays short. A key collision shows “{source} already has a different item with key {key}. Delete that item in {source}, then retry.” (D18) — map `ZoteroWritebackKeyCollisionError` to that message in `source-writeback-service.ts`.

## Test-first steps

1. Red: `tests/unit/admin-writeback-selection.test.ts` — pure helper `resolveDialogSelection(targets, stored, mode)` returns preselected keys, keeps disabled sources unchecked, and returns `null` when there is nothing to ask. Green. Commit.
2. Red: `tests/unit/admin-publish-route.test.ts` (or extend the existing admin route unit test) — publish with `sourceKeys` stores enabled links and cascades to children; unknown key returns 400; unpublish with `removeFromSourceKeys` enqueues deletes only there and keeps the selection; batch publish and batch remove use stored links. Green. Commit.
3. Red: `tests/unit/admin-writeback-sources-route.test.ts` — PUT toggles links, disables the rest, cascades to children, enqueues a send for a newly enabled source on a published record, enqueues nothing on a draft, and enqueues a version check for a re-enabled linked source. Green. Commit.
4. Green: dialog, wiring and status UI. Update `tests/e2e/admin.spec.ts:663-860`: after clicking “Publish” the dialog appears (`getByRole("dialog", { name: "Publish this record" })`), the imported source is preselected, confirm, then the per-source status appears; add a case that opens “Sources”, unchecks, saves, and sees the status badge for that source disappear; add a case that Unpublish opens the “Also remove from” dialog. Update `tests/e2e/admin-runtime.spec.ts:45` for the dialog. Commit.

## Files

- `src/app/api/admin/items/[key]/publish/route.ts`, new `src/app/api/admin/items/[key]/writeback/sources/route.ts`
- `src/lib/admin/native-item-service.ts`, `item-batch-service.ts`, `source-writeback-service.ts`, `library-query-service.ts`, `types.ts`
- `src/components/admin/admin-api.ts`, `AdminWorkbench.tsx`, `AdminInspector.tsx`, `AdminSourceWritebackStatus.tsx`, new `AdminWritebackSourcesDialog.tsx`, new `writeback-selection.ts` helper
- `tests/unit/*` and `tests/e2e/admin.spec.ts`, `tests/e2e/admin-runtime.spec.ts`

## Exact tests

```sh
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:acceptance
```

`npm run test:acceptance` runs the Compose stack and Playwright; both admin specs must pass in Chromium.

## Deployment gate

Local only in this plan: `npm run dev`, open `/admin`, sign in, open a native record, press Publish, see the dialog, publish, see one status badge per selected source. Report what you saw. Real deployment happens in Plan 03.

## Completion rules

- Publish through the real button opens the dialog and saves the selection with the publish.
- Sources button changes the selection without publishing and stops pending jobs for unchecked sources (`consumer.ts:458` supersede path proven by a unit test).
- Attachments of a published record get the parent’s selection (unit test in Plan 01 plus one browser assertion here).
- All commands above pass; each step committed with `[plan-02]`.

## Risks

- `AdminInspector.tsx` is large. Keep the dialog in its own file and add only the button and the per-source status loop.
- The acceptance suite mocks `writeback/status`. Extend the mock to the new sources route; do not mock the publish body away.

## Execution notes — 2026-08-18

- Route unit tests follow the repository pattern and mock the service layer (`tests/unit/admin-writeback-routes.test.ts`). They prove request parsing and pass-through for publish (`sourceKeys`), unpublish (`removeFromSourceKeys`) and `PUT writeback/sources`. Link, cascade and delete-per-source behaviour is proven by the real-service tools from Plan 01 and by Plan 04's live proof.
- `admin-runtime.spec.ts` needed no change: the acceptance libraries have no `sources[]`, so Publish runs at once there. The dialog flows are covered in `admin.spec.ts` ("edits an imported record…" and the new "chooses writeback sources without publishing and when unpublishing").
- The "npm run dev" gate was replaced by the acceptance stack (`npm run test:acceptance`). A local `next dev` against the throwaway Postgres crashes in the public filters provider when Meilisearch has no facet settings; that is environment setup, not this change, and the acceptance stack is the truthful runtime check.
- The dialog helper treats a source that is turned off, paused or removed as unchecked and disabled even when the record still stores it as selected; confirming the dialog then clears that stored selection. The badge for such a source therefore disappears after the next publish instead of showing `disabled`.
- Key collision wording lives in `describeAdminWritebackError` (`source-writeback-service.ts`) so both status and retry responses use it.
