# Plan 04 — Send "related" links to Zotero, prove it live, and document

**Revised 2026-08-18 (execution).** `codex/per-record-source-writeback` had not merged when Plans 01–03 finished, and the user asked for the whole plan now. Plan 04 is therefore implemented on the current base (`origin/openscholar@a413cede`). The touch points are the same on both branches: the consumer builds one payload per job and source, and `markItemWritebackDirty` marks every enabled link. When the writeback branch merges, rebase this branch, resolve `consumer.ts` / `native-item-service.ts` conflicts, and regenerate `drizzle/0035_item-links.sql` as the next free number (0037 if the writeback branch merged 0035 and 0036) with a fixed `drizzle/meta/_journal.json`.

## Goal

When a record is written back to a Zotero source, its "related" links appear in Zotero as Zotero's own Related links, and Zotero's existing Related links are not wiped. "Cites" is never sent.

## Scope and design

**Where the value comes from.** The consumer, not the mapper, decides `dc:relation`. In `src/lib/source-writeback/consumer.ts` where the item payload is built (`publishedAdminItemPayload(...)` at `:583`), a new helper `relatedRemoteUris(transaction, { itemKey, sourceConnection })` (in `src/lib/source-writeback/related-links.ts`) computes the list and the consumer sets `payload.relations = { ...zoteroPredicatesFromJson, "dc:relation": <string | string[]> }` (key omitted when empty). The mapper keeps its existing `zoteroRelations` filter (`mapper.ts:110-130`) and passes the value through, so `createZoteroItemPayload` / `createZoteroItemPatch` need no signature change. The JSON `dc:relation` on the record is never sent; the table is the only authority.

**Which rows become URIs.**

1. Outgoing `related` rows of any origin (manual and source). Source rows are Zotero's own state, so keeping them stops a writeback from erasing links a Zotero user made.
2. Incoming **manual** `related` rows (an editor linked B→A from B's side; Zotero shows a pair only when both items list each other).
3. Incoming **source** rows are excluded. They are Zotero's mirror of a link on the other item and re-sending them from this side keeps a removed link alive.
4. Only targets with an `itemSourceLink` on the same source connection and `remoteDeleted = false` produce a URI: `http://zotero.org/groups/<externalScopeKey>/items/<sourceRecordKey>` (or `users/...` for `personal-library`), via `formatZoteroItemUri` from Plan 01.

**When it is sent.** Publishing a record whose manual `related` set changed marks that record writeback-dirty with field `relations` (`native-item-service.ts` dirty computation, `:967-1000`). Only that record is marked: Zotero mirrors `dc:relation` onto the other item by itself (verified against the playground group on 2026-08-18: patching one item's `dc:relation` produced the reverse relation on the other item, and clearing it removed the mirror without bumping the other item's version). Cites changes never mark dirty.

**Keeping both sides honest after removal.** Because Zotero clears the mirrored side without bumping its version, the mirrored `source:` row on the other record would linger until that record changes. So when a manual `related` A→B is removed at publish, the publish transaction also deletes the `source:` row B→A for the sources this record writes back to. The next sync of B restores it if Zotero still has it.

**Ingest guard.** A writeback of `dc:relation` comes back on the next sync as `source:` rows. `replaceSourceRelatedLinks` inserts with `ON CONFLICT DO NOTHING`, so a `manual` row on the same pair wins and no duplicate is created (already covered in `tools/verifyItemLinks.ts`).

## Test-first steps

1. Failing unit tests for `relatedLinkUris` (pure part of `related-links.ts`): outgoing manual + source rows and incoming manual rows become URIs; incoming source rows are skipped; targets without a link on this source or `remoteDeleted` are skipped; one URI is a string, several are an array; group vs user scope.
2. Failing unit tests in `tests/unit/zotero-write-mapper.test.ts`: a payload whose `relations` carries `dc:relation` and `owl:sameAs` maps both; a `links` field is ignored (already green).
3. Extend `tools/verifyItemLinks.ts` (real PostgreSQL): publishing a manual `related` change marks the record dirty with `relations` for its writeback link and creates one job; publishing a `cites` change creates none; removing a manual related A→B deletes the mirrored source row B→A for that source; the manual-wins rule on resync (already green).
4. Extend `tools/verifySourceWriteback.ts` (`npm run test:source-writeback`, fake adapter, real PostgreSQL): the payload the adapter receives carries `relations["dc:relation"]` with the linked target's URI when both records are linked to the source, and no key when the target is not linked.
5. Implement helper, consumer, dirty marking, and the mirrored-row cleanup.
6. Live proof with `tools/verifyLiveZoteroWriteback.ts` (`npm run test:zotero-writeback-live`) against the playground group: two records linked to the playground source, publish A with `related = [B]`, run writeback, read both Zotero items and confirm each lists the other under `dc:relation`; remove the link, publish, confirm both are cleared; confirm an unrelated `owl:sameAs` on A survived.
7. Docs: `docs/source-writeback.md`, `docs/source-ingestion-contract.md`, `docs/evidence-library-architecture.md:29, 211`.
8. Outline, after the push: add a dated section to "04 — Evidence Library Current State" (`57d9f73d-4fce-430d-b0ad-da11903141b6`) with what shipped (commit, branch), that hosted libraries need the item-links migration before deploying that commit, and the exact steps: back up, `npm run db:migrate`, run one full source sync so Zotero Related links are resolved, spot-check one item page. Add one line to "06 — Current Decisions" (`636ce019-6fe6-4a4e-918b-95e0912cc92d`). Read both pages back.

## Files

- `src/lib/source-writeback/related-links.ts` (new), `src/lib/source-writeback/consumer.ts`
- `src/lib/source-ingestion/zotero/uri.ts` (`formatZoteroItemUri`, done in Plan 01)
- `src/lib/links/item-links.ts` (mirrored-row cleanup helper)
- `src/lib/admin/native-item-service.ts` (dirty marking for related)
- `tests/unit/related-links.test.ts` (new), `tests/unit/zotero-write-mapper.test.ts`
- `tools/verifySourceWriteback.ts`, `tools/verifyItemLinks.ts`, `tools/verifyLiveZoteroWriteback.ts`
- `docs/source-writeback.md`, `docs/source-ingestion-contract.md`, `docs/evidence-library-architecture.md`

## Migration choice

None beyond the renumbering note above.

## Exact tests

```sh
npx vitest run tests/unit/zotero-write-mapper.test.ts tests/unit/zotero-item-uri.test.ts
npm run test:item-links
npm run test:source-writeback
npm run test:zotero-writeback-live
npm run test:zotero-live
npm run test:unit
npx tsc --noEmit
npm run lint
git diff --check
```

The two live commands only change the Zotero playground group and the local database.

## Runtime check

The live proof in step 6 is the runtime check. Also confirm the writeback worker log shows one job per side and no retries.

## Completion rules

- Zotero shows the pair as Related on both items after one publish.
- Removing the link clears it on both items.
- `owl:sameAs` and Mendeley predicates survive.
- Cites never reaches Zotero.
- Docs and both Outline pages are updated and read back after the push.

## Risks

- Zotero rejects a `dc:relation` URI that points at an item the API key cannot see. Only emit URIs for records with a live `itemSourceLink` in the same source.
- Marking the other side dirty can loop if both sides mark each other on every publish. Only mark on an actual `related` change, and only once per publish transaction.
- If the writeback branch changed the payload builder signature, follow its shape and revise this plan first (`docs: [plan-04] revise Scope — <reason>`).
