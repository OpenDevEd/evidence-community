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
the required search worker from the same commit, mounts the same runtime config
into both, and makes the search worker apply database migrations before it
starts. The web app waits until the worker is healthy.

Set `LIBRARY_CONFIG_JSON` to the complete validated runtime document, then use
the repository Compose file as the Coolify source of truth. Do not deploy the
web target by itself and do not configure index settings with a separate
Meilisearch command. The worker creates and updates those settings at startup.

`docker/compose.library.yaml` always runs the web app and one search worker.
For a library with source connections, first deploy that base stack and wait
for the search worker to become healthy. Then deploy
`docker/compose.sources.yaml` as a second Coolify application using the same
commit and `LIBRARY_CONFIG_JSON`. The second file runs the source-sync and
source-writeback workers without relying on Compose profiles.

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
  queued, processing, retrying, indexed, failed, or unknown; and
- `POST /api/admin/search-index/retry` explicitly requeues selected failed
  receipts or all failed receipts. It never resets active, queued, or already
  indexed work.

Overview polling intentionally does not calculate queue counts. This keeps the
hot status request bounded as a library's outbox history grows. Exact progress
belongs to the mutation's receipt set, and callers wait until every receipt in
that set reaches `indexed`.

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
