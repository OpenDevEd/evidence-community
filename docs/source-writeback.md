# Source writeback worker

Local draft publication is the canonical commit. Remote providers are updated
asynchronously from durable `sourceWritebackJob` rows created in the same
transaction as that commit.

## Processing contract

1. Claim the oldest ready job with `FOR UPDATE SKIP LOCKED`, a renewable lease,
   and a source/item advisory lock. Only one revision for one remote record may
   be in flight at a time.
2. Re-check the stream after claiming so a concurrent commit cannot create an
   overlapping lease, then materialize one consistent provider
   payload from the canonical item, tags, provider-owned collections, parent
   link, remote key, and remote version.
3. Skip an obsolete upsert after unpublish or an obsolete delete after restore.
   A paused connection or a child waiting for its parent remote identity defers
   the job without consuming an attempt and records the reason for operators.
   A child whose linked parent has no viable upsert fails normally instead of
   deferring forever. A removed connection or disabled link supersedes the job.
4. Call the provider adapter outside the database transaction while renewing
   the lease.
5. Under the item-mutation lock, record the returned remote key/version and
   source snapshot. Dirty fields are cleared only when the canonical revision
   still equals the job revision. A local edit made during the remote call is
   therefore retained for the next job.

Failures use bounded exponential retries and become durable dead letters after
the configured attempt limit. An expired lease is reclaimable after a worker
crash. Adapter retries receive the same idempotency key, and adapters must make
repeated calls safe because a process can fail after the remote write but
before local acknowledgement.

The provider-neutral worker and fake adapter verifier cover default-target
linking, native creation, imported updates, parent-before-child ordering,
in-flight edits, heartbeat renewal, lease exclusion, lease expiry, retry,
dead-lettering, pause/resume, paused-target item creation, stale job suppression,
snapshots, and duplicate enqueue calls:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
  npm run test:source-writeback
```

The concrete Zotero adapter owns Web API payload mapping, optimistic version
checks, conflict refetch, and create/delete idempotency.

### Related links

The `itemLink` table, not the record's `relations` JSON, decides what a source
sees as "related". When the worker builds an item payload it replaces
`relations["dc:relation"]` with the link table's answer for that source:

- every outgoing `related` row (manual or source-owned), plus incoming rows the
  editor made from the other record;
- only targets that have a live link on the same source connection become
  URIs (`http://zotero.org/groups/<id>/items/<key>`);
- incoming source-owned rows are left out because they are the source's own
  mirror of the other item.

Other predicates in the JSON (`owl:sameAs`, Mendeley identifiers) are kept.
Publishing a record whose manual "related" set changed marks that record dirty
with `relations`; the source mirrors the pair onto the other item itself.
Removing a manual related link also drops the mirrored source-owned reverse row
so both public pages update at once; the next sync restores it if the source
still has it. "Cites" links are never written to a source.

`npm run test:source-writeback` covers the payload rule with the fake adapter and
`npm run test:zotero-writeback-live` proves the round trip against the Zotero
playground group.

## Run the worker

The worker reads the active library configuration for the PostgreSQL URL,
configured Zotero group, and API key. Before draining jobs, it reconciles the
manifest with durable source state. It does not need a separate provider file,
Zotero environment variable, or manual database row.

Run one bounded drain locally:

```sh
npm run source:writeback
```

Run continuously:

```sh
npm run source:writeback -- --watch
```

Options:

- `--max-jobs <1-1000000>` limits each sweep; default `10000`.
- `--poll-ms <1000-3600000>` controls the delay between watched sweeps;
  default `60000`.
- `--worker-id <id>` overrides `SOURCE_WRITEBACK_WORKER_ID` or the generated
  host/process identity.

A one-shot run exits non-zero if any job retries, dead-letters, or loses its
lease. Deferred and superseded jobs are expected workflow outcomes. Watched
runs log sweep-level errors and keep polling; a first `SIGINT` or `SIGTERM`
stops cleanly, while a second signal forces exit.

Build the dedicated worker image with the `source-writeback` Docker target. It
runs the same CLI in watch mode and shares the source-worker image layer with
the ingestion worker:

```sh
docker build --target source-writeback -t evidence-library-source-writeback .
```

The normal `docker/compose.library.yaml` deployment already runs this worker
inside the library's one Coolify application. Do not create a separate source
worker application.
