# Plan 01 — Private search and one application

## Goal

Make `docker/compose.library.yaml` the only deployment shape for one Evidence Library. It must run the web app, all current long-running workers, and one private persistent Meilisearch service.

## Scope

1. Add pinned `getmeili/meilisearch:v1.37` to `docker/compose.library.yaml` with production mode, analytics disabled, a required master key, health check, named volume, and no public port.
2. Make the search worker wait for private Meilisearch and run in watch mode. A missing index always rebuilds before the worker becomes ready.
3. Move `source-sync` and `source-writeback` from `docker/compose.sources.yaml` into the main stack, then delete the old Compose file.
4. Add an effective-Compose verifier. It must prove that only `web:3000` is exposed through the proxy, Meilisearch has no published port, all services use the same runtime config, and the private search key matches the runtime document.
5. Change runtime acceptance from one shared Meilisearch to one service per library.
6. Put Meilisearch only on the private application network. Put the four runtime containers on both that private network and one explicit external PostgreSQL network.
7. Add a durable PostgreSQL rebuild marker that is set before creating or rebuilding an index and cleared only after every Meilisearch task succeeds.

## Design

`ensureSearchIndex()` returns whether it created the index and accepts a callback
that runs before index creation. The worker sets the durable rebuild marker in
that callback. A new database starts with the marker pending. The worker also
sets it before an explicit rebuild and clears it only after the full rebuild
succeeds. On restart, a pending marker forces the rebuild to begin again. A
normal restart with a complete index and a cleared marker does not rebuild.

Extract search command parsing into the same kind of pure module already used by source writeback. Do not add a second parser or inspect command-line text in tests.

The two acceptance libraries use the same index name on different Meilisearch services. This proves service isolation rather than relying on different index names. The effective-Compose verifier also proves the search service never joins the external PostgreSQL network, so another application's identical `meilisearch` service name cannot enter shared DNS.

The web app continues to wait for the search worker, so it never serves an empty or half-rebuilt index. Increase the worker health-check startup window to 60 minutes for the one-time rebuild. The worker continues reporting `starting` while it rebuilds and becomes healthy only after the index is complete and its state is `idle`. A failed or stalled rebuild therefore keeps the site unavailable instead of showing incomplete public results. The live cutover records the actual rebuild time. If a real library cannot rebuild inside this explicit window, stop and revise the deployment plan before cutover.

## Migration choice

Add one PostgreSQL migration with a non-null rebuild-pending boolean on the
singleton `status` row. Its default is true for both fresh and existing
development databases. No compatibility path is kept. A successful full
rebuild changes it to false. Deleting `docker/compose.sources.yaml` is a clean
deployment break; there is no second source-worker application to migrate.

## Test-first steps

1. Add failing tests for the durable rebuild decision, missing-index callback, interrupted rebuild, explicit rebuild, and completed restart.
2. Add failing search-consumer coverage proving `ensureSearchIndex()` calls the missing callback before creation and reports created versus existing.
3. Implement the durable marker and fail-closed rebuild path. Delete the optional `--rebuild-if-missing` behavior because a missing index must always rebuild.
4. Add a failing `tools/verifyLibraryCompose.ts` check against effective Compose JSON, then add the private service and merged workers until it passes.
5. Split acceptance Meilisearch services and add the pause/resume queue-isolation proof.
6. Delete `docker/compose.sources.yaml` and every document that tells operators to deploy it separately.

## Files

- `docker/compose.library.yaml`
- delete `docker/compose.sources.yaml`
- `src/lib/search-index/command.ts`
- `src/lib/search-index/bootstrap-state.ts`
- `src/lib/search-index/consumer.ts`
- `src/db/schema/tables/status.ts`
- one checked-in Drizzle migration and snapshot
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
npx vitest run tests/unit/search-index-command.test.ts tests/unit/search-index-bootstrap.test.ts tests/unit/search-outbox-cancellation.test.ts
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

After push, deploy the existing Coolify application from `/docker/compose.library.yaml`. Read back the exact commit and effective Compose. The application must show five healthy/running services: `web`, `search-indexer`, `source-sync`, `source-writeback`, and `meilisearch`. Only the web service may have a public router. Meilisearch must be absent from the external PostgreSQL network. The search worker must become idle and the durable marker must be false after rebuilding the new private index.

## Completion rules

- The effective Compose verifier and all listed checks pass.
- Restarting the worker does not rebuild an existing index.
- Stopping a rebuild after index creation leaves the marker pending; restart completes the rebuild before health becomes ready.
- Removing the Meilisearch volume and redeploying restores published records from PostgreSQL.
- Pausing one acceptance Meilisearch leaves the other library's indexing working.
- No code or documentation refers to a second source-worker application.

## Risks

- Creating an empty index without rebuilding would hide existing records. The one-time rebuild is required before cutover.
- A mismatched search key would leave every worker unhealthy. The Compose verifier must compare the effective values.
- The first rebuild keeps the web service waiting. The 60-minute startup window prevents a normal large rebuild from being mistaken for a dead worker while still failing closed.
- Source workers have no deployment health endpoint today. Verify their logs and that they remain running and idle when no source is configured.
