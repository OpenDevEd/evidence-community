# Execution prompts

One prompt per plan. Run them in order on branch `codex/item-links` (worktree `~/Documents/Github/new-el-item-links`). Never work on `codex/per-record-source-writeback`.

## Plan 01

```text
Implement plans/item-links/01-model-migration-and-ingest.md after reading plans/item-links/00-README.md. Estimate 4 to 6 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse itemToCollection/itemToTag for the table style, loadIdentityMap for key resolution, the existing tag/collection replacement block in transactional-writer.ts for placement, and tools/verifySourceModel.ts for the real-database verifier style.
2. Delete cites and citedBy from the relations JSON type, validator, and fixtures. No compatibility reads.
3. Red, green, clean up for parseZoteroItemUri and the validator. Real PostgreSQL coverage for the table and the sync mirroring in the same change.
4. Read docs/source-ingestion-contract.md lines 165-217 and the Zotero API docs for item URIs before writing the parser.
5. Do not delegate or run a reviewer unless the user asks.
6. Migration runs only on a fresh local database. Do not touch the two development libraries or any hosted tenant.
7. Do not commit files from any other plan folder or branch.

EXECUTION RHYTHM
Write the failing URI parser tests, implement, commit. Write the failing validator tests, implement, commit. Add the table, generate migration 0035, run schema:check, commit. Write tools/verifyItemLinks.ts red, implement item-links.ts, commit. Extend verifySourceIngestionWriter.ts red, implement the writer step and the unresolvedRelations counter, commit. Update the contract doc, commit.

COMMIT DISCIPLINE
Use allowed prefixes and add [plan-01] to every commit. Never bypass hooks. Do not commit failing tests. Stage named files.

WHEN TO STOP
Stop only for a missing required API, an unsafe target, or a plan error that cannot be corrected from evidence. Do not stop for an answer already in the plan. All tests in "Exact tests" must be green and the runtime check done.

DEVIATIONS
Commit safe work, revise the plan in Git with docs: [plan-01] revise <section> — <reason>, then continue. Write plans/item-links/01-BLOCKER.md only when no safe path exists.

START NOW
Read AGENTS.md, the README, and Plan 01. Check git status and branch. Add the first failing parser test.

Go.
```

## Plan 02

```text
Implement plans/item-links/02-draft-publish-and-read-path.md after reading plans/item-links/00-README.md and 01-model-migration-and-ingest.md (already merged into this branch). Estimate 6 to 8 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse the collections/tags pseudo-field path in item-draft-patch.ts and native-item-validation.ts, the publish transaction in native-item-service.ts (tags 902-914, collections 918-927, outbox 930-966, advanceOpenItemDraftBaseRevision 70), getAdminItemDetail, getPublicItemLinks from Plan 01, and /api/items/batch for cards.
2. Delete extractCitesKeys/extractCitedByKeys and the cited_by fallback in /api/citations/[key]. Nothing may read relations.cites or relations.citedBy afterwards.
3. Red, green, clean up for validation, patch, and Relations.tsx. Real PostgreSQL coverage for publish, outbox and cascade in tools/verifyItemLinks.ts.
4. Read node_modules/next/dist/docs on caching before touching the item page loader; keep getPublicItemLinks inside the item-<key> cached scope.
5. Do not delegate or run a reviewer unless the user asks.
6. Do not add links to writeback dirty fields; Plan 04 owns that.
7. Do not commit files from any other plan folder or branch.

EXECUTION RHYTHM
Validation tests red → green, commit. Draft patch tests red → green, commit. Publish transaction verifier red → implement rows + outbox + indexingRecords → green, commit. Admin detail shape, commit. Relations.tsx tests red → green, commit. Citations route, commit. Runtime check on the local stack, then final gate.

COMMIT DISCIPLINE
Allowed prefixes, [plan-02] on every commit, no hook bypass, no failing tests, named files only.

WHEN TO STOP
Stop only for a missing required API, an unsafe target, or a plan error that cannot be corrected from evidence. All "Exact tests" green and the runtime check done.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-02] revise <section> — <reason>, continue. Blocker file only when no safe path exists.

START NOW
Read AGENTS.md, the README, Plans 01 and 02. Check git status and branch. Add the first failing validation test.

Go.
```

