# Source ingestion contract

This branch uses a greenfield, provider-neutral source model. Existing Evidence
Library databases and deployments are not migrated or modified.

## Identity

- `item.key` and `collection.key` are immutable, library-wide canonical keys.
- Canonical keys use Zotero's eight-character object-key alphabet:
  `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`.
- A compatible provider key is adopted when unused. Otherwise the writer mints
  a canonical key and retains the provider key in `sourceRecordKey`.
- `itemIdentity` and `collectionIdentity` reserve keys before record writes.
  Reservations are never replaced by a later source and make concurrent
  allocation safe.
- Provider identity is unique by `(sourceConnectionKey, sourceRecordKey)`.
- A removed source connection is retained with `status = 'removed'`; records
  never lose their permanent origin.

## Connections

- The built-in native connection is exactly `native`.
- Zotero, Mendeley, DSpace, EPrints, and OpenAlex may each have multiple
  connections in one Evidence Library.
- Duplicate non-null remote scopes for the same provider are rejected.
- OpenAlex queries are mutable configuration. Separate OpenAlex connections may
  intentionally hold the same query because connection identity, scheduling,
  and import history remain independent.
- Credentials are referenced by `credentialRef`; secrets are not stored in the
  source record.

## Canonical records

- `revision` is the monotonic canonical record revision.
- `sourceSnapshot.remoteVersion` is the provider's revision, ETag, cursor
  version, or equivalent.
- The former `item.version` and `collection.version` fields do not exist.
- Parent items, parent collections, and aliases must belong to the same source
  connection.
- Collection membership may cross connections intentionally. This permits a
  native curated collection to combine records from multiple providers.
- Tags and collection memberships are normalized through `itemToTag` and
  `itemToCollection`; the canonical item table does not duplicate either list.
- `sourceSnapshot` applies to bibliographic items. Collection synchronization
  uses the collection row's canonical revision and the connection cursor.

## Native drafts and publication

- Native drafts live only in `itemDraft`; editing a draft never mutates the
  published `item` row.
- There is exactly one active draft per native item key. `draftRevision`
  provides optimistic concurrency and `baseRevision` prevents publishing over
  a newer canonical record.
- Draft payloads are complete Zotero-style snapshots validated against the
  pinned Zotero schema. All 40 item types, their fields, and their allowed
  creator roles use that single schema source.
- Publishing replaces the complete editable metadata snapshot, normalized
  tags, and normalized collection memberships in one transaction, increments
  the canonical revision, emits one outbox event, and removes the draft.
- Unpublishing retains the canonical row as a tombstone and emits a delete
  event. Repeated unpublish requests are idempotent. Canonical identities are
  not recycled after publication.
- Opening a draft from a tombstoned native item is the explicit restore path;
  publishing that draft clears the tombstone and emits a new upsert revision.
- The temporary backend gate is `ADMIN_AUTH_BYPASS=true`. Every
  `/api/admin/items/**` response is private and non-cacheable. Clerk token
  verification will replace this gate when OpenScholar integration begins.

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

Collection documents must contain canonical `key`, `sourceConnectionKey`,
`sourceRecordKey`, `provider`, `sourceExternalScopeKey`, and derived ancestry.
The indexer must consume the transactional outbox and acknowledge an event only
after Meilisearch accepts the corresponding upsert or deletion.

## Write ordering

Parent foreign keys are deliberately immediate. A source adapter must therefore
use a two-pass write:

1. upsert items and collections with parent fields set to `NULL`;
2. resolve provider keys to canonical keys and update parent fields.

The canonical writes, normalized memberships/tags, current source snapshot, and
outbox event commit in one PostgreSQL transaction. Only then may the connection
cursor advance.
