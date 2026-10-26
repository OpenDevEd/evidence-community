# Size Elasticsearch on a real library (plan 01)

Issue: [#717](https://github.com/OpenDevEd/new-el/issues/717).

## Goal

Measure Elasticsearch on real records before building on it. The results
decide the host and the memory setting, price the re-embedding, and save a
baseline of today's results for plan 04.

## Scope

1. Take a real development library of about 500,000 records and a
   100,000-record sample of it. Build their documents with
   `projectPublicItems()` from `src/lib/search-index/projection.ts`.
2. Load both into Elasticsearch 9.5.5 (one node, ICU plugin, draft mapping
   from plan 03) with the bulk API, refresh off during the load. Record load
   time, records a second, disk, and heap and resident memory after the load
   and when idle. Embeddings stay off for these timings.
3. Record the same library's Meilisearch rebuild time on the same host,
   embeddings off, from a run or the worker's saved progress.
4. Embed 10,000 records with the library's configured embedder. Record the
   time and the cost per record, then work out the cost and time for every
   current development library.
5. Write a fixed set of 50 real queries with their filters, sorts, and scopes.
   Use reader queries from the library's analytics where they exist. For each
   query, save the top 20 record keys and the p50 and p95 latency from both
   engines, plus the facet request and page 500.
6. Commit the comparison as `tools/compareSearchEngines.ts`. It takes the
   query file and two engine settings, reports every query including failed
   ones, and prints a per-query overlap table. Plan 04 runs it again.

## Host decision

Run Elasticsearch on the library host when the measured memory and disk for
all current libraries fit in the libraries' share once their Meilisearch
containers go. Otherwise propose a separate server with its monthly cost and
wait for approval.

## Where it runs

On a server, not a laptop. Ask before starting, since it uses server time and
memory.

## Done when

- This plan lists the numbers above under "What we learned" and
  "Next move".
- Plan 02 names the chosen host and heap size.
- The repository has `tools/compareSearchEngines.ts` and its query file.
