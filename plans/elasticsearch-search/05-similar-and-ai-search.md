# Similar resources and AI search (plan 05)

Issue: [#720](https://github.com/OpenDevEd/new-el/issues/720).

## Goal

Similar resources and AI search keep working without the Enterprise-only
features. Meilisearch embeds records and mixes keyword and vector results by
itself. On Basic, the worker embeds and the application mixes.

## Scope

1. Port `PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE` to a TypeScript function with the
   same fields and the same 8,000-byte limit.
2. The worker calls the library's configured embedder. `search.embedder` keeps
   its shape: OpenAI, or REST with the `{{text}}` and `{{embedding}}`
   templates. It stores the vector in a `dense_vector` field, with a hash of
   the embedded text and an embedder fingerprint.
3. Before embedding a record, the worker reads the stored hash and vector for
   the same key from the live alias. It reuses the vector when both match, so
   rebuilds don't pay for embeddings again. Changing `search.embedder`
   re-embeds; setting it to `null` drops the vectors.
4. When the embedder fails, the worker indexes the record without a vector,
   saves the error as `lastError`, and retries the record later, as today.
5. Similar resources runs a keyword search on the record's description and a
   `knn` search with the record's stored vector, with no embedding call. It
   leaves out the record itself, and weights 0.3 keyword and 0.7 vector.
6. AI search embeds the question, runs keyword and `knn` searches in one
   `_msearch`, and weights them 0.5 and 0.5.
7. Both mix results with weighted reciprocal rank fusion in the application:
   `score = Σ weight / (60 + rank)`, Elastic's formula, as in OpenScholar's
   research note.

## Checks

- Unit tests check that the embedding text matches today's template output
  for the same records, and the fusion order for fixed ranked lists.
- `npm run test:search-embedder` against Elasticsearch with the local REST
  stub and no paid provider: enable, search, change, disable, rebuild with
  vector reuse.
- On a development library, similar resources and AI search answer from
  Elasticsearch.

## Done when

No similar-resources or AI search code uses Meilisearch, and the checks pass.
