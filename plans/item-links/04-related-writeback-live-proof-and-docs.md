# Plan 04 — Send "related" links to Zotero, prove it live, and document

**Starts after** `codex/per-record-source-writeback` has merged to `openscholar` and this branch has been rebased on it. Rebase note: regenerate `drizzle/0035_item-links.sql` as the next free number (0037 if the writeback branch merged 0035 and 0036) and fix `drizzle/meta/_journal.json`.

## Goal

When a record is written back to a Zotero source, its "related" links appear in Zotero as Zotero's own Related links, and Zotero's existing Related links are not wiped. "Cites" is never sent.

## Scope and design

**Mapper.** In `src/lib/source-writeback/zotero/mapper.ts`:

- `createZoteroItemPayload` (`:205-247`) and `createZoteroItemPatch` (`:249+`) receive a new input `relatedRemoteUris: string[]` and set `data.relations["dc:relation"]` to that list (string when one, array when many, omitted when empty). Existing Zotero/Mendeley predicates from the record's `relations` JSON (`owl:sameAs`, Mendeley UUIDs) are kept through `zoteroRelations` (`:124-130`); `dc:relation` from the JSON is **replaced** by the computed list so the table is the only authority for related links.
- Delete the `data.relations = {}` default at `:222` in favour of "always build relations from the JSON predicates plus the computed `dc:relation`".

**Consumer.** In `src/lib/source-writeback/consumer.ts` where the item payload is built (`:601`, `:763`), compute `relatedRemoteUris` for the job's source connection:

1. Related keys = union of outgoing and incoming `related` rows for the item (both directions, because Zotero shows a pair only when both items list each other).
2. For each related key, look up `itemSourceLink` for the same `sourceConnectionKey`; keep only those with a `sourceRecordKey`.
3. Build the URI from the source connection (`groupId` → `http://zotero.org/groups/<groupId>/items/<sourceRecordKey>`; user libraries use `users/<userId>`). Reuse `parseZoteroItemUri`'s inverse in `src/lib/source-ingestion/zotero/uri.ts` (`formatZoteroItemUri`).
4. Related records that are not linked to that source are skipped. Nothing is created remotely.

**When it is sent.** Publishing a record whose `links.related` changed marks the record writeback-dirty for its enabled sources (add `links` to the dirty computation in `native-item-service.ts:967-1000` for `related` changes only). The other end of the pair is also marked dirty for the same source when it is linked there, so Zotero gets both sides. Cites changes never mark dirty.

**Ingest loop guard.** A writeback of `dc:relation` will come back on the next sync as `source:` rows. Plan 01's `replaceSourceRelatedLinks` only touches `source:` rows and the pair already exists as `manual`, so the PK `(from, to, kind)` collision must be handled: if a `manual` row exists for the pair, the sync does not insert a `source:` duplicate (skip, keep manual). Add this rule to `replaceSourceRelatedLinks` and its verifier.

## Test-first steps

1. Failing unit tests in `tests/unit/zotero-write-mapper.test.ts`: `dc:relation` set from `relatedRemoteUris`; JSON `dc:relation` ignored; `owl:sameAs` kept; empty list omits the key; patch mode clears the key when the list becomes empty.
2. Failing unit tests for `formatZoteroItemUri` (groups and users).
3. Extend `tools/verifySourceWriteback.ts` (`npm run test:source-writeback`, fake adapter, real PostgreSQL): a manual related pair where both records are linked to the source produces a job whose payload has both URIs on both records; a related record not linked to the source is skipped; a cites change does not create a job.
4. Extend `tools/verifyItemLinks.ts`: sync after writeback keeps the manual row and adds no duplicate.
5. Implement mapper, consumer and dirty marking.
6. Live proof with `tools/verifyLiveZoteroWriteback.ts` (`npm run test:zotero-writeback-live`) against the Zotero playground group: create two library records that are both linked to the playground source, publish A with `related = [B]`, run the writeback worker, read both Zotero items through the API and confirm each lists the other under `dc:relation`; remove the link, publish, confirm both are cleared; confirm an unrelated `owl:sameAs` on A survived.
7. Docs: update `docs/source-writeback.md` (what is and is not written back), `docs/source-ingestion-contract.md` (related-link rules), `docs/evidence-library-architecture.md:29, 211` (relations flow now names the link table).
8. Outline, after the push: add a dated section to "04 — Evidence Library Current State" (`57d9f73d-4fce-430d-b0ad-da11903141b6`) that says what shipped (commit, branch), that hosted libraries need the item-links migration before deploying that commit, and the exact steps: back up, `npm run db:migrate`, run one full source sync so Zotero Related links are resolved, spot-check one item page. Add one line to "06 — Current Decisions" (`636ce019-6fe6-4a4e-918b-95e0912cc92d`): links are first-class; JSON `cites`/`citedBy` are gone. Read both pages back.

## Files

- `src/lib/source-writeback/zotero/mapper.ts`, `src/lib/source-writeback/consumer.ts`
- `src/lib/source-ingestion/zotero/uri.ts` (add `formatZoteroItemUri`)
- `src/lib/links/item-links.ts` (manual-wins rule)
- `src/lib/admin/native-item-service.ts` (dirty marking for related)
- `tests/unit/zotero-write-mapper.test.ts`, `tests/unit/zotero-item-uri.test.ts`
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
