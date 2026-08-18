# Source ingestion contract

This branch uses a greenfield, provider-neutral source model. Existing Evidence
Library databases and deployments are not migrated or modified.

## Identity

- `item.key` and `collection.key` are immutable, library-wide canonical keys.
- Canonical keys use Zotero's eight-character object-key alphabet:
  `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`.
- A compatible provider key is adopted when unused. Otherwise the writer mints
  a canonical key and retains the provider key in `sourceRecordKey`.
- `itemIdentity` and `collectionIdentity` reserve canonical keys before record
  writes. Reservations are never replaced by a later source and make
  concurrent allocation safe.
- `itemSourceLink` maps a canonical item to a remote record. Provider identity
  is unique by `(sourceConnectionKey, sourceRecordKey)`, while
  `(itemKey, sourceConnectionKey)` allows one item to link to several providers
  without changing its canonical owner.
- At most one source link per item may have writeback enabled. Each link tracks
  the latest remote version, remote deletion state, the last fully acknowledged
  version, and the canonical fields that currently contain unpublished local
  changes.
- A removed source connection is retained with `status = 'removed'`; records
  never lose their permanent origin.

## Connections

- The built-in native connection is exactly `native`.
- Zotero connections are declared in `LIBRARY_CONFIG_JSON`. Both source
  workers reconcile those declarations before their first sweep.
- The current manifest supports Zotero group libraries. Other provider types
  remain database model capabilities until their manifest contracts are built.
- Duplicate non-null remote scopes for the same provider are rejected.
- OpenAlex queries are mutable configuration. Separate OpenAlex connections may
  intentionally hold the same query because connection identity, scheduling,
  and import history remain independent.
- Zotero API keys stay in the server-only manifest. They are not copied into
  the source row or public configuration.
- There is no default writeback source. Each record chooses the sources it
  writes to when it is published, and can change them later. A record may
  write to any number of sources. A new link uses the record's canonical
  eight-character key as its pending provider key. A paused source keeps its
  queued work. A record with no selected source stays local-only.
- Zotero uses Web API v3. Its durable cursor records the last complete library
  version and, during large imports, the target version plus the source
  snapshot and next deterministic manifest offset. It also retains soft-trash
  keys so restoring a parent rehydrates unchanged descendants and memberships
  from a full source snapshot.

## Canonical records

- `revision` is the monotonic canonical record revision.
- `itemSourceLink.remoteVersion` and the link-scoped
  `sourceSnapshot.remoteVersion` record the provider's revision, ETag, cursor
  version, or equivalent.
- The former `item.version` and `collection.version` fields do not exist.
- Imported parent items and parent collections retain their source ownership.
  Aliases belong to an explicit item-source link rather than the canonical
  item's owner.
- Collection membership may cross connections intentionally. This permits a
  native curated collection to combine records from multiple providers.
- Tags and collection memberships are normalized through `itemToTag` and
  `itemToCollection`; the canonical item table does not duplicate either list.
- `sourceSnapshot` is keyed by `(itemKey, sourceConnectionKey)`, so one
  canonical item can retain independent snapshots from several providers.
  Collection synchronization uses the collection row's canonical revision and
  the connection cursor.

## Drafts and publication

- Drafts live only in `itemDraft`; editing a draft never mutates the
  published `item` row.
- There is exactly one active draft per item key. Native items are always
  editable; imported items require one writeback-enabled `itemSourceLink`.
  `draftRevision`
  provides optimistic editor concurrency, while `baseRevision` records which
  canonical revision was visible when the patch was last saved.
- Drafts store only changed Zotero-style fields. A present `null` is an explicit
  clear tombstone; an absent field inherits the latest canonical value. The
  materialized base-plus-patch payload is validated against the pinned Zotero
  schema.
- Saves include the materialized payload the editor actually saw. The server
  derives only the editor's delta from that payload, rebases it onto the latest
  canonical row under lock, and then stores the resulting minimal patch. Source
  changes made during an edit session therefore flow through untouched fields.
