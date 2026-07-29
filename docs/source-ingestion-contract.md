# Source ingestion contract

This branch uses a greenfield, provider-neutral source model. Existing Evidence
Library databases and deployments are not migrated or modified.

## Identity

- `item.key` and `collection.key` are immutable, library-wide canonical keys.
- Canonical keys use Zotero's eight-character object-key alphabet:
  `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`.
- A compatible provider key is adopted when unused. Otherwise the writer mints
  a canonical key and retains the provider key in `sourceRecordKey`.
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
