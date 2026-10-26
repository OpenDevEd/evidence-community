# Database-driven search indexing

PostgreSQL is canonical. A library searches the engine its configuration
chooses (`services.search.engine`): its own index on the host's shared
Elasticsearch, written through the library's alias and signed in as its own
login (see "Run the shared Elasticsearch" in
`docs/evidence-library-operations.md`), or its private Meilisearch. Either index
is a derived, disposable item projection maintained from the transactional
`outbox`.

## Projection

Every top-level search document contains:

- canonical and provider identity, including source connection and scope;
- all canonical Zotero-style metadata;
- normalized tags and direct collection keys;
- current collection ancestry;
- derived author names, institutions, countries, year, and sortable date;
- open access: an editor's choice in `/admin` (`item.openAccess`), else the
  `is_oa` of the newest OpenAlex version among the copies of the record's work
  that the library's current searches still find, else what OpenAlex said
  about the DOI the record shows (`itemOpenAccessLookup`), else null. Taking a
  search out of the library, or putting it back, searches its records again.
  The source worker looks at records from other sources, unless an editor
  chose, when they change or the library mints them a DOI, asks OpenAlex about
  a new DOI, 100 DOIs a request, and asks about every DOI again after 30 days;
- child attachment metadata; and
- active attachment full text split into page records. The page text is
  indexed only when the library has full-text search on; otherwise only the
  page numbers are kept, which still mark records that have a PDF. Switching
  full-text search rebuilds the index.

Child items are embedded in their parent document and never become standalone
search results. A child event reprojects its parent. A tombstoned or missing
top-level item removes the search document.

Collection rows remain in PostgreSQL. A collection event expands its current
descendants and reprojects their member items, so a move, rename, restore, or
deletion cannot leave stale collection facets.

## Delivery guarantees

Each event has a claim owner and expiry. The consumer maintains a heartbeat
while it builds the projection and writes it. Claims in one library
take a single transaction-scoped advisory lock, so they run one at a time; each
claim then uses `FOR UPDATE SKIP LOCKED` and skips entities already covered by
an active lease. This keeps two workers from applying different revisions of
the same entity out of order, with one lock per claim rather than one per
event: PostgreSQL's lock table is shared by every library database on the
server. An expired claim is recoverable.

The worker writes each claim with Elasticsearch's bulk API, and its last
request waits until the change is searchable (`refresh: wait_for`), so
`processedAt` means readers can find it. Elasticsearch answers for each record:
a record it refuses for its content (a mapping or parsing error) fails the
claim with `SearchIndexDocumentError`, and the claim is halved until the event
behind that record is found, so only that event retries. An overload (429),
a server error, or a failed request keeps the whole claim for retry. Failures
increment `attempts`, clear the lease, and set an exponential `nextAttemptAt`. Each event in a failed batch is marked on
its own, so a lease lost on one event does not leave its batch siblings leased
until the lease expires; the error the worker logs names the failure that
caused it. The default 15-attempt schedule starts at
five seconds, caps each delay at one hour, and spans several hours before an
event is dead-lettered. Operators can reset all dead letters through the
explicit requeue command.

Processing is idempotent. A crash after a successful write but before the
PostgreSQL acknowledgment causes the same current document to be written
again. Stale events cannot overwrite a newer canonical revision because every
attempt reads current PostgreSQL state rather than reconstructing historical
event payloads.

The drain claims up to 5,000 events and coalesces duplicate parent/child work.
It works on three claims at once, so one claim is projected while another is
written.

A very large backlog is faster to index as a rebuild. When at least 50,000
events wait and they cover at least a quarter of the records, the worker saves
the list of waiting events, rebuilds the index, and then acknowledges exactly
those events: the rebuild read every record after they were committed. Events
written during the rebuild stay queued and are drained afterwards.

