# Execution prompts

## Plan 01

```text
Implement plans/per-record-source-writeback/01-config-and-link-model.md after reading plans/per-record-source-writeback/00-README.md. Repository: /Users/mcharrad/Documents/Github/new-el-optimize (OpenDevEd/new-el, branch openscholar). Estimate 4 to 6 hours and keep working without asking questions the plan already answers.

STANDING RULES
1. Reuse policy.ts, queue.ts, consumer.ts, record-identity.ts and the existing unit-test database helper. Do not rewrite the worker.
2. Delete defaultWriteback everywhere and drop the one-writeback-link-per-item index. No compatibility reads, no backfill, no optional legacy field.
3. Red, green, cleanup for the schema, policy list and link helper. Regenerate artifacts with npm run schema:generate:library-config; never hand-edit public/library-config.*.json.
4. Read AGENTS.md and the Drizzle migration files before writing migration 0035.
5. Delegate only the mechanical tool/test updates that name defaultWriteback. Keep schema, policy, service and import edits in this session.
6. Every step ends with npm run lint, npx tsc --noEmit, npm run schema:check and npm run test:unit green.

EXECUTION RHYTHM
Failing config-schema test → schema change → artifacts → commit. Failing policy list test → resolveItemWritebackTargets → commit. Failing link-helper test → ensureItemWritebackLinks and child keys → commit. Migration 0035 + core schema → schema:check → commit. Callers, projection, import, tools → full local gate incl. test:source-writeback, test:native-file-lifecycle, test:source-configuration → commit.

COMMIT DISCIPLINE
Allowed prefixes only, [plan-01] on every commit, no hook bypass, no commit while tests fail. Stage named files.

WHEN TO STOP
Stop only for a missing required API or a plan error that evidence cannot fix. Do not stop for token worry or an answer already in the plan. git grep -n defaultWriteback must return only plans/ and old drizzle files before you stop.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-01] revise <section> — <reason>, then continue. Write 01-BLOCKER.md only when no safe path exists.

START NOW
Read AGENTS.md, the README and Plan 01. Check git status. Write the failing config-schema test.

Go.
```

## Plan 02

```text
Implement plans/per-record-source-writeback/02-publish-dialog-and-sources-api.md after reading plans/per-record-source-writeback/00-README.md. Plan 01 must be committed first. Repository: /Users/mcharrad/Documents/Github/new-el-optimize (branch openscholar). Estimate 5 to 8 hours and keep working without asking questions the plan already answers.

STANDING RULES
1. Reuse DialogModal.tsx, CheckboxGroup.tsx, Checkbox.tsx, Button.tsx, AdminSourceWritebackStatus.tsx, useAdminSourceWriteback.ts and the existing writeback status/retry routes. There is no shadcn ui folder.
2. Wording is provider-neutral: “Publish this record”, “Unpublish this record”, “Sources for this record”, “Also update”, “Also remove from”, source labels. Never “Zotero” in generic text. The Sources button is always shown.
3. Red, green, cleanup for the selection helper and both routes. Browser tests go through the real Publish button and check data-admin-writeback-dialog, data-admin-writeback-source and per-source data-admin-writeback-status. Never assert class names.
4. No useEffect for dialog or selection state; use handlers and render-derived values.
5. Delegate only the acceptance mock updates. Keep routes, services and components in this session.
6. Every step ends with npm run lint, npx tsc --noEmit and npm run test:unit green; the last step ends with npm run test:acceptance green.

EXECUTION RHYTHM
Failing selection-helper test → helper → commit. Failing publish/unpublish-route test → bodies, child cascade, per-source delete, batch behaviour → commit. Failing sources-route test → PUT route + refresh job → commit. Dialog, Sources button, per-source status, e2e updates → acceptance → commit. Then npm run dev, open /admin, publish a native record through the dialog and report exactly what you saw.

COMMIT DISCIPLINE
Allowed prefixes only, [plan-02] on every commit, no hook bypass, no commit while tests fail.

WHEN TO STOP
Stop only for a missing required API or a plan error evidence cannot fix. Acceptance must be green in Chromium before you stop.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-02] revise <section> — <reason>, then continue. Write 02-BLOCKER.md only when no safe path exists.

START NOW
Read AGENTS.md, the README, Plan 01 (for names) and Plan 02. Check git status. Write the failing selection-helper test.

Go.
```