## Plan 03

```text
Implement plans/item-links/03-editor-ui.md after reading plans/item-links/00-README.md and 02-draft-publish-and-read-path.md. Estimate 6 to 8 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse AdminInspector's tags and collections cards, AdminCollectionPicker.tsx, DialogModal/Checkbox/Button from src/components/nextui, getAdminItems from admin-api.ts, and the existing draft save path. No new API route.
2. No useEffect for state syncing. Picker and list state come from props, draft state and handlers.
3. Red, green, clean up for AdminLinksEditor and AdminItemPicker with react-dom + act (no Testing Library in this repo). Real-stack browser test in tests/e2e/admin-links.spec.ts (chromium project, gated on PLAYWRIGHT_RUNTIME_E2E). There is no WebKit project; mobile-chromium only runs the public mobile spec.
4. Test roles, labels, visible text and data-admin-* values only. Never class names.
5. Do not delegate or run a reviewer unless the user asks.
6. Wording is provider-neutral: source label, never "Zotero" in generic UI.
7. Add every new message key to all nine src/messages/*.json files.

EXECUTION RHYTHM
Editor unit tests red → green, commit. Picker unit tests red → green, commit. Wire the card in AdminInspector, commit. Browser test red → green, commit. Manual walk on desktop and mobile layout, then final gate.

COMMIT DISCIPLINE
Allowed prefixes, [plan-03] on every commit, no hook bypass, no failing tests, named files only.

WHEN TO STOP
Stop only for a missing required API, an unsafe target, or a plan error that cannot be corrected from evidence. All "Exact tests" green including npm run test:e2e and npm run test:acceptance.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-03] revise <section> — <reason>, continue. Blocker file only when no safe path exists.

START NOW
Read AGENTS.md, the README, Plans 02 and 03. Check git status and branch. Add the first failing AdminLinksEditor test.

Go.
```

## Plan 04

```text
Implement plans/item-links/04-related-writeback-live-proof-and-docs.md after reading plans/item-links/00-README.md and Plans 01-03. Do this only after codex/per-record-source-writeback has merged to openscholar and this branch is rebased on it; renumber the item-links migration first if needed. Estimate 6 to 8 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse the Zotero writeback mapper (zoteroRelations, createZoteroItemPayload, createZoteroItemPatch), the consumer's payload build, itemSourceLink for remote keys, the per-source enabled link policy from the writeback plan, parseZoteroItemUri from Plan 01, and tools/verifySourceWriteback.ts and tools/verifyLiveZoteroWriteback.ts.
2. The table is the only authority for dc:relation. Delete the relations = {} default. Keep owl:sameAs and Mendeley predicates.
3. Red, green, clean up for the mapper and URI formatter. Real PostgreSQL coverage with the fake adapter, then the live Zotero playground round trip.
4. Read the current Zotero Web API docs on item relations before changing the mapper.
5. Do not delegate or run a reviewer unless the user asks.
6. Live commands touch only the Zotero playground group and the local database. Hosted libraries are not touched; their steps go on the Outline Evidence Library page after the push.
7. Cites is never written back.

EXECUTION RHYTHM
Mapper tests red → green, commit. URI formatter, commit. verifySourceWriteback red → implement consumer + dirty marking → green, commit. verifyItemLinks manual-wins rule, commit. Live proof, commit any fix. Docs, commit. After the user asks for a push: push, read back the remote commit, update both Outline pages, read them back.

COMMIT DISCIPLINE
Allowed prefixes, [plan-04] on every commit, no hook bypass, no failing tests, named files only.

WHEN TO STOP
Stop only for a missing required API, an unsafe live target, or a plan error that cannot be corrected from evidence. All "Exact tests" green including both live commands.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-04] revise <section> — <reason>, continue. Blocker file only when no safe path exists.

START NOW
Read AGENTS.md, the README, and Plan 04. Confirm the branch is rebased on the merged writeback work. Check git status. Add the first failing mapper test.

Go.
```
