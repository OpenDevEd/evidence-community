# Per-record source writeback

Let the admin choose, for each record, which sources receive published changes. Remove the hidden `defaultWriteback` setting.

Grounded: **2026-08-18** against `origin/openscholar` at `a413cede`. Design agreed in the OpenScholar Codex thread of 2026-08-18 (`019feb63-c937-7f10-a4a8-e2e258830d0a`).

## Problem

1. Today a native record is sent to Zotero only because the library config marks one source `sources[].defaultWriteback: true` (`src/config/library-config/schema.ts:1098`). Nothing in `/admin` says this will happen. The “Synced” badge only shows the result.
2. Each record may have only one enabled writeback link (`packages/evidence-library-core/src/schema.ts:399-401`, index `itemSourceLink_one_writeback_per_item`). A record cannot go to two sources.
3. There is no way to stop future updates for one record without editing the library config.
4. Wording says “Zotero”. The runtime is provider-neutral and OpenScholar will render `sources[]` for any provider.

## Fixed decisions

| ID | Decision | Consequence |
|---|---|---|
| D1 | Delete `sources[].defaultWriteback` from the config schema and the `sourceConnection` table. | Clean breaking change. Regenerate artifacts. OpenScholar re-syncs its contract snapshot afterwards. |
| D2 | A record may have any number of enabled writeback links. | Drop `itemSourceLink_one_writeback_per_item`. Keep the (source, sourceRecordKey) unique rule. |
| D3 | Publish opens one dialog: “Publish this record — Also update: [ ] Source…”. It lists every configured source with `writebackEnabled: true`. | Selections are saved on `itemSourceLink.writebackEnabled` inside the publish transaction and are preselected next time. |
| D4 | New native records start with nothing selected. Records imported from a source start with that source selected. | Import behaviour keeps `reserveItemSourceLinks` setting `writebackEnabled = true` for the identity source. |
| D5 | A “Sources” button beside Publish opens the same dialog without publishing. Unchecking a source stops pending and future writeback for that source. It keeps the link and history and never deletes the remote copy. | New API route to change selections without publishing. The worker already supersedes jobs whose link is disabled (`consumer.ts:458`). |
| D5b | Re-checking a source first compares the remote version with the last one we acknowledged. If the source changed while paused, the link enters a new `conflict` state and nothing is sent. The status popover then offers two clearly described choices: “Send this record to {source}” (overwrite the source) or “Load {source}’s version” (overwrite this record). | New status state, two new actions, one new route. Today a 412 conflict silently reloads and re-sends local (`zotero/adapter.ts:69-76`); that stays for ordinary in-flight conflicts only. |
| D6 | Attachments and notes inherit the parent record’s selection. | Child link creation reads the parent’s enabled links, not the request. |
| D7 | Wording is provider-neutral: “Sources”, source labels, “Also update”. Never “Zotero” in generic UI. | Provider name may appear inside a source label only. |
| D8 | Batch publish uses each record’s stored selection. No dialog. | `item-batch-service.ts` passes no `sourceKeys`. |
| D9 | The dialog is not a conflict tool. Conflict, retry and “Needs review” stay in the worker and the existing status popover. | No version checks or merge controls in the dialog. |
| D10 | Collections are unchanged. A source collection is created inside one chosen source and writes back to that source from creation (`collection-mutation-service.ts:113-143,222-227`). Native collections are library-local and never write back (`docs/source-ingestion-contract.md:93-94`). `defaultWriteback` is not used for collections. | No collection dialog, no collection index change, `collectionSourceLink` and `resolveCollectionWritebackPolicy` stay as they are. |
| D11 | Every source list marks which source is the record’s **origin** (its identity source). Origin is preselected for imported records and may still be unchecked. | `WritebackTarget.isOrigin` from the existing identity lookup (`policy.ts:132,185`); the dialog shows an “Origin” tag. |
| D12 | Outbound PDFs stay a `linked_url` attachment pointing at the library’s public file. No Zotero file upload in this plan set. | Unchanged from today (`verifyLiveZoteroWriteback.ts:431`). |
| D13 | Publish opens the dialog every time (preselected). It is skipped only when the library has no writeback-capable source. Restore-and-publish uses it too. | One extra click per publish is the price of visible writeback. |
| D14 | Unpublish opens the same dialog in “Also remove from” mode, preselected to the current selection. Unchecked sources keep their remote copy and stay selected. Today unpublish sends a remote delete to the single target (`docs/source-ingestion-contract.md:100-103`). | Delete jobs go only to the checked sources. |
| D15 | The Sources button is always shown, including on never-published drafts. Adding a source to a published record enqueues a writeback of the current canonical revision at once. On a draft nothing is sent until publish. | “Checked but never sent” must not exist for published records. |
| D16 | Sources turned off in library settings (`writebackEnabled: false`) are shown disabled with “Turned off in library settings” only when the record already links to them; otherwise they are hidden. | Explains silence without cluttering the list. |
| D17 | Batch publish and batch remove use each record’s stored selection with no dialog. Batch remove deletes at every selected source. | Mirrors D8; the stored selection is the standing instruction. |
| D18 | A key collision at a source stays a per-source `failed` with the message “{source} already has a different item with key {key}. Delete that item in {source}, then retry.” No pre-check, no auto-link. | Existing `ZoteroWritebackKeyCollisionError` (`zotero/adapter.ts:33`) plus wording. |
| D19 | Plan 04 creates a **new** isolated library instead of redeploying an existing one: `OpenScholar Evidence Library Writeback E2E` at `https://docs-openscholar-writeback-e2e.opendev.space`, new Compose app in the OpenScholar Coolify `development` environment, new restricted database via `npm run database:provision`, new private/public buckets, own private Meilisearch, a new Zotero group (ID supplied by the user) using the existing Zotero API key. The two existing development libraries stay on their current commit. | Outline EL page records the new library and warns that the old two must drop `defaultWriteback` from config before any redeploy; the OpenScholar page gets a one-line next item. |
| D20 | After Plan 04, OpenScholar re-syncs its contract snapshot once and re-binds its development Evidence Library to the new runtime. | Written in `HANDOFF.md`. |

