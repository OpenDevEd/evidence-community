# Source writeback worker

Local draft publication is the canonical commit. Remote providers are updated
asynchronously from durable `sourceWritebackJob` rows created in the same
transaction as that commit.

## Processing contract

1. Claim the oldest ready job with `FOR UPDATE SKIP LOCKED`, a renewable lease,
   and a source/item advisory lock. Only one revision for one remote record may
   be in flight at a time.
2. Under the shared item-mutation lock, materialize one consistent provider
   payload from the canonical item, tags, provider-owned collections, parent
   link, remote key, and remote version.
3. Skip an obsolete upsert after unpublish or an obsolete delete after restore.
   A paused connection defers the job without consuming an attempt; a removed
   connection or disabled link supersedes it.
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
linking, native creation, imported updates, in-flight edits, lease exclusion,
lease expiry, retry, dead-lettering, pause/resume, stale job suppression,
snapshots, and duplicate enqueue calls:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
  npm run test:source-writeback
```

The concrete Zotero adapter owns Web API payload mapping, optimistic version
checks, conflict refetch, and create/delete idempotency.
