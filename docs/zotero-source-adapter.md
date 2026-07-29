# Zotero source adapter

The Zotero adapter is a read-only Web API v3 source. It converts a group or
personal library into provider-neutral batches and commits them through the
same transactional writer used by every other source.

## Connection

A Zotero `sourceConnection` uses:

- `provider`: `zotero`;
- `scopeKind`: `group` or `personal-library`;
- `externalScopeKey`: the Zotero group or user ID;
- `credentialRef`: optional resolver reference, such as
  `env:ZOTERO_API_KEY` for the local worker;
- `config`: the strict object below.

| Field                   |                  Default | Constraint             |
| ----------------------- | -----------------------: | ---------------------- |
| `apiBaseUrl`            | `https://api.zotero.org` | Absolute URL           |
| `maxConsistencyRetries` |                      `4` | Integer, 1–10          |
| `maxRecordsPerBatch`    |                    `500` | Integer, 1–1,000       |
| `maxSnapshotRecords`    |                 `100000` | Integer, 1–1,000,000   |
| `requestTimeoutMs`      |                  `30000` | Integer, 1,000–120,000 |

The database stores only the credential reference. A resolver supplies the
actual API key to the worker. Public libraries can omit both. When a key is
configured, the adapter verifies that it can read the exact group or personal
library before syncing.

## Incremental snapshot

The cursor begins as `{}` and becomes:

```json
{
	"libraryVersion": 123,
	"softTrashedCollectionKeys": ["ABCD2345"],
	"softTrashedItemKeys": ["WXYZ2345"]
}
```

The adapter follows Zotero's full-library sync protocol:

1. request changed collection and item version maps with `since`;
2. request the deletion log with the same `since`;
3. fetch changed objects in groups of at most 50;
4. require the same `Last-Modified-Version` on every response;
5. restart the read if Zotero changes during the snapshot;
6. commit parent-before-child batches through the transactional writer.

Library versions are opaque monotonic integers. They are never incremented or
predicted locally.

Large snapshots use a durable partial cursor:

```json
{
	"libraryVersion": 123,
	"softTrashedCollectionKeys": ["ABCD2345"],
	"softTrashedItemKeys": ["WXYZ2345"],
	"pending": {
		"targetVersion": 180,
		"offset": 1500,
		"snapshotSince": 123
	}
}
```

Every committed batch advances the offset atomically with its records. A
restart re-reads the same snapshot scope and resumes at the offset when the
target is unchanged. If Zotero advanced meanwhile, the adapter starts the new
manifest at zero; replayed records are idempotent, so no changes are lost. The
soft-trash key sets are durable source state: when any such key becomes active,
the adapter performs a full snapshot so descendants that did not change while
their parent was trashed are restored too. The sets include unchanged
descendants discovered from the local graph, so later item deltas cannot
reintroduce memberships into an already-trashed collection subtree.
`maxSnapshotRecords` places an explicit memory bound on one remote snapshot.

## Mapping

- Zotero item and collection keys remain provider identities and are adopted as
  canonical keys when globally available.
- Zotero item metadata is validated against the vendored Zotero schema.
- Zotero's special note, attachment-note, and annotation fields are stored as
  canonical item columns even though they are outside the bibliographic field
  lists in Zotero's schema response.
- `parentItem`, `parentCollection`, tags, and collection memberships become
  normalized relationships rather than duplicated metadata fields.
- Trashed and permanently deleted Zotero objects become canonical tombstones.
  A trashed item or collection cascades to its descendant subtree so active
  children never point at a missing or active-looking parent. Incremental
  cascades include already-local descendants, but a changed record's current
  Zotero parent always overrides its stale local parent. Memberships into the
  complete tombstoned collection subtree are removed in the same batch.
- If an existing canonical tombstone is restored remotely, the adapter
  performs a full stable snapshot so unchanged descendants and memberships
  are restored with it. The durable soft-trash state also covers objects first
  observed in trash and therefore never previously assigned a canonical row.
- The full Zotero response is retained as the raw source snapshot.
- Zotero object URLs become immutable source aliases.
- Zotero item versions become `sourceSnapshot.remoteVersion`.

The adapter has no Zotero writeback in v1.

## Attachments

The adapter accepts an injected attachment processor. The processor receives
the original Zotero attachment response and may reuse the existing
download/PDF/Supabase pipeline to return public file metadata. File processing
is outside the database transaction and must therefore be idempotent. A failed
processor leaves the durable
cursor at the preceding completed batch, so the attachment resumes safely.

The local verification server exercises key authentication, strict API v3
headers, parent ordering, one-record checkpoint batches, interruption/resume,
exact replay, incremental updates, hard deletions, and a library-version change
during snapshot reads, plus restoration of an initially unseen trash subtree,
same-window reparenting away from a trashed parent, and membership filtering
through an unchanged nested collection, against the real local PostgreSQL
schema.
