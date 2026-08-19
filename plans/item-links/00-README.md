# Item links: "cites" and "related" between library records

Let an editor say "this record cites that record" or "these two records are related", keep those links safe from source resyncs, show them on the public item page, and send "related" back to Zotero.

Grounded: **2026-08-18** against `origin/openscholar` at `a413cede`. Design agreed in the OpenScholar Claude thread of 2026-08-18 (grill session). GitHub issues: `OpenDevEd/new-el#98` (model + drafts) and `#99` (editor + display), milestone EL-05.

## Problem

1. There is no way to create or edit a link between two records. The old library faked "cites" with collections. The new one has nothing.
2. Today "Cites", "Cited by" and "Related resources" are read from the record's free-form `relations` JSON (`src/types/item.ts`, `src/components/features/newlib/Relations.tsx:20-49`). "Cited by" is a copy on the other record, so the two sides drift.
3. A Zotero resync overwrites the whole `relations` column (`src/lib/source-ingestion/transactional-writer.ts:197-200`, `:424-437`), so anything typed by hand would be lost.
4. `/api/citations/[key]` guesses the count as `max(citedBy.length, cited_by)` (`src/app/api/citations/[key]/route.ts:148-156`).

## Fixed decisions

| ID | Decision | Consequence |
|---|---|---|
| D1 | One new table `itemLink(fromKey, toKey, kind, origin, createdAt, updatedAt)`. `kind` is `cites` or `related`. `origin` is `manual` or `source:<sourceConnectionKey>`. PK `(fromKey, toKey, kind, origin)` — one row per owner, readers de-duplicate the logical link — check `fromKey <> toKey`, index `(toKey, kind)`, cascade FKs to `item.key`. (Revised 2026-08-19 after PR review: the origin-less key made a manual link clash with a source row and let two sources overwrite each other.) | Same style as `itemToCollection` plus a check like `sourceWritebackJob`. |
| D2 | In-library links only. Both ends are records in this library. | No external DOI/OpenAlex targets. Unresolvable Zotero relations are skipped, not stored. |
| D3 | Rows are stored directed, but only `cites` *means* direction. "Cited by" is a reverse query and is never copied onto the other record. `related` is one symmetric link: either side shows it, either side can remove the manual row, whichever record it was stored on (revised 2026-08-19 after user feedback: "Related" and "Related to this record" were the same link shown twice). | Public tabs, admin lists and the draft `links.related` set read both directions. |
| D4 | Manual rows belong to the editor. Source rows belong to the source. A sync never changes a manual row. A sync mirrors its own rows: gone in the source → deleted here. | Origin rule in both directions. |
| D5 | Delete `cites` and `citedBy` from the `relations` JSON and the validator. Keep `cited_by`, `referenced_works`, `owl:sameAs` as read-only provider data. Statistics queries stay untouched. | Clean breaking change. OpenAlex is out of scope. |
| D6 | Zotero is the only source in scope. Ingest resolves `dc:relation` URIs to library keys and writes `related` rows with `origin = source:<key>`. | Uses the existing `sourceRecordKey → item.key` identity map. |
| D7 | Zotero writeback re-emits `dc:relation` for `related` rows (manual and source) when both records are linked to that Zotero source. `cites` is never written back. | Goes through the per-source enabled links from `plans/per-record-source-writeback/` (D3, D11 there). Zotero has no citation predicate. |
| D8 | A record's draft holds a `links` pseudo-field `{ cites: string[], related: string[] }` next to `collections` and `tags`. `cites` is outgoing; `related` is the full manual related set in both directions. Revert = drop the field. | No second draft table. Only "Cited by" is a read-only list in the editor. |
| D9 | Publish writes the link rows inside the existing publish transaction and adds outbox rows for both ends of every changed link. Cache tags for both records are cleared through the existing receipt flow. | "Cited by" on the other record updates. |
| D10 | Unpublish keeps the rows and hides them in public reads (`deleted = 1`). Restore shows them again. Hard delete cascades. | Restore is "republish" in this codebase. |
| D11 | Editor: one "Links" section with two editable lists ("Cites", "Related") and one read-only list ("Cited by"). Records are picked from the record table on the same page: pick mode turns the table checkboxes into the link list for that kind (tick = add, untick = remove), a row click also adds; no separate dialog (revised 2026-08-19). Provider-neutral wording. | Workbench pick mode; no `AdminItemPicker`. |
| D12 | Public item page keeps three tabs. "Related resources" = `related` rows in both directions plus `owl:sameAs`. A tab with count 0 is hidden unless it is the only tab. | `Relations.tsx` reads link data, not `relations.cites`. |
| D13 | Branch `codex/item-links` off `origin/openscholar`. Never touch `codex/per-record-source-writeback`. Plan 04 starts after that branch merges to `openscholar`. | Only the writeback slice depends on it. |
| D14 | Migration runs on a fresh local database only. Hosted libraries are not touched. What they need is written on the Outline Evidence Library page after the push. | See "Migration choice". |

## Plan

