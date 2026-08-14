# Plan 01 — Private search and one application

## Goal

Make `docker/compose.library.yaml` the only deployment shape for one Evidence Library. It must run the web app, all current long-running workers, and one private persistent Meilisearch service.

## Scope

1. Add pinned `getmeili/meilisearch:v1.37` to `docker/compose.library.yaml` with production mode, analytics disabled, a required master key, health check, named volume, and no public port.
2. Make the search worker wait for private Meilisearch and run with `--rebuild-if-missing --watch`.
3. Move `source-sync` and `source-writeback` from `docker/compose.sources.yaml` into the main stack, then delete the old Compose file.
4. Add an effective-Compose verifier. It must prove that only `web:3000` is exposed through the proxy, Meilisearch has no published port, all services use the same runtime config, and the private search key matches the runtime document.
5. Change runtime acceptance from one shared Meilisearch to one service per library.

## Design

`ensureSearchIndex()` returns whether it created the index. The search command accepts `--rebuild-if-missing`. When the index was just created, it calls the existing `rebuildSearchIndex()` before entering watch mode. A normal worker restart against an existing index does not rebuild it.

Extract search command parsing into the same kind of pure module already used by source writeback. Do not add a second parser or inspect command-line text in tests.

The two acceptance libraries use the same index name on different Meilisearch services. This proves service isolation rather than relying on different index names.

The web app continues to wait for the search worker, so it never serves an empty or half-rebuilt index. Increase the worker health-check startup window to 60 minutes for the one-time rebuild. The worker continues reporting `starting` while it rebuilds and becomes healthy only after the index is complete and its state is `idle`. A failed or stalled rebuild therefore keeps the site unavailable instead of showing incomplete public results. The live cutover records the actual rebuild time. If a real library cannot rebuild inside this explicit window, stop and revise the deployment plan before cutover.

## Migration choice

No PostgreSQL migration is needed. A new named Meilisearch volume starts empty and is filled from the existing PostgreSQL data. Deleting `docker/compose.sources.yaml` is a clean deployment break; there is no second source-worker application to migrate.

## Test-first steps

1. Add failing `tests/unit/search-index-command.test.ts` cases for `--rebuild-if-missing`, incompatible arguments, and defaults.
2. Add failing search-consumer coverage proving `ensureSearchIndex()` reports created versus existing.
3. Implement the command and one-time rebuild path.
4. Add a failing `tools/verifyLibraryCompose.ts` check against effective Compose JSON, then add the private service and merged workers until it passes.
5. Split acceptance Meilisearch services and add the pause/resume queue-isolation proof.
6. Delete `docker/compose.sources.yaml` and every document that tells operators to deploy it separately.

## Files

- `docker/compose.library.yaml`
- delete `docker/compose.sources.yaml`
- `src/lib/search-index/command.ts`
- `src/lib/search-index/consumer.ts`
- `tools/runSearchIndexer.ts`
- `tools/verifyLibraryCompose.ts`
- `tests/unit/search-index-command.test.ts`
- focused search-consumer unit test file selected from the existing suite
- `tests/acceptance/compose.yaml`
- `tests/acceptance/configs/amber.json`
- `tests/acceptance/configs/indigo.json`
- `tools/runRuntimeAcceptance.ts`
- `package.json`
- `docs/evidence-library-operations.md`
- `docs/search-indexing.md`
- `docs/source-orchestration.md`
- `docs/source-writeback.md`

## Exact tests

```sh
npx vitest run tests/unit/search-index-command.test.ts tests/unit/search-outbox-cancellation.test.ts
npm run test:library-compose
npm run test:search-worker
npm run test:acceptance
npm run test:unit
npx tsc --noEmit
npm run lint
npm run schema:check
npm run build
```

## Deployment gate

After push, deploy the existing Coolify application from `/docker/compose.library.yaml`. Read back the exact commit and effective Compose. The application must show five healthy/running services: `web`, `search-indexer`, `source-sync`, `source-writeback`, and `meilisearch`. Only the web service may have a public router. The search worker must become idle after rebuilding the new private index.

## Completion rules

- The effective Compose verifier and all listed checks pass.
- Restarting the worker does not rebuild an existing index.
- Removing the Meilisearch volume and redeploying restores published records from PostgreSQL.
- Pausing one acceptance Meilisearch leaves the other library's indexing working.
- No code or documentation refers to a second source-worker application.

## Risks

- Creating an empty index without rebuilding would hide existing records. The one-time rebuild is required before cutover.
- A mismatched search key would leave every worker unhealthy. The Compose verifier must compare the effective values.
- The first rebuild keeps the web service waiting. The 60-minute startup window prevents a normal large rebuild from being mistaken for a dead worker while still failing closed.
- Source workers have no deployment health endpoint today. Verify their logs and that they remain running and idle when no source is configured.