A rebuild fills a new index, `<alias>_<timestamp>`, with refresh off, one write
in flight while the next records are projected, and then moves the library's
alias to it in one step. Readers search the old index until then. The old index,
and any a stopped rebuild left behind, are deleted. Elasticsearch then merges
the new index into one segment in the background: on AIED that halves search
time (about 55 to 26 ms at the 95th percentile), and the rebuild does not wait
for it. A worker may write a change
to the old index, and acknowledge its event, after the rebuild read that record;
every event acknowledged after the rebuild started is therefore put back once
the alias moves, and the drain writes it again. On AIED (282,948 records) a
rebuild takes about 5 to 8 minutes; reading the records from PostgreSQL is the
slower half.

Projection reads remain bounded to at most 500 item keys, while outgoing bulk
requests are split by serialized size and stay below a 20 MiB default budget. A
single larger document is sent alone.

The index is created by the worker from `src/lib/search-index/elasticsearch-index.ts`.
Its version is part of the projection signature, so a changed definition marks
a rebuild as pending and the worker rebuilds into a new index at its next start.

## Switching engines

Only the chosen engine's index is kept current. `status.searchEngine` names the
engine whose index holds every record, and readers search it; each web process
reads it at most every 5 seconds, and searches the configured engine while it
is empty. When the worker starts with another engine configured, it builds that
engine's index while readers stay on the old one, then sets
`status.searchEngine`, puts back the events acknowledged meanwhile, and deletes
the old index 10 seconds later, once no reader still searches it. A library
upgraded from before engines were recorded keeps its index and records its
engine without a rebuild; if its configuration already names the other engine,
readers stay on the engine that holds its records until the new index is built.
If Meilisearch's embedder fails while its index already holds records, the
switch waits, and readers and the worker's writes stay on the old engine.

The worker drains no changes while it rebuilds, so readers see changes made
during a switch only once it completes: minutes into Elasticsearch, longer into
Meilisearch with an embedder, which embeds every record again.

To switch, publish a configuration revision that changes only
`services.search.engine` and keeps the old engine's connection. Remove the old
connection only once `status.searchEngine` names the new engine: without it,
readers search the new index while it is still being built. An old index a
stopped switch left behind is deleted at the worker's next start.

Prove a switch on a real library with both engines' connections (it switches to
the other engine and back, and fails if a reader's public result count ever
drops below PostgreSQL's):

```sh
LIBRARY_CONFIG_PATH=<library with both connections> npm run test:search-switch
```

Check the outbox worker on either engine:

```sh
SEARCH_ENGINE=meilisearch MEILISEARCH_URL=http://127.0.0.1:7700 \
  DATABASE_URL_POST=postgresql://... npm run test:search-index
```

## Embedder

