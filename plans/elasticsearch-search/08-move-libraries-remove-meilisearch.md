# Move libraries and remove Meilisearch (plan 08)

Issue: [#722](https://github.com/OpenDevEd/new-el/issues/722).

## Goal

Move every development library to Elasticsearch, then delete Meilisearch
from the product with no fallback left.

## Move each development library

1. Run plan 06's redirect copy.
2. Redeploy with the new runtime image and activate a configuration revision
   with the Elasticsearch host, index, and key.
3. The worker rebuilds from PostgreSQL. Record the rebuild time.
4. Check that the index count equals the library's public record count in
   PostgreSQL, then check search, facets, similar resources, and AI search.
5. After the checks pass and with approval, delete the library's old
   Meilisearch volume with the volume deleter.

## Remove Meilisearch

- `docker/compose.library.yaml`: the `meilisearch` service and its volume.
- `tests/acceptance/compose.yaml` and `tests/embedder/compose.yaml`: one
  Elasticsearch in place of the Meilisearch services.
- `tools/verify/stack.ts`, `tools/runRuntimeAcceptance.ts`,
  `tools/verifyLibraryCompose.ts`, and the volume deleter's
  `<application-uuid>_meilisearch-data` handling.
- The `meilisearch` package and every remaining import.
- `docs/search-indexing.md`, `docs/evidence-library-operations.md`,
  `docs/evidence-library-customization-map.md`, and the runtime rules in
  `docs/agents/project.md`.

The 17 libraries on the `coolify` branch are out of scope and stay as they are.

## Checks

- `rg -i meili` finds nothing outside `plans/` and the off-limits architecture
  document.
- Full CI on `main` passes with both acceptance libraries on one
  Elasticsearch.
- `npm run verify` on one moved development library.

## Done when

The milestone's completion rule in `00-README.md` holds.
