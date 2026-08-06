# Source synchronization worker

The Evidence Library owns its source synchronization lifecycle. The worker is
database-driven: connections, cursors, attempts, leases, and health survive
container restarts and do not depend on a provider-specific process manager.

## Runtime flow

1. Select an active external `sourceConnection`.
2. Lock its `sourceSyncState` and claim a time-bounded lease.
3. Create a `sourceSyncRun` attempt.
4. Resolve the adapter from `SourceAdapterRegistry`.
5. Run the adapter while maintaining automatic and adapter-requested
   heartbeats.
6. Commit either a bounded success summary or a failure and release the lease.

Provider adapters receive the canonical database, the complete connection, an
optional credential resolver, and a heartbeat function. They are responsible
for fetching provider pages, mapping them to the provider-neutral ingestion
contract, and calling `writeSourceIngestionBatch`. The writer, not the
orchestrator, atomically advances the durable provider cursor with canonical
records and outbox events.

## Local operation

The command reads the same active library configuration as the Evidence
Library server, including the database URL:

```sh
npm run source:sync -- --connection zotero-example
npm run source:sync -- --concurrency 4
npm run source:sync -- --watch --poll-ms 60000
npm run source:sync -- --connection zotero-example --watch
```

The default worker identity is `<hostname>:<pid>`. A stable container identity
may be supplied with `SOURCE_SYNC_WORKER_ID` or `--worker-id`. Watch mode runs
one complete sweep at a time and waits 60 seconds between sweeps by default;
`--poll-ms` accepts 1,000–3,600,000 milliseconds. A busy connection is skipped
without failing the process because the database lease is the concurrency
authority.

Build the dedicated worker image with:

```sh
docker build --target source-sync -t evidence-library-source-sync .
```

The source worker intentionally has no synthetic container health check.
Per-connection attempts, lease heartbeats, last success, consecutive failures,
and last error are durable in `sourceSyncRun` and `sourceSyncState`; an idle
watch worker has no connection lease to heartbeat.

On the first `SIGINT` or `SIGTERM`, the worker finishes its active sweep, skips
the next poll, and exits successfully. A second signal exits immediately with
status 130. If the container is killed during a sync, the existing lease-expiry
recovery closes the abandoned run before the next worker retries it.
When launched through `npm run`, npm itself may report status 130 after Ctrl-C
even though the directly invoked worker follows the graceful shutdown path.

The deterministic PostgreSQL verifier covers heterogeneous dispatch, paused
connections, bounded concurrency, automatic lease exclusion, explicit
heartbeats, missing adapters, failure health, successful retry, and abandoned
lease recovery:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
  npm run test:source-orchestrator
```

## Operational guarantees

- A partial source write never advances the source cursor.
- A valid lease prevents duplicate work for one connection.
- An expired lease is closed as a failed run before a replacement starts.
- A worker cannot report success or failure after losing ownership.
- Paused, removed, and native connections are never selected by a sweep.
- Failure health is durable and a successful retry clears it.
- Provider-specific scheduling queues are unnecessary; every provider uses the
  same connection/run/state model.
- Watch-mode failures are logged and retried on the next poll. One-shot mode
  exits nonzero only when a connection result is `failed`; `busy` is not a
  failure.
