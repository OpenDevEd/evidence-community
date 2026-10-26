# One shared Elasticsearch for library search

Milestone: `EL-32 — Search libraries of any size with one shared Elasticsearch`.
Read the root `AGENTS.md`, `docs/agents/project.md`, and `plans/AGENTS.md`
for how to work. This file lists only the task facts.

## Problem

Each library runs its own Meilisearch inside `docker/compose.library.yaml`.
Two costs block running many libraries:

- A small library costs as much as a large one. Every library's Meilisearch
  gets the same 8 indexing threads and 8 GiB, whatever its size, inside one
  56 GB budget for all libraries on the host
  (`docker/compose.library.yaml`, `meilisearch` service).
- Indexing is slow. The best documented run is 103,688 records in 7.9 minutes,
  about 220 records a second (`docs/search-indexing.md`). The team's
  Elasticsearch loads about 500,000 records in a few minutes. A library of
  20 million records takes hours in Meilisearch.

## Fixed decisions (2026-10-26, Hassan)

1. One Elasticsearch serves every library. It is separate from OpenScholar's
   research Elasticsearch on ode-hitzner-2, so library loads never slow
   OpenScholar search. Plan 01 decides which host runs it.
2. Each library copies its public records into its own index, as it does in
   Meilisearch today. Libraries do not read OpenScholar's 238M-paper index.
3. PostgreSQL stays the source of truth. The index stays a copy that the
   search worker rebuilds from PostgreSQL and keeps current from the outbox.
4. Elasticsearch runs on the free Basic licence, pinned to 9.5.5 (released
   2026-10-06; OpenScholar's engine runs 9.5.4). Basic includes API keys,
   role-based access control, and vector search. It does not include RRF, the
   linear retriever, the Inference API, or `semantic_text`, so this plan uses
   none of them.
5. Each library gets an Elasticsearch login and role limited to its own
   indexes. The database provisioner creates and removes them, the same way it
   creates the library's PostgreSQL database and login. OpenScholar sends the
   library's saved search key as the password, so a repeated call gives the
   same result.
6. `services.search` keeps its shape. `host` is the shared Elasticsearch,
   `index` is the library's alias and login name, and `key` is the password.
   The configuration schema does not change.
7. Plan 08 removes Meilisearch completely once every development library runs
   on Elasticsearch. No fallback engine stays in the code.

This replaces decisions 2 and 3 of `plans/tenant-isolated-deployment`
(a private Meilisearch per library). See the decision change note in that
plan's README.

## Plans and issues

| Plan | Issue | Depends on |
|---|---|---|
| [01 Size Elasticsearch on a real library](01-size-on-a-real-library.md) | [#717](https://github.com/OpenDevEd/new-el/issues/717) | None |
| [02 One Elasticsearch for every library](02-shared-elasticsearch.md) | [#718](https://github.com/OpenDevEd/new-el/issues/718) | 01 |
| [03 Index records into Elasticsearch](03-index-records.md) | [#719](https://github.com/OpenDevEd/new-el/issues/719) | 02 |
| [04 Search, filter, and page](04-search-filter-page.md) | [#721](https://github.com/OpenDevEd/new-el/issues/721) | 03 |
| [05 Similar resources and AI search](05-similar-and-ai-search.md) | [#720](https://github.com/OpenDevEd/new-el/issues/720) | 03 |
| [06 Cache and redirects in PostgreSQL](06-cache-and-redirects.md) | [#716](https://github.com/OpenDevEd/new-el/issues/716) | None |
| [07 OpenScholar creates the search login](07-openscholar-setup.md) | [openalex-count#963](https://github.com/OpenDevEd/openalex-count/issues/963) | 02 |
| [08 Move libraries and remove Meilisearch](08-move-libraries-remove-meilisearch.md) | [#722](https://github.com/OpenDevEd/new-el/issues/722) | 03 to 07 |

Plan 06 can land at any time, while Meilisearch still runs.

## One owner per shared rule

| Rule | Owner |
|---|---|
| Index names, login names, and role privileges | the provisioner (plan 02) |
| Index mapping and the search document | `src/lib/search-index/` (plan 03) |
| Query translation and the facet result shape | the search client module that replaces `src/lib/meilisearch*.ts` (plan 04) |
| Embedding text, vectors, and their reuse | the search worker (plan 05) |
| Fusion of keyword and vector results | the search client module (plan 05) |

## Code to reuse

- `src/lib/search-index/projection.ts` builds the search document. Keep it; only
  the writer changes.
- `src/lib/search-index/consumer.ts` owns claims, leases, retries, dead
  letters, size-split batches, and backlog rebuilds. Keep that logic and swap
  the Meilisearch calls.
- `src/lib/deployment/library-database-provisioner-http.ts` and
  `library-database.ts` already derive per-library names from the library ID
  behind a bearer token. The search endpoints follow the same contract.
- OpenScholar's research note `research_notes/Scholarly search quality
  improvements/elasticsearch_relevance_tuning.md` (repository
  `suzuya1331/openalex`, section 4) lists what Basic includes and gives the
  weighted RRF formula to use in the application.

## Data migration

- Search documents: nothing moves. Each library rebuilds from PostgreSQL.
- Vectors: re-embedded once per library at its move. Plan 01 times and prices
  this.
- Redirects: copied from each library's Meilisearch `redirects` index into
  PostgreSQL before Meilisearch goes (plan 06). Nothing in this repository
  writes that index, so most libraries should have none; the copy prints the
  count.
- Statistics cache: disposable, not copied.
- Configuration: OpenScholar activates a new revision with the new host,
  index, and key. Old revisions stay as they are.
- Rollback: until plan 08 deletes a library's Meilisearch volume, redeploy the
  previous runtime image with the previous configuration revision.

## Checks

Each plan names its focused checks. The final gate is the full CI run on
`main` with both acceptance libraries on one Elasticsearch, then a live
`npm run verify` check of one development library.

## Done when

Every development library searches through the shared Elasticsearch.
Meilisearch is gone from the code, Compose files, tests, tools, and docs.
`docs/agents/project.md` names Elasticsearch in its runtime rules. OpenScholar
setup creates and removes a library's search login.

## Risks

- Result order changes. Meilisearch ranks with typo tolerance, word proximity,
  and prefix matching by default. Plan 01 saves a baseline and plan 04 compares
  against it.
- Deep pages. Elasticsearch returns at most 10,000 results through page
  offsets by default. Plan 04 decides how pages past that work.
- Shared CPU. A 20-million-record rebuild slows other libraries' searches.
  Plan 03 limits bulk concurrency, and plan 02's acceptance test measures the
  effect.
- Languages. Meilisearch splits Chinese, Japanese, and Thai text into words by
  itself. Elasticsearch needs the ICU analysis plugin, so plan 02 builds the
  image with it.
- One node has no replica. If it stops, search stops until it restarts, and a
  rebuild from PostgreSQL restores it. Revisit before launch.

## Sources

- Elastic subscriptions, tiers checked 2026-10-26: https://www.elastic.co/subscriptions
- Elasticsearch 9.5.5 release: https://github.com/elastic/elasticsearch/releases/tag/v9.5.5
- Paginate search results: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- ICU analysis plugin: https://www.elastic.co/docs/reference/elasticsearch/plugins/analysis-icu
- Size your shards: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards
- Tune for indexing speed: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed
- Dense vector field: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dense-vector
- Create or update roles: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-security-put-role
