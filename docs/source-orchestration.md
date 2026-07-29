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
```

The default worker identity is `<hostname>:<pid>`. A stable container identity
may be supplied with `--worker-id`.

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
