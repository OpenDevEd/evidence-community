# Plan 01 — Manifest contract, automatic reconciliation, and live proof

## Goal

Define a Zotero group once in `LIBRARY_CONFIG_JSON`. Both background workers must use that definition automatically, with no extra Zotero environment variable and no manual database setup or first import.

## Scope and design

Replace the current key-only `sources[]` entry with one strict Zotero source definition. It contains `key`, `provider: "zotero"`, `groupId`, `apiKey`, `enabled`, `writebackEnabled`, `defaultWriteback`, and optional request settings parsed by the existing Zotero connection schema.

Add one shared manifest source registry. It provides a server-only lookup by source key and a credential resolver used by both Zotero import and writeback. The API key is never copied into PostgreSQL or the public configuration.

Add one transactional reconciler. Before either source worker starts its first sweep, it locks the source rows, clears the previous default, creates or updates every configured Zotero source, and marks absent remote sources removed. Repeated and concurrent reconciliation must produce the same result. An existing key may change enabled state and request settings, but not provider or Zotero group identity.

The sync worker reconciles before its first sweep, so the first full import and later incremental refreshes are automatic. The writeback worker reconciles before draining jobs and reads the same manifest definition. There is no separate provisioning command.

## Test-first steps

1. Add failing manifest tests for a complete Zotero source, duplicate keys/groups, missing API keys for writeback, default-writeback rules, and public secret redaction.
2. Add failing pure registry tests proving both import and writeback resolve the same API key by source key and that an unknown source fails plainly.
3. Add a real PostgreSQL reconciliation test for create, update, remove, restore, default switching, identity changes, and repeated/concurrent calls.
4. Implement the new manifest schema, source registry, and reconciler. Delete the environment credential resolver and `credentialRef` from the Drizzle schema.
5. Generate migration 0034 and regenerated schema artifacts. Update examples, local configuration, and every fixture/caller to the new contract. Acceptance profiles have no Zotero sources and remain valid unchanged.
6. Update real Zotero source and writeback verifiers so their database starts without a Zotero row. The worker must create it from the manifest before syncing or writing.
7. Update worker and operations documentation. Remove every instruction that asks for a Zotero environment variable or manual source row.
8. Push the tested branch, update docs-pen's one JSON manifest, redeploy, and verify the automatic import and one controlled round trip against Zotero group `6632364`.
9. Keep the full acceptance gate green. The repeat run exposed a stale browser expectation, not a product bug: Amber enables citation URL display but has no Zotero translation service, so the page correctly hides the citation after the endpoint returns no result. Make the acceptance expectation require both URL display and a configured translation service. Keep unit coverage for a returned citation and for the empty result. Do not revive the old indexed-citation fallback.

## Files

- `src/config/library-config/schema.ts`
- `src/config/library-config/public.ts`
- `src/lib/source-ingestion/credentials.ts` or its clean replacement
- `src/lib/source-ingestion/runtime.ts`
- `src/lib/source-ingestion/zotero/connection.ts`
- `src/lib/source-ingestion/orchestrator.ts`
- new shared source reconciliation module under `src/lib/source-ingestion/`
- `src/lib/source-writeback/runtime.ts`
- `tools/runSourceSync.ts`
- `tools/runSourceWriteback.ts`
- `packages/evidence-library-core/src/schema.ts`
- migration `drizzle/0034_manifest-owned-zotero-sources.sql` and generated metadata
- `config/library.example.json`
- `config/library.local.json`
- `tests/fixtures/library-config.ts`
- source, Zotero, writeback, schema, public-config, and Compose tests
- `docs/source-ingestion-contract.md`
- `docs/source-orchestration.md`
- `docs/source-writeback.md`
- `docs/zotero-source-adapter.md`
- `tools/runRuntimeAcceptance.ts`
- `tests/unit/item-details-card.test.tsx`

## Exact tests

```sh
npx vitest run tests/unit/library-config-schema.test.ts tests/unit/library-config-public.test.tsx tests/unit/library-config-artifacts.test.ts tests/unit/source-configuration.test.ts tests/unit/source-writeback-runtime.test.ts tests/unit/zotero-source.test.ts tests/unit/zotero-write-adapter.test.ts tests/unit/source-writeback-policy.test.ts
npm run schema:check
npm run test:source-configuration
npm run test:source-model
npm run test:source-orchestrator
npm run test:zotero-source
npm run test:source-writeback
npm run test:collection-writeback
npm run test:source-collections
npm run test:zotero-live
npm run test:zotero-writeback-live
npm run test:unit
npm run test:acceptance
npx tsc --noEmit
npm run lint
npm run build
```

The two live Zotero commands intentionally mutate only test group `6632364` and their isolated local services. Run them only after the unit and real local service suites pass.

## Deployment gate

Deploy docs-pen from the exact pushed commit. Its `LIBRARY_CONFIG_JSON` must contain the single Zotero source definition and no extra Zotero environment variable. Read back the effective config and container environments. Then verify:

1. both source workers stay running;
2. the durable Zotero source row appears without a manual database command;
3. the first sync succeeds and advances its cursor;
4. the five current test-group items and collections reach PostgreSQL and Meilisearch;
5. a controlled Zotero edit appears after a background poll;
6. a controlled Evidence Library edit reaches Zotero through normal writeback;
7. source sync, writeback, search, and publication have no pending failed or dead-lettered work.

## Completion rules

- The manifest is the only credential authority.
- `credentialRef` and the environment resolver no longer exist anywhere in source, schema, migration output, docs, or tests.
- No manual row creation or first-import step remains.
- All listed tests pass.
- The live docs-pen round trip passes on the exact deployed commit.

## Risks

- Pointing an existing source key at another group would corrupt identity. Reconciliation must reject that change.
- Removing a source must retain its durable origin row and cursor while stopping sync and writeback.
- The server-only API key must not enter public config or admin responses.
- Switching the default writeback source must clear the old default in the same transaction before setting the new one.
