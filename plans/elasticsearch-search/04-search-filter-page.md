# Search, filter, and page (plan 04)

Issue: [#721](https://github.com/OpenDevEd/new-el/issues/721).

## Goal

Every public read that uses Meilisearch today answers from Elasticsearch, with
the same filters, sorts, and facets, and comparable results.

## Decision (2026-10-26)

Page numbers work up to result 10,000, Elasticsearch's default window (page
500 at 20 a page). Past it, results continue with next and previous only,
using `search_after`. Raising the window to the 10,000,000 that
`SEARCH_RESULT_LIMIT` allows would let one request sort a million records.
Totals stay exact (`track_total_hits: true`).

## Scope

1. Text queries search the scope's `attributesToSearchOn` with
   `multi_match`, `fuzziness: AUTO`, and prefix matching on the last word
   (`bool_prefix`).
2. Filters become a `bool` filter of `term`, `terms`, and `range` clauses,
   replacing `src/lib/meilisearch-filter.ts`.
3. Facets become `terms` aggregations (up to 10,000 values, ordered by count,
   as now). One function turns them into today's `facetDistribution` shape,
   so the components and hooks that read it don't change.
4. `multiSearch` becomes `_msearch`.
5. Export (`src/lib/library-export-selection.ts`) pages with a point in time
   and `search_after`, keeping its 20,000-record cap. Its Meilisearch task
   check becomes a check for pending outbox events.
6. Sitemaps read public record keys from PostgreSQL, since they need offsets
   far past 10,000.
7. Move every other reader: `src/lib/search.ts`, `src/lib/country.ts`, the
   statistics queries, `src/app/api/citations/[key]`, `src/app/api/items/batch`,
   the keyword path in `src/lib/ai/tools.ts`, `src/lib/openscholar/library-reads.ts`,
   `src/lib/admin/openscholar-tag-reads.ts`, and `src/lib/actions.ts`.

## Checks

- Unit tests cover query, filter, and facet translation, and the facet shape
  function.
- Rerun `tools/compareSearchEngines.ts` from plan 01 on the 50-query set:
  - report top-10 overlap with Meilisearch for every query, and review every
    query under 50% by hand;
  - p95 latency for search, facets, and page 500 must be no worse than
    Meilisearch's on the same host.
- `npm run verify -- shift` on the results page (search, filters, sort,
  page 2, page 500), an item page, and statistics.

## Done when

No public read uses Meilisearch, this plan records the comparison, and the
browser check passes.
