# Plan 04 — New library, live proof, docs, and handoff

## Goal

Create a new isolated Evidence Library on the new code, prove the whole writeback flow against a real Zotero group from the browser, update the docs and Outline, and tell OpenScholar what to re-sync.

## Scope and design

1. **New library (D19).** Name `OpenScholar Evidence Library Writeback E2E`, origin `https://docs-openscholar-writeback-e2e.opendev.space`. Follow `docs/evidence-library-operations.md` and `plans/tenant-isolated-deployment/03-live-cutover-and-isolation-proof.md` exactly as for docs-pen:
   - database and restricted login `openscholar_writeback_e2e` on the shared `evidence-library-postgres` via `npm run database:provision`;
   - new private and public buckets `openscholar-writeback-e2e-private` / `-public`;
   - new Coolify Compose application from `docker/compose.library.yaml`, branch `openscholar`, `connect_to_docker_network=false`, own private Meilisearch with a fresh master key;
   - `LIBRARY_CONFIG_JSON` built from `config/library.example.json` with the new identity, services, `authentication.secret` + `authentication.adminPassword`, and one `sources[]` entry for the new Zotero group (ID from the user, existing API key, `writebackEnabled: true`, no `defaultWriteback` — it no longer exists).
   The two existing development libraries (`rzbo9als0hdnr4gegtx97qos`, docs-pen `zik9u2wffsmfahgjbboeotvk`) are not touched.
2. **Live tools.** `tools/verifyLiveZoteroWriteback.ts` and `tools/verifyNativeFileLifecycle.ts` create the first link with `ensureItemWritebackLinks` (done in Plan 01) and now also prove: a record selected for two sources gets two links and two jobs; unchecking one supersedes its pending job and leaves the remote item; rechecking after a remote edit enters `conflict`, and each of the two choices from Plan 03 ends in the expected local and remote state; unpublish deletes only at the checked sources.
3. **Browser to real Zotero.** Add `tools/verifyAdminZoteroWriteback.ts` (Playwright + the new Zotero group): create a native record in `/admin`, upload a PDF, press Publish, tick the Zotero source, wait for the worker, then read the parent item and its `linked_url` attachment from the Zotero API. Then open Sources, untick, save, edit and publish again, and prove Zotero did not change. Then Unpublish with the source ticked and prove the Zotero item is gone. Wire it as `npm run test:admin-zotero-live`.
4. **Docs.** Update `docs/source-writeback.md:34-35`, `docs/source-ingestion-contract.md:40-44,100-103`, `docs/zotero-source-adapter.md:17`, and `docs/evidence-library-operations.md` where it lists sources config. Say plainly: “Each record chooses its writeback sources when it is published or unpublished. There is no default source.”
5. **Outline.** Update “04 — Evidence Library Current State” (`eGg2HF18MC`) with the new library’s IDs, commit, deployment ID and proof, and add the warning: the two older development libraries still run a pre-0035 schema and must have `defaultWriteback` removed from `LIBRARY_CONFIG_JSON` before any redeploy. Add one “next” line to “03 — OpenScholar Current State” (`6dcc7403-a39f-4922-8a6c-a5c7b2a900dd`).
6. **Handoff to OpenScholar (D20).** Write `plans/per-record-source-writeback/HANDOFF.md` with: the new `sources[]` shape (no `defaultWriteback`), the commit to pin, the new runtime’s IDs and service values, and the instruction that OpenScholar must run `node scripts/sync-evidence-library-config-contract.mjs --commit <sha>`, re-run `seedDevelopmentBinding` against the new runtime, and update `plans/evidence-library-configuration-interface/05-discovery-and-platform-editors.md`.

## Test-first steps

Integration work; test after each unit.

1. Extend the two live tools; run them locally against the Compose test stack; commit.
2. Add the admin live tool; commit.
3. Update docs; commit. Push the branch.
4. Provision database, buckets and Coolify app; set `LIBRARY_CONFIG_JSON`; deploy; verify health and containers.
5. Run the admin live tool against the new origin; update Outline; write HANDOFF.md; commit.

## Files

- `tools/verifyLiveZoteroWriteback.ts`, `tools/verifyNativeFileLifecycle.ts`, new `tools/verifyAdminZoteroWriteback.ts`, `package.json`
- `docs/source-writeback.md`, `docs/source-ingestion-contract.md`, `docs/zotero-source-adapter.md`, `docs/evidence-library-operations.md`
- `plans/per-record-source-writeback/HANDOFF.md`

## Exact tests

```sh
npm run test:zotero-writeback-live
npm run test:native-file-lifecycle
npm run test:admin-zotero-live
npm run test:library-compose
npm run test:database-provisioning
```

The Zotero commands change the new dedicated Zotero group. That is expected.

## Deployment gate

- `npm run database:provision` and `npm run test:database-provisioning` pass for the new database.
- The new Coolify deployment finishes healthy on the pushed commit; web, search-indexer, source-sync, source-writeback, publication-worker and Meilisearch containers are healthy.
- `GET /api/library-config/health` on the new origin reports the active revision and no rejected revision.
- Password login works; signed-out admin APIs return 401.
- In the real browser: publish a record with the dialog, and the Zotero item exists; unpublish, and it is gone.

## Completion rules

- All five commands pass and the deployment gate is met.
- Both Outline pages updated and re-read.
- HANDOFF.md written.
- Commits tagged `[plan-04]`.

## Risks

- Zotero rate limits during the browser tool. Reuse the wait helpers from `verifyLiveZoteroWriteback.ts`.
- The Zotero API key must have write access to the new group. Check with one `GET /groups/{id}/items?limit=1` and one write before running the tool.
- Do not reuse any database name, bucket, or Meilisearch key from the two older libraries.
