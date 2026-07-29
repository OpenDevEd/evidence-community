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
