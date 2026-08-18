# Manifest-owned Zotero sources

## Problem

A Zotero source is currently split across three places. The runtime manifest names the source and enables writeback, PostgreSQL stores the group and a credential reference, and a process environment variable stores the API key. A new library therefore needs a manual database insert and separate worker environment setup before background sync can start.

## Fixed decisions

1. The server-side library manifest is the only place that defines a Zotero group and its API key.
2. One manifest entry contains the source key, Zotero group ID, API key, enabled state, writeback policy, default writeback choice, and optional Zotero request settings.
3. PostgreSQL keeps the durable source row because records, collections, cursors, runs, health, and writeback jobs refer to it. It never stores the API key or an environment-variable reference.
4. Each source worker reconciles the manifest into PostgreSQL before its first sweep. The sync worker then performs the first import and later refreshes automatically. No manual import command or database seed is required.
5. Removing a source from the manifest marks its durable row removed. Re-adding the same key and Zotero group restores it without losing its cursor. A key cannot be silently pointed at a different group.
6. The public configuration and admin APIs never expose the API key.
7. The old `credentialRef` column, environment resolver, documentation, fixtures, and tests are deleted rather than retained as compatibility code.

## Plan

1. [Manifest contract, automatic reconciliation, and live proof](01-manifest-contract-and-live-proof.md)

## Existing code to reuse

- `sourceConnection` remains the durable foreign-key and cursor authority.
- `zoteroConnectionConfigSchema` remains the single parser for Zotero request limits and URLs.
- `runSourceWorker()` remains the repeating worker loop.
- `createSourceSyncRuntime()` and `createSourceWritebackRuntime()` remain the shared runtime factories.
- `verifyZoteroSourceSync.ts`, `verifySourceOrchestrator.ts`, and `verifyLiveZoteroWriteback.ts` remain the real behavior checks.
- `projectPublicLibraryConfig()` already excludes server-only source settings from the public manifest.

## Migration choice

Add one breaking Drizzle migration that drops `sourceConnection.credentialRef` and replaces the default-writeback check with a rule based only on a non-native, non-removed source. Development data is disposable. No compatibility read, environment fallback, or backfill helper remains.

## Test rules

- Test the manifest parser and secret redaction directly.
- Test reconciliation against real PostgreSQL: create, update, remove, restore, default switching, immutable source identity, and idempotent concurrent calls.
- Prove the source worker starts with only a manifest entry, creates the durable row, imports Zotero data, advances its cursor, and indexes it.
- Prove writeback uses the same manifest API key and does not read a Zotero environment variable.
- Run the full unit, acceptance, schema, type, lint, build, source, Zotero, writeback, and collection suites.
- On docs-pen, prove the exact deployed commit, automatic first import, later background refresh, one safe writeback round trip, worker health, and empty failed queues.

## Agent use

No delegated review is required. Keep the plan, test-first loop, implementation, deployment, and verification in this session.

## Sources

- Zotero Web API v3: https://www.zotero.org/support/dev/web_api/v3/
- Zotero syncing: https://www.zotero.org/support/dev/web_api/v3/syncing
- Zotero write requests: https://www.zotero.org/support/dev/web_api/v3/write_requests

