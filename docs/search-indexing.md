# Database-driven search indexing

PostgreSQL is canonical. Meilisearch is a derived, disposable item projection
maintained from the transactional `outbox`.

## Projection

Every top-level search document contains:

- canonical and provider identity, including source connection and scope;
- all canonical Zotero-style metadata;
- normalized tags and direct collection keys;
- current collection ancestry;
- derived author names, institutions, countries, year, and sortable date;
- child attachment metadata; and
- active attachment full text split into page records.

Child items are embedded in their parent document and never become standalone
search results. A child event reprojects its parent. A tombstoned or missing
top-level item removes the search document.

Collection rows remain in PostgreSQL. A collection event expands its current
descendants and reprojects their member items, so a move, rename, restore, or
deletion cannot leave stale collection facets.

## Delivery guarantees

Each event has a claim owner and expiry. The consumer maintains a heartbeat
while it builds the projection and waits for Meilisearch. Competing workers use
`FOR UPDATE SKIP LOCKED`, exclude entities already covered by an active lease,
and take a transaction-scoped advisory lock before claiming an entity. This
keeps two workers from applying different revisions of the same entity out of
order. An expired claim is recoverable.

Meilisearch mutations are asynchronous tasks. The consumer checks the terminal
task result and writes `processedAt` only after `succeeded`. Request failures,
timeouts, and terminal task failures increment `attempts`, clear the lease, and
set an exponential `nextAttemptAt`. The default 15-attempt schedule starts at
five seconds, caps each delay at one hour, and spans several hours before an
event is dead-lettered. Operators can reset all dead letters through the
explicit requeue command.

Processing is idempotent. A crash after Meilisearch success but before the
PostgreSQL acknowledgment causes the same current document to be written
again. Stale events cannot overwrite a newer canonical revision because every
attempt reads current PostgreSQL state rather than reconstructing historical
event payloads.

The drain claims up to 100 events and coalesces duplicate parent/child work.
Projection reads remain bounded to at most 500 item keys, while outgoing
Meilisearch document requests are split by serialized size and stay below a
20 MiB default budget. A single larger document is sent alone. If Meilisearch
rejects a batch because of document content, the consumer retries those claimed
events individually:
valid events are acknowledged and only the poison event consumes retries or
becomes a dead letter. Transport failures retain the batch because splitting
cannot repair an unavailable service.

## Embedder

Similar Resources, AI search, and chat use Meilisearch hybrid search. Hybrid
search needs an embedder on the index. The library configuration describes it
in `search.embedder`:

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

Start a local Meilisearch:

```sh
docker run -d --name openscholar-local-meilisearch \
  -p 57700:7700 \
  -e MEILI_ENV=development \
  -e MEILI_MASTER_KEY=local-search-key \
  getmeili/meilisearch:v1.37
```

Point `services.search.host` in the local library configuration to
`http://127.0.0.1:57700`, then run:

```sh
npm run search:index
npm run search:index -- --watch
npm run search:index -- --rebuild
npm run search:index -- --requeue-dead-letters
```

`--watch` polls continuously and stops cleanly on `SIGINT` or `SIGTERM`.
`--rebuild` streams current top-level items in batches, then drains the outbox.
`--requeue-dead-letters` resets terminal events to immediately retryable state
and can be combined with either one-shot or watch mode.

## Production worker

Deploy a library with `docker/compose.library.yaml`. It builds the web app and
all current workers from the same commit, starts a private persistent
Meilisearch service, mounts the same runtime config into the application
containers, and makes the search worker apply database migrations before it
starts. The web app waits until the worker is healthy.

Set `LIBRARY_CONFIG_JSON` to the complete validated runtime document, then use
the repository Compose file as the Coolify source of truth. Do not deploy the
web target by itself and do not configure index settings with a separate
Meilisearch command. The worker creates and updates those settings at startup.

`docker/compose.library.yaml` is the only application deployment. It runs the
web app, search worker, source-sync worker, source-writeback worker, and one
private Meilisearch service. The source workers remain idle when no source is
configured.

Use `http://meilisearch:7700` as the runtime search host and set the runtime
search key and `MEILISEARCH_MASTER_KEY` to the same private value. Meilisearch
has no public port and joins only the private application network. The four
runtime containers also join the external `coolify` network to reach shared
PostgreSQL. Coolify's automatic destination-network attachment must stay off.
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

The worker stores its stage, heartbeat, current Meilisearch task and batch,
real batch progress when available, last completion, and last error in
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

- `GET /api/admin/search-index` returns the current worker stage and genuine
  Meilisearch batch progress, plus lightweight pending/failed queue signals;
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
byte-aware requests, asynchronous task failure, retry, dead-letter requeue,
entity lease serialization, expired-lease recovery, and full rebuild:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
MEILISEARCH_HOST=http://127.0.0.1:57700 \
MEILISEARCH_KEY=local-search-key \
npm run test:search-index
```

The worker lifecycle verifier additionally starts an isolated production Next
server and database, then exercises process health, rolling replacement
fencing, historical errors, active PostgreSQL cancellation, durable task
progress, receipt states, targeted and global retry, startup failures, graceful
shutdown, and a real publish-edit-unpublish lifecycle through HTTP and
Meilisearch:

```sh
LIBRARY_CONFIG_PATH=config/library.local.json \
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
npm run test:search-worker
```