On a Meilisearch library, Similar Resources, AI search, and chat use
Meilisearch hybrid search. Elasticsearch stores no embeddings yet
(OpenDevEd/new-el#720): its libraries show no Similar Resources, and AI search
and chat rank by words alone. Hybrid search needs an embedder on the index. The
library configuration describes it in `search.embedder`:

- `null` turns embeddings off. Related resources cannot be enabled.
- `{ "source": "openAi", "model": "text-embedding-3-small", "apiKey": "…" }`
  uses OpenAI through Meilisearch.
- `{ "source": "rest", "url": "…", "request": { … "{{text}}" … }, "response": { … "{{embedding}}" … } }`
  uses any HTTP embedding service.

The worker writes the embedder under the fixed name `default`
(`PLATFORM_SEARCH_EMBEDDER`) when it starts, together with the platform
document template (`src/lib/search-index/embedder-settings.ts`) and
`documentTemplateMaxBytes: 8000`. Meilisearch embeds every record inside that
one settings task, so the worker waits up to 60 minutes for it. If the task
fails, the worker logs the error, records it as `lastError`, and keeps indexing
records without embeddings. Setting `search.embedder` to `null` removes the
embedder and its vectors.

Changing `search.embedder` needs a search-worker restart. Check
`GET /indexes/<index>/stats`: `numberOfEmbeddedDocuments` must equal
`numberOfDocuments`.

To prove the embedder flow against a real Meilisearch without any paid
provider, start the dedicated test container and run the script. It starts a
local REST embedder stub, then checks enable, search, change, disable, and
rebuild on two indexes:

```sh
docker compose -f tests/embedder/compose.yaml up -d --wait
npm run test:search-embedder
docker compose -f tests/embedder/compose.yaml down
```

If port 57710 is taken, pick another one for both steps:

```sh
EMBEDDER_TEST_MEILI_PORT=57730 docker compose -f tests/embedder/compose.yaml up -d --wait
MEILISEARCH_HOST=http://127.0.0.1:57730 npm run test:search-embedder
```

## Local operation

Start a local Elasticsearch with the ICU plugin, and give the local library a
login named after its `services.search.elasticsearch.index`, with its
`services.search.elasticsearch.key` as the password (the database provisioner
does this on a host):

```sh
docker build -f docker/elasticsearch.Dockerfile -t evidence-library-elasticsearch:9.5.5 .
docker run -d --name evidence-library-local-elasticsearch \
  -p 127.0.0.1:59200:9200 \
  -e discovery.type=single-node \
  -e ELASTIC_PASSWORD=local-search-password \
  -e xpack.security.http.ssl.enabled=false \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  evidence-library-elasticsearch:9.5.5
```

Set `services.search.engine` to `elasticsearch` and
`services.search.elasticsearch.host` in the local library configuration to
`http://127.0.0.1:59200`, then run:

```sh
npm run search:index
npm run search:index -- --watch
npm run search:index -- --rebuild
npm run search:index -- --requeue-dead-letters
```

`--watch` polls continuously and stops cleanly on `SIGINT` or `SIGTERM`.
`--rebuild` streams current top-level items into a new index, moves the alias to
it, then drains the outbox. Search keeps answering from the old index until the
alias moves.
`--requeue-dead-letters` resets terminal events to immediately retryable state
and can be combined with either one-shot or watch mode.

## Production worker

Deploy a library with `docker/compose.library.yaml`. It runs the web app and all
four workers from the same immutable image, starts private persistent
Meilisearch and private ephemeral Redis, mounts the same writable runtime
configuration volume into the application containers, and makes the search
worker apply database migrations before it starts. The web app waits until the
required workers and Redis are healthy.

Set `LIBRARY_CONFIG_JSON` to the complete validated seed document, then use the
repository Compose file as the deployment source of truth. Ordinary
configuration publishes replace the active file in the shared volume through
the authenticated runtime API; they do not redeploy the stack. Do not deploy
the web target by itself and do not configure index settings with a separate
Meilisearch command. The worker creates and updates those settings at startup.

`docker/compose.library.yaml` is the only application deployment. It runs the
web app, search worker, source-sync worker, source-writeback worker,
publication worker, private Meilisearch, and private Redis. The source workers
remain idle when no source is configured.

Use `http://meilisearch:7700` as the runtime search host and set the runtime
search key and `MEILISEARCH_MASTER_KEY` to the same private value. Meilisearch
has no public port and joins only the private application network. The five
runtime containers also join the external deployment network to reach shared
PostgreSQL. Automatic destination-network attachment must stay off.
Meilisearch runs with `MEILI_UPGRADE_DB`, so a newer pinned image migrates the
existing search data in place when it starts. It also runs with
`MEILI_EXPERIMENTAL_LEGACY_SEARCH`: Meilisearch's newer search path
builds every result before the requested page, which made the deepest page of
a 1M-record library take 18 s; the legacy path returns the same totals, facets
and hits (apart from the order of exactly tied scores) in under 0.2 s. Check
this again before each Meilisearch upgrade. Removing the variable does not
always switch the legacy path off: any `PATCH /experimental-features` sent while
it is on stores `legacySearch: true`, so read `GET /experimental-features`.
If the named search volume is new, the worker records a pending rebuild in
PostgreSQL before creating the index. It clears that marker only after the full
rebuild succeeds. An interrupted rebuild resumes before health becomes ready.

Build the dedicated worker target from the same revision as the web image:

```sh
docker build --target search-indexer -t evidence-library-search-indexer .
```

Run one worker service per library. Mount the same runtime configuration used
by the web service and give the service a stable logical worker identity:

```sh
docker run -d \
  --name evidence-library-search-indexer \
  --restart unless-stopped \
  -e LIBRARY_CONFIG_PATH=/runtime/library.json \
  -e SEARCH_INDEX_WORKER_ID=search-indexer-1 \
  -v /srv/evidence-library/runtime:/runtime:ro \
  evidence-library-search-indexer
```

The worker stores its stage, heartbeat, the number of events it is indexing,
last completion, and last error in
PostgreSQL. The container health check fails while startup is still preparing
the index, when its durable heartbeat is more than twenty seconds old, or when
that heartbeat belongs to a replacement container generation.
Delivery errors remain visible across restarts and clear only after a later
event succeeds. Database migrations must be applied before a new worker
revision starts.

## Admin observability

Published admin mutations return an `indexingReceipts[]` set with one receipt
for every outbox row committed by their transaction. Each receipt contains an
entity type, canonical key, and revision.
Returning the complete set matters when an attachment is moved between parents:
the update is finished only after the attachment, previous parent, and new
parent receipts are indexed. Draft and upload-staging changes do not return
receipts because they do not affect the public search projection.

The admin application uses three private, non-cacheable endpoints:

- `GET /api/admin/search-index` returns the current worker stage, plus
  lightweight pending/failed queue signals;
- `POST /api/admin/search-index/receipts` resolves up to 100 exact receipts as
  queued, processing, retrying, indexed, failed, or unknown. Before it returns
  an indexed receipt, it immediately expires the affected Next.js item,
  citation, metadata, or collection cache tags; and
- `POST /api/admin/search-index/retry` explicitly requeues selected failed
  receipts or all failed receipts. It never resets active, queued, or already
  indexed work.

Overview polling intentionally does not calculate queue counts. This keeps the
hot status request bounded as a library's outbox history grows. Exact progress
belongs to the mutation's receipt set, and callers wait until every receipt in
that set reaches `indexed`. The admin shows final publish, restore, unpublish,
file, collection, and bulk success only after that wait finishes. Public API
and proxy cache headers are a separate policy and are not changed by this flow.

The real-service verifier creates isolated indexes and proves document shape,
collection reprojection, re-parent cleanup, tombstone deletion, restoration,
byte-aware requests, a refused record, retry, dead-letter requeue, entity lease
serialization, expired-lease recovery, a full rebuild, and a change written to
the old index while a rebuild runs:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
ELASTICSEARCH_URL=http://127.0.0.1:59200 \
ELASTICSEARCH_PASSWORD=local-search-password \
npm run test:search-index
```

The worker lifecycle verifier additionally starts an isolated production Next
server and database, then exercises process health, rolling replacement
fencing, historical errors, active PostgreSQL cancellation, durable task
progress, receipt states, targeted and global retry, startup failures, graceful
shutdown, and a real publish-edit-unpublish lifecycle through HTTP and
Elasticsearch. It creates its test libraries' logins as the administrator:

```sh
LIBRARY_CONFIG_PATH=config/library.local.json \
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
ELASTICSEARCH_ADMIN_URL=http://elastic:local-search-password@127.0.0.1:59200 \
EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE='<cookies from a signed-in browser>' \
npm run test:search-worker
```

The cookies must come from the library in `LIBRARY_CONFIG_PATH`; see "Real-service
admin sign-in" in the operations guide for signing in with a Clerk test user
instead.