1. `01-model-migration-and-ingest.md` — table, migration, validator cleanup, `dc:relation` resolution on sync, unresolved counter.
2. `02-draft-publish-and-read-path.md` — `links` pseudo-field, publish transaction, outbox for both ends, link read service, `/api/citations/[key]`, public tabs.
3. `03-editor-ui.md` — Links section, record picker, added/removed markers, browser tests.
4. `04-related-writeback-live-proof-and-docs.md` — `dc:relation` writeback, live Zotero round trip, docs and Outline.

Order is strict: 01 → 02 → 03 → 04. Plan 04 waits for `plans/per-record-source-writeback/` to merge.

## Dependencies

- Plan 02 needs the table and the link read helpers from Plan 01.
- Plan 03 needs the draft field, publish path and admin detail shape from Plan 02.
- Plan 04 needs the per-source enabled writeback links (`ensureItemWritebackLinks`, list policy) that exist only on `codex/per-record-source-writeback` today.

## Existing code to reuse

- Link tables: `src/db/schema/tables/itemToCollection.ts:5-23`, `itemToTag.ts:6-23`; check constraints in `packages/evidence-library-core/src/schema.ts:484-611`.
- Draft: `src/lib/admin/item-draft-patch.ts:12-62` (pseudo-fields `collections`, `tags`), `item-draft-merge.ts:33-78`, validation `native-item-validation.ts:92-115, 410-441`.
- Publish: `src/lib/admin/native-item-service.ts:696-1020` (`publishItemDraftWithContext`; tags 902-914, collections 918-927, outbox 930-966, writeback dirty 968-1000), `openItemDraftInTransaction` 467, `saveItemDraftInTransaction` 539.
- Admin detail: `src/lib/admin/library-query-service.ts:252-390`, types `src/lib/admin/types.ts:80-95`.
- Ingest: `src/lib/source-ingestion/transactional-writer.ts:307-355` (`loadIdentityMap`), `1288-1345` (tag/collection replacement), Zotero mapper `src/lib/source-ingestion/zotero/mapper.ts:180-244`, sync result `zotero/sync.ts:885-890`, run result persistence `orchestrator.ts:299-347`.
- Writeback mapper: `src/lib/source-writeback/zotero/mapper.ts:110-155, 205-247`; consumer key mapping `src/lib/source-writeback/consumer.ts:524, 580, 601`.
- Public: `Relations.tsx`, `ItemPage.tsx:1255-1290`, `src/app/api/citations/[key]/route.ts`, `src/app/api/items/batch/route.ts:42-104`, cache tags `src/lib/admin/cache.ts:9-25`, `src/lib/citations.ts:151-175`.
- Admin UI: `src/components/admin/AdminInspector.tsx:845-930` (TagsEditor), `940-1115` (collections editor), `AdminCollectionPicker.tsx`, `admin-api.ts:181-189` (`getAdminItems` → `GET /api/admin/items?search=`), UI kit `src/components/nextui/`.
- Browser tests: `tests/e2e/admin.spec.ts`, helpers `admin-login.ts`; Playwright projects `chromium` and `mobile-chromium` only (`playwright.config.ts:25-35`). There is no WebKit project.
- Live Zotero: `tools/verifyLiveZoteroWriteback.ts` (`npm run test:zotero-writeback-live`), `tools/seedZoteroPlayground.ts`.

## Migration choice

Clean breaking change. One migration `drizzle/0035_item-links.sql` (generated with `npx drizzle-kit generate`) that creates `itemLink` and runs `UPDATE item SET relations = relations - 'cites' - 'citedBy' WHERE relations ?| array['cites','citedBy']`. No backfill from JSON arrays into the table: those arrays came from an old collection hack, and Zotero `related` rows are rebuilt by the next sync.

If `codex/per-record-source-writeback` (migrations 0035, 0036) merges to `openscholar` first, regenerate this migration as 0037 before merging. Never keep two journal entries with the same index.

Run only on a fresh local database (`npm run database:provision` against a new local database name, then `npm run db:migrate`). Do not run on the two existing development libraries or any hosted tenant. Plan 04 writes the hosted steps on the Outline Evidence Library page.

## Test rules

- Test-first for pure logic: URI parsing, link validation, draft merge, writeback relation mapping.
- Real local PostgreSQL through the `tools/verify*.ts` style for the publish transaction, cascade, unpublish/restore and sync mirroring.
- Behaviour only: roles, labels, `data-admin-*` values, database rows, API responses, real Zotero state. No class-name tests.
- Admin browser tests run in the existing `chromium` project (the `mobile-chromium` project only runs the public mobile spec).

## Agent use

Use `Explore` for caller maps and `general-purpose` for isolated modules after the contract is clear. Keep the test-first loop, commits and plan edits in the main session. Any agent that changes code must run the exact tests named in the plan it works on.

## Sources

- Issues `OpenDevEd/new-el#98`, `#99`.
- Codex thread 2026-08-16 (`~/.codex/sessions/2026/08/05/rollout-2026-08-05T13-15-49-019fd1d9-f45e-7ff2-91df-dec417405735.jsonl`) where the gap was first named.
- `plans/per-record-source-writeback/00-README.md` D1–D20 (per-source writeback links, origin marking, provider-neutral wording).
- `docs/source-ingestion-contract.md:165-217`, `docs/source-writeback.md`, `docs/search-indexing.md`.
