# Plan 01 — Config and link model

## Goal

Remove `defaultWriteback`. Let a record have many enabled writeback links. Give the app one function that answers “which sources does this record write to, and may it?”.

## Scope and design

1. **Config schema.** In `src/config/library-config/schema.ts` delete `defaultWriteback` (line 1098) and the two `superRefine` issues about it (1101-1116). Delete the “Only one source can be the default writeback source” rule (1126-1130). Keep `enabled`, `writebackEnabled`, unique `key`, unique `groupId`. Regenerate `public/library-config.schema.json` and `public/library-config.catalogs.json` with `npm run schema:generate:library-config`. Update `config/library.example.json:219` and `tests/fixtures/library-config.ts:272`.
2. **Database.** In `packages/evidence-library-core/src/schema.ts` delete `sourceConnection.defaultWriteback` (101), check `sourceConnection_default_writeback_remote` (132-138) and index `sourceConnection_one_default_writeback` (140-142). Delete `itemSourceLink_one_writeback_per_item` (399-401). Leave `collectionSourceLink` untouched (D10). Add `drizzle/0035_per-record-source-writeback.sql` and its snapshot.
3. **Config projection.** `src/lib/source-ingestion/configuration.ts:25,75,84,100` stops reading or writing `defaultWriteback`.
4. **Policy.** In `src/lib/source-writeback/policy.ts` replace `resolveItemWritebackPolicy` (127-181) with `resolveItemWritebackTargets(input)`. Keep `resolveCollectionWritebackPolicy` (183-233) as is. It returns `{ available: WritebackTarget[]; selected: string[]; originSourceKey: string | null }` where `WritebackTarget = { sourceKey, sourceLabel, provider, sourceEnabled, writebackEnabled, linkExists, itemEnabled, isOrigin }`. `available` lists every configured source with `writebackEnabled: true`, in config order. `selected` lists source keys whose link has `writebackEnabled = true`. `isOrigin` comes from the existing identity lookup (132). Keep `evaluateSourceWritebackPolicy` for the per-source reason.
5. **Link creation.** In `src/lib/source-writeback/queue.ts` replace `ensureDefaultWritebackLink` (283-340) with `ensureItemWritebackLinks(tx, { itemKey, sourceKeys, configuration })`. It sets `writebackEnabled = true` for the listed keys (inserting a link with `sourceRecordKey = itemKey` when missing) and `writebackEnabled = false` for every other existing link. It rejects unknown or writeback-disabled source keys with a clear error. It returns `{ enabled: string[]; newlyEnabled: string[] }` so callers can enqueue a send for newly enabled sources on published records (D15). Add `cascadeChildWritebackLinks(tx, parentItemKey)` that applies the parent’s selection to every child item link (D6, children follow the parent at all times). Add `resolveChildWritebackSourceKeys(tx, parentItemKey)` that returns the parent’s enabled keys (D6).
6. **Callers.** `native-item-service.ts:981-995` passes the request `sourceKeys` for top-level items and the parent’s keys for children. `native-file-service.ts:948-953,1276-1281` uses the parent’s keys. `crossref-activation-service.ts:310` stops calling the deleted function. Collections do not call it today; leave `collection-mutation-service.ts` alone.
7. **Import.** `src/db/record-identity.ts:181-231` sets `writebackEnabled = true` for the identity source without the NOT EXISTS guard. `transactional-writer.ts:610-635` (collections) stays.
8. **Access rule.** `requireItemDraftAccess` (`native-item-service.ts:148-176`) throws `ItemWritebackUnavailableError` only when the record is imported and its identity source has writeback disabled in config. Native records are always editable.
9. **Tools and tests that name `defaultWriteback`** must be updated in this plan so the branch compiles: `tools/verifySourceWriteback.ts:129-138,802-810`, `tools/verifyLiveZoteroWriteback.ts:370-381,776-786`, `tools/verifyNativeFileLifecycle.ts:414-423,1205`, `tools/verifySourceConfiguration.ts:46-118`, `tools/verifyCrossrefActivation.ts:341`, `tests/unit/library-config-schema.test.ts:90-131`, `tests/unit/source-configuration.test.ts`, `tests/unit/zotero-source.test.ts:48`, `tests/unit/zotero-write-adapter.test.ts:384`, `tests/unit/source-writeback-policy.test.ts`. Where a tool relied on the default to create the first link, it now calls `ensureItemWritebackLinks` with an explicit key.

## Test-first steps

1. Red: `tests/unit/library-config-schema.test.ts` — a config with two `writebackEnabled` sources and no `defaultWriteback` parses; `defaultWriteback` is rejected as an unknown key. Green: schema change, regenerate artifacts, `tests/unit/library-config-artifacts.test.ts` green. Commit.
2. Red: `tests/unit/source-writeback-policy.test.ts` — `resolveItemWritebackTargets` returns all writeback sources, mark selected from links, mark `isOrigin` on the identity source, mark `sourceEnabled: false` when config disables it, and return an empty selection for a native record with no links. Green. Commit.
3. Red: new `tests/unit/source-writeback-links.test.ts` — `ensureItemWritebackLinks` inserts, enables, disables, rejects unknown keys, and child keys come from the parent. Green (use the existing PGlite/test DB helper the other unit tests use). Commit.
4. Green migration + core schema + `npm run schema:check`. Commit.
5. Update callers, projection, import, tools. `npx tsc --noEmit`, `npm run test:unit`. Commit.

## Files

- `src/config/library-config/schema.ts`, `public/library-config.schema.json`, `public/library-config.catalogs.json`, `config/library.example.json`
- `packages/evidence-library-core/src/schema.ts`, `drizzle/0035_per-record-source-writeback.sql`, `drizzle/meta/`
- `src/lib/source-ingestion/configuration.ts`, `src/db/record-identity.ts`
- `src/lib/source-writeback/policy.ts`, `src/lib/source-writeback/queue.ts`
- `src/lib/admin/native-item-service.ts`, `native-file-service.ts`, `src/lib/publication/crossref-activation-service.ts`
- tools and tests listed in design point 9

## Exact tests

```sh
npm run lint
npx tsc --noEmit
npm run schema:check
npm run test:unit
npm run test:source-writeback
npm run test:native-file-lifecycle
npm run test:source-configuration
```

The last three need the local Compose test services (see `docs/source-writeback.md`). Run them; do not skip.

## Deployment gate

Not deployed in this plan. The runtime is deployed once in Plan 03. Local proof: `npm run test:acceptance` still starts the stack and its migrations apply cleanly on a fresh database, including 0035.

## Completion rules

- No reference to `defaultWriteback` remains in `src/`, `packages/`, `tools/`, `tests/`, `config/`, or generated artifacts (`git grep -n defaultWriteback` returns only `plans/` and `drizzle/00[0-3][0-4]*`).
- All commands under “Exact tests” pass.
- Each step committed with `[plan-01]`.

## Risks

- `reserveItemSourceLinks` runs inside the import transaction; dropping the guard changes no row for existing imports but must not create two enabled links for the same source. The unique (source, sourceRecordKey) rule still prevents that.
- `requireItemDraftAccess` currently blocks non-native items with “no effective policy”. Loosening it wrongly could let an imported record be edited with writeback silently off. The test in step 2 must cover the disabled-source case.
