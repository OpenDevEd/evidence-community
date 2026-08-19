# Plan 03 — Links section in the record editor

## Goal

An editor can search for a record, add it under "Cites" or "Related", remove it, see what changed since the last publish, revert, and see read-only "Cited by" and "Related to this record" lists.

## Scope and design

**Where.** A new "Links" card in `AdminInspector.tsx` between the tags card (`:1948-1957`) and the collections card (`:1960-1995`), wired through the same draft/diff plumbing (`:1536`) as tags and collections.

**Components** (all in `src/components/admin/`):

- `AdminLinksEditor.tsx` — renders two editable lists (`Cites`, `Related`) and two read-only lists (`Cited by`, `Related to this record`). Each editable row: title, item type, key, origin badge (`Manual` or the source label — never the word "Zotero" in generic UI, per `plans/per-record-source-writeback` D7), a remove button with `aria-label="Remove <title> from Cites"`, and a change marker `data-admin-link-change="added" | "removed" | "unchanged"`. Removed rows stay visible with the marker until publish. A "Revert links" button clears the `links` field from the draft. Rows carry `data-admin-link-kind`, `data-admin-link-key`, `data-admin-link-origin`.
- **No separate picker dialog** (revised 2026-08-19 after review: the record table on the same page is the picker, like collections). "Add to Cites/Related" turns the workbench into *pick mode*: `AdminWorkbench` keeps `linkPick {forKey, kind}`, shows a banner above the table (`data-admin-link-pick-banner`) with "Add N checked" and "Done", intercepts the table's `onSelect` so a row click/keyboard activation adds the record instead of opening it, and Escape ends the mode. The open record stays pinned in the inspector while picking and until another row is chosen (`resolveAdminSelection(..., { pinned })`), so searching the list to find a target never swaps the draft away. Picked rows get titles from the table rows (`linkTargets`).
- Source-origin rows are shown in the editable lists but cannot be removed (button disabled with tooltip "Comes from <source label>. Remove it there."). Manual rows can be removed.

**Errors.** `firstAdminFieldError(errors, "links")` shows publish-time validation messages ("Record ABCD1234 no longer exists") under the section, same pattern as tags (`:859`).

**Save.** Adding or removing calls the existing draft save path with `payload.links` (Plan 02). No new API route.

## Test-first steps

1. Failing unit tests (`tests/unit/admin-links-editor.test.tsx`) for `AdminLinksEditor`: renders four lists with headings; added/removed markers computed from `links` vs `publishedLinks`; remove button disabled for `source:` rows; revert calls the handler with `links` removed; read-only lists have no buttons.
2. Failing unit tests: the editor hands picking to the table (`onStartPick`/`onStopPick`, "Done picking" state) instead of opening a dialog; `resolveAdminSelection` keeps a pinned record.
3. Implement both components and wire the card.
4. Real-stack browser test `tests/e2e/admin-links.spec.ts` (project `chromium`, gated on `PLAYWRIGHT_RUNTIME_E2E=true` like `admin-runtime.spec.ts`; the `mobile-chromium` project only runs the public mobile spec in this repo): create two records → Links → search the second → add under Cites → marker `added` → publish → marker `unchanged` → open the second record → "Cited by" lists the first and has no buttons → public `/api/item/<key>` lists it → remove → Revert restores → remove → publish → gone. Registered in `tools/runRuntimeAcceptance.ts` admin suite.
5. Public browser check in the same run: the first record's public page shows "Cites" with the second record; the second shows "Cited by".

## Files

- `src/components/admin/AdminInspector.tsx`
- `src/components/admin/AdminLinksEditor.tsx` (new), `AdminWorkbench.tsx` (pick mode), `AdminItemTable.tsx` (`banner` slot), `useAdminItemList.ts` + `src/lib/admin/selection.ts` (pinned selection)
- `src/components/admin/admin-api.ts` (only if a lighter list call is needed)
- `tests/unit/admin-links-editor.test.tsx`, `tests/unit/admin-selection.test.ts`
- `tests/e2e/admin-links.spec.ts` (new), `tools/runRuntimeAcceptance.ts`
- i18n: new `admin` keys for headings, buttons and hints in all nine `src/messages/*.json` files.

## Migration choice

None.

## Exact tests

```sh
npx vitest run tests/unit/admin-links-editor.test.tsx tests/unit/admin-selection.test.ts
npm run test:unit
npm run test:e2e
npm run test:acceptance
npx tsc --noEmit
npm run lint
```

## Runtime check

Local stack with the acceptance fixtures. Walk the browser scenario by hand once on desktop and once on the mobile layout. Check the axe pass that the acceptance run already includes.

## Completion rules

- Links can be added, removed, reverted and published from `/admin` without a page reload.
- Source rows are visible and locked; manual rows are editable.
- The real-stack browser test passes in the `chromium` project (the only project that runs admin specs).
- No effect-based state syncing was added; picker and list state come from props, draft state and event handlers.

## Risks

- The admin list endpoint returns full rows with requested columns; request only `title`, `itemType`, `key` to keep the picker fast.
- The inspector is large; keep the new card in its own component to avoid re-render regressions.
- Message parity across nine locales must be complete or the build fails the messages check.