## Plan 03

```text
Implement plans/per-record-source-writeback/03-conflict-choice.md after reading plans/per-record-source-writeback/00-README.md. Plans 01 and 02 must be committed. Repository: /Users/mcharrad/Documents/Github/new-el-optimize (branch openscholar). Estimate 4 to 6 hours and keep working without asking questions the plan already answers.

STANDING RULES
1. Reuse remoteItem in zotero/adapter.ts, the job queue/consumer, writeSourceIngestionBatch, the status contract and AdminSourceWritebackStatus.tsx. Add one adapter method, one state, one route shape.
2. Never overwrite either side without the admin’s explicit choice and confirm step. Ordinary in-flight 412 handling stays unchanged.
3. Red, green, cleanup for the version check, the state machine and the resolve route. Browser test through the real popover with data-admin-writeback-resolve.
4. Wording is provider-neutral and describes exactly what is lost on each side.
5. Delegate nothing that touches the worker; delegate only mock updates.
6. Every step ends with npm run lint, npx tsc --noEmit and npm run test:unit green; the last step ends with npm run test:acceptance green.

EXECUTION RHYTHM
Failing version-check test → adapter method + job outcome → commit. Failing state-machine test → conflict state → commit. Failing resolve-route test → both choices → commit. Popover UI + confirm + e2e → acceptance → commit.

COMMIT DISCIPLINE
Allowed prefixes only, [plan-03] on every commit, no hook bypass, no commit while tests fail.

WHEN TO STOP
Stop only for a missing required API or a plan error evidence cannot fix. Acceptance must be green before you stop.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-03] revise <section> — <reason>, then continue. Write 03-BLOCKER.md only when no safe path exists.

START NOW
Read AGENTS.md, the README, Plans 01–02 (for names) and Plan 03. Check git status. Write the failing version-check test.

Go.
```

## Plan 04

```text
Implement plans/per-record-source-writeback/04-live-proof-and-docs.md after reading plans/per-record-source-writeback/00-README.md. Plans 01, 02 and 03 must be committed. Repository: /Users/mcharrad/Documents/Github/new-el-optimize (branch openscholar). Estimate 3 to 5 hours and keep working without asking questions the plan already answers.

STANDING RULES
1. Reuse the wait, Zotero API and cleanup helpers in tools/verifyLiveZoteroWriteback.ts for the new admin live tool, and the docs-pen runbook in docs/evidence-library-operations.md and plans/tenant-isolated-deployment/03-live-cutover-and-isolation-proof.md for the new library.
2. Create only the NEW library named in Plan 04 and use only the NEW Zotero group. Never touch rzbo9als0hdnr4gegtx97qos, docs-pen, or a production tenant.
3. Test after each unit; run every live command named in the plan; do not skip because it modifies the test group.
4. Docs say plainly that each record chooses its sources on publish and there is no default source.
5. Never claim the Outline update worked until you re-read the page.
6. Delegate nothing that touches the live runtime.

EXECUTION RHYTHM
Extend the two live tools (incl. the conflict path with both choices and per-source unpublish) → run → commit. Add tools/verifyAdminZoteroWriteback.ts and its npm script → commit. Docs → commit. Push. Provision the new database and buckets, create the Coolify Compose app, set LIBRARY_CONFIG_JSON, deploy, verify health and containers, run the admin live tool against the new origin, update both Outline pages, write HANDOFF.md → commit.

COMMIT DISCIPLINE
Allowed prefixes only, [plan-04] on every commit, no hook bypass. Push only after the local gate is green.

WHEN TO STOP
Stop when the deployment gate, all five commands, both Outline pages and HANDOFF.md are done. If the Zotero group ID is missing, stop and ask for it — that is the one answer not in the plan. Stop early only for an unsafe live target or an activation rejection you cannot fix from the plan.

DEVIATIONS
Commit safe work, revise the plan with docs: [plan-04] revise <section> — <reason>, then continue.

START NOW
Read AGENTS.md, the README and Plan 04. Check git status and that Plans 01–03 are committed. Confirm the Zotero group ID is available, then extend tools/verifyLiveZoteroWriteback.ts first.

Go.
```