- The field-patch migration refuses to run while legacy full-snapshot drafts
  exist instead of silently changing the meaning of saved edits.
- Publishing applies the patch to the latest canonical base, normalizes tags
  and collection memberships in the same transaction, increments the canonical
  revision, emits one outbox event, records changed fields on every source link,
  and removes the draft. Every source must mask locally changed fields until it
  catches up, even when only one link is the writeback target. Native collection
  memberships are library-local and are not marked for provider writeback.
- A writeback-enabled link also receives one durable `sourceWritebackJob` for
  the new canonical revision in the publication transaction. The stable
  source/item/revision/operation idempotency key makes duplicate enqueue calls
  harmless. Imported items use their existing remote key and version and
  start with their origin source selected; native items start with none.
  Attachments and notes always copy their parent's selection.
- Unpublishing retains the canonical row as a tombstone and emits a delete
  event plus a remote delete job when the native item has a writeback target.
  Repeated unpublish requests are idempotent. Canonical identities are not
  recycled after publication.
- Opening a draft from a tombstoned item is the explicit restore path;
  publishing that draft clears the tombstone and emits a new upsert revision.
  A linked tombstone marks every editable provider field dirty so writeback can
  recreate a remotely deleted record rather than silently diverging.
- The admin password creates a signed, short-lived, HTTP-only cookie. Every
  `/api/admin/items/**` response requires that cookie and is private and
  non-cacheable.

## Native PDF files

- PDF state is independent from attachment metadata. `itemFileDraft` points to
  a private Supabase object and may exist before either its attachment or
  parent metadata is published.
- `POST /api/admin/items/{attachmentKey}/file` creates or resumes a signed
  private upload. `POST .../file/complete` verifies the declared size and
  SHA-256, parses the PDF, extracts text, and prepares its first-page cover.
- `POST .../file/publish` requires published `Attachment` metadata and a
  published parent. It copies the verified PDF and cover to content-addressed
  public paths, updates the attachment's file-managed Zotero fields, records
  `itemFilePublication`, and removes only the file draft.
- A publish or unpublish of an attachment changes both the attachment and its
  parent's search document. Both canonical revisions are incremented and both
  outbox events are committed with the file state change.
- `DELETE /api/admin/items/{attachmentKey}/file` unpublishes the binary while
  leaving attachment metadata published. Attachment metadata cannot be
  tombstoned while a file publication still exists; unpublish the file first.
- The public PDF URL is system-managed while `itemFilePublication` exists.
  Later metadata publications preserve it. Supabase service credentials and
  bucket names remain in the server-only runtime configuration; clients only
  receive a short-lived signed upload URL.

## Search projection

Meilisearch documents are derived and rebuildable. Item documents must contain:

- canonical `key`;
- `sourceConnectionKey`;
- `sourceRecordKey`;
- `provider`;
- `sourceExternalScopeKey`;
- normalized `tags`;
- canonical collection keys in `collections`;
- derived hierarchical paths in `collectionsAncestry`;
- all currently supported bibliographic/search fields.

Collections remain canonical in PostgreSQL and are not mixed into the item
search index. A collection event expands to its current descendant subtree and
reprojects every member item whose derived ancestry may have changed.

The indexer claims one event at a time with a renewable lease. It projects the
current canonical revision, waits for every asynchronous Meilisearch task to
finish successfully, and only then acknowledges the event. Failures release
the lease with exponential retry timing; exhausted events become visible dead
letters. Replaying an event is safe because upserts and deletions are
idempotent and always derive from current PostgreSQL state.

A full rebuild deletes derived search documents and streams the current
top-level canonical items back in bounded batches. It does not acknowledge
outbox events; the normal drain immediately follows and covers writes that
committed during the rebuild.

## Write ordering

Source adapters emit provider-neutral batches to
`writeSourceIngestionBatch`. Each batch contains raw source snapshots,
Zotero-style canonical metadata, optional attachment fields, provider aliases,
source-key relationships, and an expected/next cursor pair.