## Plan

1. `01-config-and-link-model.md` — remove `defaultWriteback`, allow many enabled links per record, replace the single-target item policy with a per-source list with origin marking, migration 0035.
2. `02-publish-dialog-and-sources-api.md` — publish and unpublish requests carry `sourceKeys`, new sources route, the dialog in publish/unpublish/manage modes, per-source status, browser tests.
3. `03-conflict-choice.md` — the `conflict` state on re-check and the two-way “send mine / load theirs” choice.
4. `04-live-proof-and-docs.md` — real Zotero round trip through `/admin`, update tools and docs, create and deploy the new isolated library.

Order is strict: 01 → 02 → 03 → 04. Plan 04 also tells the OpenScholar repository what to re-sync.

## Dependencies

- Plan 01 breaks compile of every tool and test that names `defaultWriteback`. Plan 01 must fix them all before it commits.
- Plan 02 needs the list policy from Plan 01.
- Plan 03 needs the sources route from Plan 02 and the source-sync import path (`src/lib/source-ingestion/`) to load a remote version.
- Plan 04 needs a pushed commit, the new Zotero group ID from the user, and Coolify access to the OpenScholar `development` environment.

## Existing code to reuse

- Policy: `src/lib/source-writeback/policy.ts` — keep `configuredWritebackSourceKeys`, `isSourceWritebackEnabled`, `evaluateSourceWritebackPolicy`, `resolveCollectionWritebackPolicy`; turn `resolveItemWritebackPolicy` into a list with `isOrigin`.
- Conflict: `src/lib/admin/source-writeback-contract.ts` state enum (no conflict state today), `AdminSourceWritebackStatus.tsx` popover with the existing “Retry writeback” action, `zotero/adapter.ts:69-76` (412 handling), `itemSourceLink.lastAcknowledgedRemoteVersion`.
- Queue: `src/lib/source-writeback/queue.ts:209-277` `markItemWritebackDirty` already enqueues one job per enabled link. Replace `ensureDefaultWritebackLink` (283-340) with `ensureItemWritebackLinks`.
- Consumer: `src/lib/source-writeback/consumer.ts:425-605` — supersede-on-disabled and parent-first per source already exist. Do not rewrite.
- Mapper: `src/lib/source-writeback/zotero/mapper.ts:203-217` — the record key is the remote key for every source. Keep.
- Import: `src/db/record-identity.ts:181-231` `reserveItemSourceLinks` — drop the NOT EXISTS guard that exists only because of the one-link index.
- Publish: `src/lib/admin/native-item-service.ts:696-1020` `publishItemDraftWithContext`; route `src/app/api/admin/items/[key]/publish/route.ts`.
- Status: `src/lib/admin/source-writeback-service.ts`, `src/lib/admin/source-writeback-contract.ts`, `src/components/admin/AdminSourceWritebackStatus.tsx`, `useAdminSourceWriteback.ts`.
- UI kit: `src/components/nextui/DialogModal.tsx` (already used in `AdminInspector.tsx:1089-1126`), `Checkbox.tsx`, `CheckboxGroup.tsx`, `Button.tsx`, `Tooltip.tsx`. There is no shadcn `src/components/ui`.
- Detail: `src/lib/admin/library-query-service.ts:251-386` `getAdminItemDetail`; types `src/lib/admin/types.ts:94-112`.

