# Index records into Elasticsearch (plan 03)

Issue: [#719](https://github.com/OpenDevEd/new-el/issues/719).

## Goal

The search worker writes to Elasticsearch with the same delivery guarantees
it gives today, and loads large libraries many times faster.

## Scope

1. Replace the Meilisearch client in the worker with `@elastic/elasticsearch`
   9.5.x, authenticated with the library's login from `services.search`.
2. Build the mapping from today's settings in `ensureSearchIndex()`:
   - the filterable fields become `keyword` fields, and `year` an integer;
   - the sort fields (`citationCount`, `dateSortKey`, `fullNames`, `title`,
     `year`, `dateAdded`, `updatedAt`) get doc values;
   - text fields use the ICU tokenizer with folding;
   - the worker indexes PDF page text only when the library has full-text
     search on, as today.
   Each index has one primary shard unless plan 01 shows a library needs more.
3. Write outbox batches with the bulk API, keeping the 20 MiB size split. Use
   `refresh: wait_for`, so a receipt marked indexed is already searchable.
4. Classify bulk failures:
   - when Elasticsearch rejects a document for its content, the worker
     retries that event alone and dead-letters it alone, as today;
   - transport errors, 429, and 5xx keep the whole batch for retry.
5. Rebuild into a new index `el_<id>_<timestamp>`, with refresh off and no
   replicas during the load. Refresh it, move the library's alias to it in one
   step, then delete the old index. Search answers from the old index until
   the move. The backlog-rebuild rule stays as it is.
6. Report admin progress from the worker's own sent and total counts, in place
   of Meilisearch batch progress. The admin endpoints keep their shape.
7. Limit bulk concurrency per worker, so one library's rebuild leaves CPU for
   other libraries' searches.

## Invariant change

The project rule "a Meilisearch request is complete only after its task
succeeds" becomes "an Elasticsearch write is complete only after every bulk
item succeeded and the change is searchable". Plan 08 updates
`docs/agents/project.md`.

## Checks

- Unit tests cover the mapping builder and bulk failure classification.
- `npm run test:search-index` and `npm run test:search-worker`, rewritten
  against Elasticsearch: document shape, collection reprojection, re-parent
  cleanup, deletion, restore, size-split batches, poison-document isolation,
  retry, dead-letter requeue, lease serialization, and an alias-swap rebuild
  that never answers with an empty index.
- The outbox lock-order integration tests keep passing unchanged.
- Rebuild plan 01's 500,000-record library through the worker, embeddings off.
  It must finish at least 5 times faster than Meilisearch on the same host.

## Files

- `src/lib/search-index/consumer.ts`, `bootstrap-state.ts`, `worker-state.ts`
- `src/lib/meilisearch-factory.ts` and `src/lib/meilisearch.ts`, replaced by
  one Elasticsearch client module
- `tools/runSearchIndexer.ts`, `tools/verifySearchOutbox.ts`,
  `tools/verifySearchIndexerWorker.ts`
- the matching `tests/unit/search-index-*` tests

## Done when

A development library indexes fully into Elasticsearch through the worker, its
receipts reach indexed, and a rebuild moves the alias without an empty result.