The writer locks the source connection and rejects a stale cursor before
writing. Identity reservation is batched and collision-safe. Valid
eight-character provider keys are adopted when available; collisions are
remapped without changing provider identity.

Individual source records are capped at 2 MiB of serialized input and a batch
at 64 MiB. Collection references are unique after applying the current
connection as the default. The snapshot hash covers the complete canonical
write envelope, not only the raw provider payload, so attachment fields,
relationships, aliases, and source dates independently trigger replacement.

Parent foreign keys are deliberately immediate. The writer therefore applies
each batch in two passes:

1. upsert items and collections with parent fields set to `NULL`;
2. resolve provider keys to canonical keys and update parent fields.

Provider parent references resolve through that provider's item links. The
canonical parent and child may therefore have different owners when, for
example, a Zotero attachment belongs to a linked native parent. Collection
membership may reference any connection by
`(sourceConnectionKey, sourceRecordKey)`. Missing, deleted, or cyclic
relationships reject the complete batch. Relationship targets deleted by the
same batch are treated as deleted during validation.

Canonical writes, normalized memberships/tags, immutable aliases, source-link
versions, current link-scoped snapshots, parent reprojections, outbox events,
and the next connection cursor commit in one PostgreSQL transaction. Inbound
resolution consults `itemSourceLink` first, preventing a linked native item from
being imported again. Fields listed in the link's `dirtyFields` remain local;
the source updates every other field. Exact replays, version-only changes, and
remote changes confined to dirty fields advance link/snapshot state without
producing canonical revisions. Repeated deletions are also no-ops. Unknown
deletion keys never reserve identities.

Collection membership replacement is scoped to the source being ingested.
Memberships whose collection belongs to another source, including native
curation collections, are retained across remote updates.

A remote deletion tombstones the canonical item only when that connection owns
the canonical record. For linked native or differently owned items, it marks
the source link as remotely deleted while preserving local metadata and files.
The last fully acknowledged version advances only when no dirty field is being
masked and the requested remote deletion was applied canonically.
For a suppressed remote upsert of a locally deleted, differently owned item,
the acknowledged version means the remote state was fully observed; it does
not mean the canonical tombstone mirrors the remote record.

When a collection's name or parent changes, the outbox projector must expand
that event to the complete descendant collection subtree and every member item
whose derived collection ancestry changes. An `upsert` event is emitted only
for active parent items; a tombstoned parent remains a deletion.

## Source synchronization

- `SourceAdapterRegistry` dispatches each connection by provider. The runtime
  ships with the Zotero adapter; Mendeley, OpenAlex, DSpace, and EPrints plug
  into the same interface without changing orchestration or canonical writes.
- `sourceConnection` is the source registry and schedule input. A sweep selects
  only active, non-native connections and runs them with bounded concurrency.
- Every attempt creates an immutable `sourceSyncRun`. Exactly one running
  attempt may exist for a connection.
- `sourceSyncState` is the current health and lease record. It stores the active
  run, lease owner and expiry, last attempt/success/failure, consecutive failure
  count, bounded result summary, and last error.
- Claiming, expiring an abandoned run, and assigning a new lease happen under a
  row lock in one transaction. A second worker reports the connection as busy
  while the lease is valid.
- The runner maintains automatic heartbeats while the adapter works. Adapters
  may also heartbeat at natural page or batch boundaries. Completion is
  accepted only from the worker that still owns the run.
- Adapter lookup, result validation, and adapter failures all pass through the
  same failure finalizer, release the lease, and remain retryable. A successful
  retry resets the consecutive failure count.
- Result summaries must be JSON objects no larger than 1 MiB. Provider cursors
  remain on `sourceConnection` and advance only inside
  `writeSourceIngestionBatch`, so orchestration cannot acknowledge a partial
  canonical write.

Run one connection with:

```sh
npm run source:sync -- --connection zotero-example
```

Run every active external connection with:

```sh
npm run source:sync -- --concurrency 2
```