## Migration choice

Clean breaking change. Migration `drizzle/0035_per-record-source-writeback.sql` drops `sourceConnection.defaultWriteback`, its check and index, and drops `itemSourceLink_one_writeback_per_item`. `collectionSourceLink` is untouched. Plan 03 adds a small follow-up migration only if the conflict state needs a column (prefer deriving it from `remoteVersion` vs `lastAcknowledgedRemoteVersion` plus a job status). No backfill, no compatibility read. Development databases may be reset if needed. Do not run on a production tenant without a separate decision.

## Test rules

- Test-first for pure logic: policy list, config schema, link ensure/update helpers, dialog state helper.
- Test behaviour, not classes: roles, labels, `data-admin-*` values, database rows, API responses, real Zotero state.
- Browser tests must open the dialog through the real Publish button and check `[data-admin-writeback-status]` per source.
- Every plan names its exact commands. Nothing is done until they pass.

## Agent use

- One agent per numbered plan.
- Delegate large greps and tool/test updates that name `defaultWriteback`; keep schema, policy, service and UI edits in the main session.
- Any agent that edits `src/`, `packages/` or `drizzle/` must finish with `npm run lint`, `npx tsc --noEmit`, `npm run schema:check` and `npm run test:unit`, and report the exact result.

## Sources

- `AGENTS.md`
- OpenScholar Codex thread `019feb63-c937-7f10-a4a8-e2e258830d0a`, messages 2026-08-18 08:03–08:32.
- Grilling session of 2026-08-18 (D13–D20) and earlier user answers (D5b, D10, D11, D12): re-check conflicts offer a two-way choice; any source incl. origin may be unchecked but origin is marked; collections already write back to their own source, so they stay unchanged; PDFs stay linked URLs.
- `docs/source-writeback.md`, `docs/source-ingestion-contract.md`, `docs/zotero-source-adapter.md`, `docs/evidence-library-operations.md`
- Zotero write requests (predefined keys): https://www.zotero.org/support/dev/web_api/v3/write_requests
- Outline “04 — Evidence Library Current State” (`eGg2HF18MC`)
- OpenScholar `plans/evidence-library-configuration-interface/05-discovery-and-platform-editors.md` (renders `sources[]`; must be updated after this lands)
