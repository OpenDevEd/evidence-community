# One Elasticsearch for every library (plan 02)

Issue: [#718](https://github.com/OpenDevEd/new-el/issues/718).

## Goal

Run one private Elasticsearch on the host chosen in plan 01, and give each
library a login that reaches only its own indexes.

## Scope

1. `docker/elasticsearch.Dockerfile` builds Elasticsearch 9.5.5 with the
   `analysis-icu` plugin.
2. `docker/compose.search.yaml` runs one node with security on, a named data
   volume, the heap from plan 01, and no published port. It joins one external
   network, `library-search`, and nothing else. It deploys as its own Coolify
   application.
3. `docker/compose.library.yaml`: `web` and `search-indexer` also join
   `library-search`. The `meilisearch` service stays until plan 08.
4. The database provisioner gains two endpoints, behind the same bearer token:
   - `POST /v1/library-search/reconcile` with `{ "libraryId", "password" }`
     creates or updates role `el_<id>` with index privileges on `el_<id>` and
     `el_<id>_*`, and native user `el_<id>` with that password and role. It
     returns `{ "libraryId", "outcome", "host", "index" }`.
   - `POST /v1/library-search/remove` with `{ "libraryId" }` deletes the
     library's indexes, user, and role.
   Callers cannot send names, hosts, or privileges. Names come from the same
   derivation as the database names in `src/lib/deployment/library-database.ts`.
5. New provisioner environment: the Elasticsearch admin URL and credentials,
   and the host written into each library's configuration.

## Checks

- Unit tests cover name derivation and request validation for both endpoints.
- Real-service tests run against a local Elasticsearch container:
  - calling reconcile twice gives the same login, and it still works;
  - a library's login reads and writes its own alias and indexes, and gets 403
    on another library's;
  - remove deletes the indexes, user, and role.
- `tools/verifyLibraryCompose.ts` proves Elasticsearch has no published port
  and joins only `library-search`.
- In the acceptance stack, both libraries share one Elasticsearch. While one
  rebuilds, the other's searches still answer. Record its p95 search latency
  during the rebuild.

## Files

- `docker/elasticsearch.Dockerfile`, `docker/compose.search.yaml` (new)
- `docker/compose.library.yaml`, `src/lib/deployment/library-compose-contract.ts`
- `src/lib/deployment/library-database-provisioner-http.ts` and one new
  library-search module beside it
- `tools/verifyLibraryCompose.ts`, `tests/acceptance/compose.yaml`
- `docs/evidence-library-operations.md`

## Done when

Elasticsearch runs healthy on the chosen host, the deployed provisioner
serves both search endpoints, and the checks above pass against them.
