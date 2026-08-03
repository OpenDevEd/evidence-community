# Admin item list

The admin list reads from `adminItemListProjection`, one maintained row per
top-level record. PostgreSQL statement-level triggers use transition tables to
de-duplicate affected roots, then refresh them in the same transaction as item,
draft, PDF, tag, and collection-membership writes. Per-root advisory locks
serialize concurrent metadata and relation changes. This keeps draft edits
immediately visible without coupling every writer to a UI query service.

The API uses an opaque versioned cursor over `(sort value, key)`. Nullable
numeric sorts use direction-specific sentinels and matching expression indexes,
so nulls remain last without adding a non-indexable leading sort expression.
It never uses `OFFSET`; page boundaries remain deterministic for equal and
nullable sort values. A record whose mutable sort value changes between page
requests can move, so the client de-duplicates keys when appending.

Search uses a `pg_trgm` GIN index over normalized projected text. Relation
arrays use GIN indexes. Sortable columns use compound B-tree indexes ending in
the stable record key.

Run local scale checks without persisting seed data:

```sh
DATABASE_URL_POST=postgresql://... npm run benchmark:admin-items -- 100000
```

The benchmark creates an indexed temporary copy, seeds it with nullable values
and heavy sort ties, then runs the exact SQL emitted by
`buildAdminItemListQuery` through `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
It fails if any first or cursor page does not use an index scan, and rolls the
transaction back. Treat timing as machine-specific; compare plans and
regressions on the same host.

Local baseline on 2026-07-31 (milliseconds):

| Rows | First pages | Cursor pages | Search |
| ---: | ---: | ---: | ---: |
| 10,000 | 0.016–0.038 | 0.016–0.038 | 0.424 |
| 100,000 | 0.018–0.136 | 0.017–0.116 | 2.501 |

Every one of the five sort columns in both directions used an `Index Scan` for
both first and cursor pages in the 100,000-row run.
