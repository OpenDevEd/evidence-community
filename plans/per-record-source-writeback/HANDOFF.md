# Handoff to OpenScholar — per-record source writeback

Date: 2026-08-18. Evidence Library branch `codex/per-record-source-writeback`, commit `6ccf82c1` (pushed). Not yet merged into `openscholar`.

## What changed in the runtime contract

1. `sources[]` no longer has `defaultWriteback`. Each entry is `{ key, provider: "zotero", groupId, apiKey, enabled, writebackEnabled, settings }`. The schema is strict, so a config that still sends `defaultWriteback` is rejected.
2. Records choose their own writeback sources when they are published or unpublished (`POST …/publish { sourceKeys }`, `POST …/unpublish { removeFromSourceKeys }`), or through `PUT …/writeback/sources { sourceKeys }`. Attachments and notes copy their parent.
3. Writeback status is per source: `GET/POST …/writeback/status|retry?source=<key>`. A new `conflict` state and `POST …/writeback/resolve?source=<key> { choice: "send-local" | "load-remote" }` exist. Migrations 0035–0038.

## What OpenScholar must do

1. Re-sync the configuration contract snapshot once the branch is merged into `openscholar` (or pin this branch's commit meanwhile):
   `node scripts/sync-evidence-library-config-contract.mjs --commit <sha>` — the catalog keeps 14 write-only paths; the `sources[]` shape loses `defaultWriteback`.
2. Update `plans/evidence-library-configuration-interface/05-discovery-and-platform-editors.md`: the Sources editor lists Zotero groups with `enabled` and `writebackEnabled` only. There is no default-writeback toggle. Per-record source choice lives in the Evidence Library `/admin`, not in OpenScholar's configuration page.
3. Re-bind OpenScholar's development Evidence Library to the new runtime (decision D20) by re-running `seedDevelopmentBinding` with these values:
   - runtime ID (Coolify application): `uqkhvfadx7uy7fegax2zdrsk`
   - base URL: `https://docs-openscholar-writeback-e2e.opendev.space`
   - database: `openscholar_writeback_e2e` on shared PostgreSQL resource `jsl67a25e78gukd3izzxz4zf` (host `jsl67a25e78gukd3izzxz4zf:5432` inside Coolify), login `openscholar_writeback_e2e` (password in the deployed `LIBRARY_CONFIG_JSON`)
   - search: private Meilisearch `http://meilisearch:7700`, index `items`, key = the app's `MEILISEARCH_MASTER_KEY`
   - storage: Supabase project `ocivvlhqiwtxvnycqnia`, buckets `openscholar-writeback-e2e-private` / `openscholar-writeback-e2e-public`, PDF limit 100 MiB
   - Zotero source: key `zotero-writeback-e2e`, group `6641415`
   - active runtime config revision: `openscholar-writeback-e2e-1`

## What was proven on 2026-08-18

- Coolify deployment `utzd2qf3vav5mxbqtcz62cog` finished; health reports `openscholar-writeback-e2e-1`; HTTP redirects to HTTPS; signed-out admin API returns 401.
- `npm run test:admin-zotero-live` in real Chromium against the new origin: publish through the “Also update” dialog → Zotero group 6641415 received the record; PDF upload → Zotero got a `linked_url` attachment; unticked source stayed untouched across a later publish; unpublish with the source ticked → Zotero deleted the copy. Test records were removed afterwards.
- `npm run test:zotero-writeback-live` (local stack + playground group 6632364): a Zotero edit made while the source was paused stopped in `conflict`; “send this record” overwrote Zotero; “load Zotero’s version” replaced the local record and ended `synced`.
- `npm run test:library-compose`, `npm run test:database-provisioning`, 951 unit tests, acceptance stack 68/68 admin browser tests.

## Older development libraries

`rzbo9als0hdnr4gegtx97qos` (docs-openscholar-compose-e2e) and `zik9u2wffsmfahgjbboeotvk` (docs-pen) still run the pre-0035 schema from `openscholar`. Before either is redeployed on this branch, remove `defaultWriteback` from its `LIBRARY_CONFIG_JSON` and bump the revision.
