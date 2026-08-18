# Plan 02 — Draft field, publish transaction, and public read path

## Goal

An editor's link changes live in the record draft, are saved with the record when it is published, update both records' pages, and the public item page shows Cites, Cited by and Related resources from the new table.

## Scope and design

**Draft pseudo-field.** Add `links: { cites: string[]; related: string[] }` next to `collections` and `tags`:

- `publishedAdminItemPayload` (`src/lib/admin/item-draft-patch.ts:61-62`) reads the record's `manual` outgoing rows and sets `payload.links`.
- Validation (`native-item-validation.ts:410-441`): each list is unique canonical keys, max 500 per kind, no self key. Returned as `links` on `ValidatedNativeItemDraft`.
- The patch algebra (`item-draft-merge.ts`) needs no change; `links` is one JSON value. `createItemDraftPatch` compares it deeply through `equalJsonValue`.

**Publish.** In `publishItemDraftWithContext` (`native-item-service.ts:696`), after collection replacement (`:918-927`):

1. Load current `manual` outgoing rows for the item.
2. Compute added/removed per kind.
3. Verify every target exists and is not hard-deleted (a soft-deleted target is allowed; it stays hidden). Missing target → `AdminValidationError` on field `links`.
4. Delete removed `manual` rows, insert added `manual` rows. Never touch `source:` rows.
5. Insert an outbox row `{ entityType: "item", entityKey: <otherKey>, operation: "upsert", revision: <that item's current revision + 1> }` for every added or removed target, bumping the target's revision the same way parents are bumped (`:947-959`), and add those to `indexingRecords` so the receipt flow clears their cache tags (`src/lib/admin/cache.ts:9-25`).
6. `changedFields` for writeback must **not** include `links` (like `collections` at `:967-969`). Plan 04 decides when related links reach Zotero.

Unpublish (`:1213`) and restore need no link change (D10). `removeNativeItem` (`:1390`) relies on FK cascade.

**Admin detail.** `getAdminItemDetail` (`library-query-service.ts:252-390`) returns `links`, `publishedLinks`, and `incomingLinks: { citedBy: AdminLinkTarget[], relatedTo: AdminLinkTarget[] }` where `AdminLinkTarget = { key, title, itemType, deleted, origin }`. Outgoing lists also carry title/type/origin for display, resolved with one `IN` query on `item`. Types in `src/lib/admin/types.ts:80-95`.

**Public read path.**

- New server helper use: `getPublicItemLinks(db, key)` from Plan 01 in the item page loader that renders `ItemPage`, passed down to `Relations.tsx` as `links` (`{ cites, citedBy, related }`) plus `sameAs: string[]` from `relations["owl:sameAs"]`.
- `Relations.tsx`: delete `extractCitesKeys`/`extractCitedByKeys`; "Related resources" keys = `links.related ∪ sameAs`; hide a tab whose count is 0 unless it is the only tab. Cards still load through `POST /api/items/batch` (`route.ts:42-104`).
- `ItemPage.tsx:1255-1290` passes the new props; the header stat block at `:621-626` (`cited_by`, `referenced_works`) is unchanged.
- `GET /api/citations/[key]` (`route.ts`): read `citedBy` keys from PostgreSQL via `getPublicItemLinks`, then keep the Meilisearch keyed lookup for cards and facets (`:50-107`). `totalCitations = citedByKeys.length`. Delete the `cited_by` fallback (`:153-156`).
- Cache: the item page loader that calls `getPublicItemLinks` must be inside the same cached scope as the item (`item-<key>` tag) so the receipt flow clears it. `item-citation-source-<key>` (`src/lib/citations.ts:151-153`) is unaffected.

## Test-first steps

1. Failing unit tests for validation: duplicates collapse, self key rejected, non-canonical key rejected, >500 rejected, missing `links` means "no change".
2. Failing unit tests for `publishedAdminItemPayload` + `createItemDraftPatch`: adding a link produces a patch with only `links`; reverting to the published set removes the field.
3. Extend `tools/verifyItemLinks.ts` (real PostgreSQL): open draft → save `links` → publish → rows exist with `origin = manual`; outbox rows exist for the item and each target with a bumped revision; removing a link on the next publish deletes only that row; a `source:` row on the same pair is untouched; publishing a link to a missing key fails with field `links` and writes nothing.
4. Failing unit test for `Relations.tsx` (`tests/unit/`): three tabs render from `links`; empty tab hidden; only tab shown even when empty; counts match.
5. Failing route test for `/api/citations/[key]` with a mocked Meilisearch and a seeded PostgreSQL row set (or extend the verifier if the route is not unit-testable).
6. Implement, then run the full lists below.

## Files

- `src/lib/admin/item-draft-patch.ts`, `native-item-validation.ts`, `native-item-service.ts`, `library-query-service.ts`, `types.ts`
- `src/lib/links/item-links.ts`
- `src/components/features/newlib/Relations.tsx`, `ItemPage.tsx`, the item page loader under `src/app/[locale]/lib/[key]/`
- `src/app/api/citations/[key]/route.ts`
- `tests/unit/relations.test.tsx` (new), validator and draft tests
- `tools/verifyItemLinks.ts`
- i18n: reuse `ui.relatedResources`, `ui.cites`, `ui.citedBy` (`src/messages/*.json:169-170, 459-462`); no new keys unless the empty state needs one, then add it to all nine message files.

## Migration choice

None. Plan 01 created the table.

## Exact tests

```sh
npx vitest run tests/unit/relations.test.tsx
npx vitest run tests/unit   # validator, draft-patch, admin-cache tests
npm run test:item-links
npm run test:native-lifecycle
npm run test:search-index
npx tsc --noEmit
npm run lint
```

## Runtime check

On the local stack: publish record A with `links.cites = [B]`. Confirm in PostgreSQL: one `itemLink` row, two outbox rows. Confirm the search worker processes both (`npm run test:search-worker` or the worker log). Open A's public page: "Cites" shows B. Open B's page: "Cited by" shows A. Unpublish B: A's "Cites" tab disappears (count 0). Restore B: it returns.

## Completion rules

- Draft, publish, admin detail and public page all read the table. Nothing reads `relations.cites` or `relations.citedBy` anywhere (`grep -rn "citedBy\|\"cites\"" src` returns only i18n labels).
- Both records reindex and both caches clear on publish.
- All listed tests pass.

## Risks

- Bumping a target's revision while that target has an open draft: reuse `advanceOpenItemDraftBaseRevision` (`native-item-service.ts:70`) exactly as parents do, or the target's next publish fails the revision check.
- Two editors publishing A→B and B→A at once: rows differ by PK, no conflict. Same pair, same kind, from the same record is serialised by the existing advisory lock (`lockItemMutations`).
- `Relations.tsx` is a client component; do not fetch links there. Pass them from the server loader.
