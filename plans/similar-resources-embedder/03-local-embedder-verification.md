# Plan 03: Prove it against a real local Meilisearch

## Goal

One command proves enable, change, disable, rebuild, and hybrid search with a real Meilisearch and a local REST embedder, on two indexes, with no OpenAI calls.

## Scope and design

1. Add `tests/embedder/compose.yaml`: one `getmeili/meilisearch:v1.37` service on a fresh host port (pick one not used by `tests/acceptance/compose.yaml` or `tools/verifySearchOutbox.ts`; for example `57710`), `MEILI_MASTER_KEY: embedder-test-key`, `MEILI_NO_ANALYTICS: "true"`, health check copied from the acceptance `x-meilisearch-service`, and the command flag `--experimental-allowed-ip-networks` so Meilisearch may call the stub on the host. Do not add this flag to `docker/compose.library.yaml`.
2. Add `tools/verifySearchEmbedder.ts` (`npm run test:search-embedder`):
   - Start an in-process HTTP server (Node `http`) that accepts `{ "input": "<text>" }` and returns `{ "embedding": [fixed 8 numbers derived from the text length] }`. Bind to `0.0.0.0` on a free port so the Meilisearch container can reach it via `host.docker.internal` (Mac) or the compose gateway; read the reachable host from `EMBEDDER_STUB_HOST` with a sensible default and print it.
   - Read `MEILISEARCH_HOST` (default `http://127.0.0.1:57710`) and `MEILISEARCH_KEY` (default `embedder-test-key`).
   - For two index names (`embedder-a`, `embedder-b`), build a `MeilisearchService` with the factory, add ~5 small documents shaped like `ItemSearchDocument` (title, abstract, fullNames, tags, year), and run:
     1. `applySearchIndexEmbedder` with a `rest` embedder pointing at the stub, `dimensions: 8` → assert task succeeded, `getEmbedders()` has only `default`, index stats `numberOfEmbeddedDocuments === numberOfDocuments`.
     2. Hybrid search `hybrid: { embedder: PLATFORM_SEARCH_EMBEDDER, semanticRatio: 0.7 }` → hits returned, no error.
     3. Change: apply again with a different `request` template → task succeeded, stub received new requests, stats still equal.
     4. Disable: apply `null` → `getEmbedders()` is empty, hybrid search now fails with `invalid_search_embedder` (assert the code).
     5. Rebuild: apply the `rest` embedder again, delete all documents, re-add them → stats equal again.
   - Print one JSON line per step and exit non-zero on the first failed assertion.
3. Add `README` lines to `docs/search-indexing.md`: how to start the compose file and run the script.
4. Record the answer to Plan 02 step 3 (`{ openai: null }` on a missing name) in Plan 02 and adjust `buildEmbedderSettings` if needed.

## Test-first steps

1. Write the script's assertions first, run it against the empty container, watch it fail on step 1.
2. Land Plan 02's worker code, rerun until every step passes.
3. Run the script twice in a row to prove it is repeatable (it must clean its two indexes at start).

## Files

- `tests/embedder/compose.yaml` (new)
- `tools/verifySearchEmbedder.ts` (new)
- `package.json` (`test:search-embedder`)
- `docs/search-indexing.md`

## Data migration

None.

## Deployability gate

`docker compose -f tests/embedder/compose.yaml up -d --wait` then `npm run test:search-embedder` exits 0 with the five step lines. `npm run lint`, `npx tsc --noEmit`, `npm run test:unit` pass.

## Completion rules

- All five steps pass on both indexes, twice in a row.
- `numberOfEmbeddedDocuments === numberOfDocuments` after enable, change, and rebuild.
- Hybrid search with the name `default` returns hits; after disable it fails with `invalid_search_embedder`.
- The stub was called; no request left the machine.
- Hosted libraries were not touched.

## Risks

- Meilisearch inside Docker must reach the host stub. If `host.docker.internal` is not resolvable, use `extra_hosts: ["host.docker.internal:host-gateway"]` in the compose file.
- Meilisearch may cache embedder responses; use distinct texts per document.
