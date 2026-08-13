# 05 — Durable delivery and nightly reconciliation

## Goal

Deliver activated publication targets promptly and add a leased nightly reconciliation pass that detects missed work, provider drift, pending verification, and interrupted operations.

## Scope

- Long-running publication worker process.
- Transactional enqueue hooks for canonical metadata and published-file mutations.
- Job claiming, entity serialization, leases, heartbeats, retries, supersession, dead letters, and receipts.
- Nightly keyset-paged scan of activated targets only.
- Worker health/status API.

## Design

Create one publication-worker process for each Evidence Library deployment. It shares the library PostgreSQL and storage configuration and runs two loops:

1. A short-poll delivery consumer claims due `publicationSyncJob` rows with `FOR UPDATE SKIP LOCKED`, serializes by item/provider/environment, reads current canonical state, invokes the core, and settles exact provider results.
2. A nightly scheduler acquires a singleton database lease, keyset-pages activated targets, rebuilds current desired hashes, verifies pending state, and enqueues only missing work.

Canonical item publication/edit and file publication changes enqueue jobs only for existing active/waiting publication targets. The job records the triggering revision, but the worker reads current canonical state. Older jobs are superseded so an older projection cannot overwrite newer provider state.

Record unpublication is blocked until the shared DOI core can express a real provider withdrawal and the Evidence Library can keep a DOI landing page available. See [`BLOCKER-unpublish-core.md`](./BLOCKER-unpublish-core.md). Do not enqueue unpublication as an ordinary metadata update or report it as successful.

Crossref and Zenodo failures are isolated by target. Crossref-to-Zenodo relation updates are scheduled after a minted Zenodo version DOI settles. Provider success is recorded only after the core's terminal verification rules pass.

Expose exact worker health and per-item receipts. Do not synthesize progress or use fixed timers to mark success.

## TDD sequence

1. Add failing queue tests for manual activation, metadata publication, file publication, file unpublication, and inactive items. Assert that record unpublication does not enqueue an unsupported provider update.
2. Add failing claim/lease/serialization tests with two workers and lease expiry.
3. Add failing supersession tests proving an older revision cannot settle over newer state.
4. Add retry/dead-letter tests for transient, permanent, conflict, and ambiguous recovery failures.
5. Add nightly keyset pagination tests proving only activated targets are scanned and unchanged hashes enqueue nothing.
6. Add restart tests for pending Crossref verification and Zenodo journals.
7. Implement worker, scheduler, health state, CLI, and container process command; delete the provisional `tools/runPublicationJobsOnce.ts` runner from phases 03-04.
8. Run all focused real-service-independent verifiers with real PostgreSQL.

## Files touched

- extend the `src/lib/publication/queue.ts` created in phase 03
- new `src/lib/publication/consumer.ts`
- new `src/lib/publication/reconciler.ts`
- new `src/lib/publication/worker.ts`
- new `src/lib/publication/worker-state.ts`
- new `tools/runPublicationWorker.ts`
- new `tools/checkPublicationWorkerHealth.ts`
- new `tools/verifyPublicationWorker.ts`
- `package.json`
- deployment/container definitions that already launch search/source workers
- `tests/acceptance/compose.yaml` with a publication-worker service and deterministic Crossref/Zenodo fake-provider service
- new `tests/acceptance/fixture/publication-provider-fake.mjs` exposing test-only state, failure, delay, and recovery controls
- canonical mutation services only at their transactional enqueue seam
- new admin health/status API routes

## Migration stance

No cron-only compatibility path and no second database. Delete any provisional one-shot runner introduced during earlier phases when the long-running worker lands.

## Exact test plan

```sh
npm run test:publication-model
npm run test:crossref-activation
npm run test:zenodo-activation
npm run test:publication-worker
npm run test:native-lifecycle
npm run test:linked-item-lifecycle
npm run test:native-file-lifecycle
npm run test:source-writeback
npm run test:search-worker
npm run test:acceptance
npx tsc --noEmit
npm run lint
```

## Deployability/runtime gate

- A full local stack runs web, PostgreSQL, storage, search, source workers, and publication worker.
- Worker health reports real heartbeat, stage, current job/run, and last success/failure.
- Killing and restarting the worker resumes due work without duplicate provider operations.
- Nightly scheduling can be triggered deterministically in tests without waiting for wall-clock midnight.

## Acceptance criteria

- Inactive items never enter the publication queue or nightly scan.
- Activated items enqueue immediately after relevant canonical changes.
- Record unpublication remains blocked until the shared core supports withdrawal and the public DOI landing page remains available.
- Nightly reconciliation repairs missed work and remains a no-op for converged records.
- Leases and supersession prevent stale overwrites.
- Provider environments, receipts, failures, and dead letters are queryable.
- One provider's failure does not falsely fail or settle the other provider.

## Pitfalls

- A provider HTTP success is not terminal provider success.
- Nightly scans must use keyset pagination, not offset pagination.
- Long provider operations need renewable leases and abort behavior after lease loss.
- A registered DOI cannot be deleted. Do not treat local unpublication as provider success until the shared core supports withdrawal and the public site serves a stable tombstone landing page.
