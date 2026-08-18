# Plan 01 — Link table, migration, validator cleanup, and Zotero "related" on sync

## Goal

Store every link between two records once in PostgreSQL. Bring Zotero "Related" links into that table on every sync. Stop storing `cites`/`citedBy` in JSON.

## Scope and design

**Table** `itemLink` in `packages/evidence-library-core/src/schema.ts` (re-exported from `src/db/schema/`):

- `fromKey` varchar(8), FK `item.key` cascade
- `toKey` varchar(8), FK `item.key` cascade
- `kind` text: `cites` | `related` (check)
- `origin` text: `manual` | `source:<sourceConnectionKey>` (check: `manual` or starts with `source:`)
- `createdAt`, `updatedAt` timestamps
- PK `(fromKey, toKey, kind)`; check `fromKey <> toKey`; index `itemLink_to_idx (toKey, kind)`; index `itemLink_origin_idx (origin, fromKey)`.

**Link read helpers** in a new `src/lib/links/item-links.ts` (pure SQL, no UI):

- `getOutgoingLinks(db, key, { kind? })` → rows ordered by `createdAt`.
- `getIncomingLinks(db, key, { kind? })`.
- `getPublicItemLinks(db, key)` → `{ cites: string[], citedBy: string[], related: string[] }` where `related` is the union of both directions, de-duplicated, and every listed key belongs to an item with `deleted = 0`.
- `replaceSourceRelatedLinks(tx, { sourceConnectionKey, fromKeys, links })` → deletes rows with `origin = source:<key>` and `kind = related` for `fromKeys`, inserts the given rows, and never touches `origin = manual`.

**Validator cleanup**: remove `citedBy` and `cites` from the `relations` schema in `src/lib/admin/native-item-validation.ts:106-107`. `cited_by`, `referenced_works`, `owl:sameAs`, `dc:relation` stay. The TypeScript `RelationsType` in `src/types/item.ts` and its readers (`Relations.tsx`, `ItemHeader.tsx`, `Resource.tsx`, `/api/citations/[key]`) are changed in Plan 02 together with the read-path swap, so every commit compiles.

**Zotero on sync**: in `src/lib/source-ingestion/transactional-writer.ts`, right after the tag and collection replacement for `changedItemKeys` (`:1288-1345`):

1. Read `metadata.relations["dc:relation"]` from each changed item record (string or string array of Zotero URIs like `http://zotero.org/groups/<gid>/items/<KEY>` or `.../users/<uid>/items/<KEY>`).
2. Parse the trailing item key with a new pure helper `parseZoteroItemUri(uri)` → `{ libraryType, libraryId, itemKey } | null` in `src/lib/source-ingestion/zotero/uri.ts`.
3. Resolve keys with the existing `loadIdentityMap(transaction, "item", sourceConnectionKey, keys)` (`:307-355`). Only keys in the same source connection resolve. Anything else is unresolved.
4. Call `replaceSourceRelatedLinks` for the changed items. Skip self-links.
5. Count unresolved URIs and return them in the sync result. Zotero returns `{ batches, records, targetVersion }` (`zotero/sync.ts:885-890`); add `unresolvedRelations: number`. The orchestrator already persists that object (`orchestrator.ts:299-347`), so it shows in `sourceSyncRun.result` and `sourceSyncState.lastResult`.

Zotero stores a "related" pair on both items, so a sync usually produces two directed rows (A→B and B→A). That is expected. Public reads de-duplicate.

**Migration** `drizzle/0035_item-links.sql`: create table, indexes, checks, and `UPDATE item SET relations = relations - 'cites' - 'citedBy' WHERE relations ?| array['cites','citedBy']`. See the README for renumbering if the writeback branch merges first.

## Test-first steps

1. Add failing unit tests for `parseZoteroItemUri` (groups, users, trailing slash, non-item URLs, garbage) in `tests/unit/zotero-item-uri.test.ts`.
2. Add failing unit tests for the validator: `relations` with `cites`/`citedBy` is rejected; `owl:sameAs`, `dc:relation`, `cited_by`, `referenced_works` still pass (`tests/unit/native-item-validation.test.ts` or the existing validator test file).
3. Add the schema table and generate the migration. Run `npm run schema:check`.
4. Write `src/lib/links/item-links.ts` with a real-database verifier `tools/verifyItemLinks.ts` (same style as `tools/verifySourceModel.ts:364-375`) that proves: PK blocks duplicates, check blocks self-links, delete cascades from `item`, `getPublicItemLinks` hides deleted targets and de-duplicates `related`, `replaceSourceRelatedLinks` leaves manual rows alone. Add `npm run test:item-links`.
5. Add failing coverage in `tools/verifySourceIngestionWriter.ts` (`npm run test:source-writer`): a Zotero batch with `dc:relation` to an item in the same source creates a `related` row with `origin = source:<key>`; a second sync without that relation deletes it; a manual row on the same pair survives; an unresolvable URI is counted, not stored.
6. Implement the writer step and the counter. Delete nothing else in the writer.
7. Update `docs/source-ingestion-contract.md` "Write ordering" (`:165-217`) with one bullet: "Related-link replacement is scoped to the source being ingested and to `related` rows only."

## Files

- `packages/evidence-library-core/src/schema.ts` (new table), `src/db/schema/source.ts` or the matching re-export file
- `drizzle/0035_item-links.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0035_snapshot.json`
- `src/lib/links/item-links.ts` (new)
- `src/lib/source-ingestion/zotero/uri.ts` (new)
- `src/lib/source-ingestion/transactional-writer.ts`
- `src/lib/source-ingestion/zotero/sync.ts` (result shape)
- `src/lib/admin/native-item-validation.ts`, `src/types/item.ts`
- `tests/unit/zotero-item-uri.test.ts`, validator tests
- `tools/verifyItemLinks.ts` (new), `tools/verifySourceIngestionWriter.ts`, `package.json` scripts
- `docs/source-ingestion-contract.md`

## Migration choice

Clean breaking change on a fresh local database. No backfill from JSON arrays. Do not run on hosted libraries.

## Exact tests

```sh
npx vitest run tests/unit/zotero-item-uri.test.ts
npx vitest run tests/unit --reporter=dot   # validator tests included
npm run schema:check
npm run test:item-links
npm run test:source-writer
npm run test:source-model
npm run test:zotero-source
npx tsc --noEmit
npm run lint
```

## Runtime check

Start the local stack (`docker/compose.library.yaml` or the acceptance stack in `tests/acceptance/compose.yaml`) against the fresh database, run `npm run db:migrate`, then run one Zotero sync with the playground group and confirm `sourceSyncRun.result` contains `unresolvedRelations` and that `itemLink` has `related` rows for playground items that are related in Zotero. `npm run test:zotero-live` must pass.

## Completion rules

- `itemLink` exists with the constraints above; `npm run schema:check` is green.
- The validator rejects `cites`/`citedBy`; no test fixture uses them. (`src/types/item.ts` and its readers change in Plan 02.)
- A Zotero sync creates, replaces and removes `source:` related rows and never touches `manual` rows.
- Unresolved relations are counted in the sync result.
- All listed tests pass.

## Risks

- Zotero URIs may use `users/<id>` for personal libraries. The parser must accept both and the resolver must only match the current source connection.
- Deleting `cites`/`citedBy` from `relations` also changes Meilisearch documents (the row is spread into the document, `src/lib/search-index/projection.ts:166-175`). That is fine; a full reindex is not required because nothing reads them from the index after Plan 02.
- The counter must not fail the sync. Unresolved is a normal state.
