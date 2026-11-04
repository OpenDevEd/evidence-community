# Zotero source adapter

The Zotero adapter is a Web API v3 source. It converts a group
personal library into provider-neutral batches and commits them through the
same transactional writer used by every other source.

## Configuration

A Zotero source is defined once in `LIBRARY_CONFIG_JSON`:

- `key`: the stable source name used by imported records;
- `provider`: `zotero`;
- `groupId`: the Zotero group ID;
- `apiKey`: the Zotero API key;
- `enabled`: whether background import runs;
- `writebackEnabled`: whether records may choose this group as a writeback
  source when they are published;
- `settings`: the strict request settings below.

| Field                   |                  Default | Constraint             |
| ----------------------- | -----------------------: | ---------------------- |
| `apiBaseUrl`            | `https://api.zotero.org` | Absolute URL           |
| `maxConsistencyRetries` |                      `4` | Integer, 1–10          |
| `maxRecordsPerBatch`    |                    `500` | Integer, 1–1,000       |
| `maxSnapshotRecords`    |                 `100000` | Integer, 1–1,000,000   |
| `requestTimeoutMs`      |                  `30000` | Integer, 1,000–120,000 |
| `downloadPdfs`          |                   `true` | Boolean                |

The import and writeback workers read the same manifest entry. Before their
first sweep, they create or update the durable database row automatically.
PostgreSQL keeps the cursor, run history, health, and record links, but never
the API key. The public configuration omits the complete `sources` section.
No extra environment variable or manual source-row setup is needed.

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
- Zotero item versions are stored on both `itemSourceLink.remoteVersion` and
  the corresponding link-scoped `sourceSnapshot.remoteVersion`.
- Inbound identity resolution uses `itemSourceLink`, allowing a native item to
  link to Zotero without changing ownership or creating a second canonical
  record. Locally dirty fields are masked during inbound updates.

## Attachments

The runtime injects the shared PDF and Supabase storage pipeline into the
adapter. A Zotero attachment is published only when it is a PDF, uses Zotero's
`imported_file` or `imported_url` mode, has a parent item, and carries one of the
configured publication tags. Untagged attachments retain their metadata but
have no public URL, extracted text, cover, or `itemFilePublication` row.

With `downloadPdfs` off, the group publishes no PDF, tagged or not. Changing
the setting rereads the whole group once, so PDFs already published come down
and tagged ones go up without waiting for their records to change. The cursor
keeps `pdfs: false` while the last complete read left PDFs out.

Published PDFs are downloaded with total and inactivity timeouts and the
configured byte limit, verified against Zotero's MD5, parsed for bounded full
text, and rendered to a cover image. The PDF and cover use content-addressed
paths under the source connection and are uploaded to the configured public
Supabase bucket. `itemFilePublication` records the immutable object paths,
hash, dimensions, page count, and parent relationship.

Uploads are staged in `sourceFileCleanup` before storage writes. The ingestion
transaction either adopts those objects and queues the prior publication for
deletion or leaves the staged objects queued for retry. Cleanup retries are
durable and dead-letter after five failed attempts. Permanent attachment
problems are recorded in `sourceRecordIssue` without blocking the rest of the
source; transient failures leave the cursor at the preceding completed batch.
Replaying the same Zotero MD5 reuses the existing publication without another
download or upload.

## Dedicated live verification

The live verifier is intentionally limited to the Openscholar Zotero
playground and loopback PostgreSQL, Supabase, and Meilisearch services. It
reconciles the deterministic fixture, runs the real source adapter, drains the
local outbox using its normal claim protocol, and verifies source identities,
read-only draft separation, publication-tag behavior, stored PDF and cover,
cursor health, and search projection:

```sh
LIBRARY_CONFIG_PATH=config/library.local.json \
ZOTERO_OPENSCHOLAR_TEST_API_KEY=... \
npm run test:zotero-live -- \
  --confirm-group 6632364 \
  --confirm-local-writes
```

Both confirmations are mandatory. The verifier also reads the connection row
and refuses unless it is the active `zotero` group connection for `6632364`.
Outbox delivery remains safe if a local search worker is running because both
consumers use the same row-claim and lease protocol.

The local verification server exercises key authentication, strict API v3
headers, parent ordering, one-record checkpoint batches, interruption/resume,
exact replay, incremental updates, hard deletions, and a library-version change
during snapshot reads, plus restoration of an initially unseen trash subtree,
same-window reparenting away from a trashed parent, and membership filtering
through an unchanged nested collection, against the real local PostgreSQL
schema.
