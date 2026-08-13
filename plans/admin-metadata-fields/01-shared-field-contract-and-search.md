# Plan 01: Shared field contract and search

## Goal

Make the record editor, server validation, Zotero field mapping, and
Meilisearch agree about what every metadata field means.

## Scope

- Add a schema-owned codec between Zotero fields and canonical fields.
- Replace the 58 alias database columns with canonical storage.
- Add one shared admin field contract.
- Add controls for bibliographic dates, access dates, URLs, identifiers,
  multiline text, and fixed choices.
- Preserve item-specific Zotero fields while projecting their canonical search
  fields.
- Replace permissive JavaScript date parsing and fake January 1 values.
- Make broad public search include all enabled metadata.
- Escape all user values placed into Meilisearch filters.

## Design

### Zotero fields

The database keeps only canonical names. Zotero import maps `caseName` to
`title`; writeback and the editor map `title` back to the item-specific field.
The source snapshot remains raw Zotero JSON. No internal service stores both
names.

### Dates

The stored bibliographic value is either a four-digit year or an exact ISO
calendar date. A shared parser returns:

- the understood year;
- the precision: year or day;
- a numeric sort value;
- an ISO date only for an exact calendar day.

Month-only, season, flexible-text, and impossible dates are rejected.

The editor provides two precision choices: Exact date and Year. Exact date
uses a calendar control. Year uses a number input. Access date uses a calendar
date control.

### Other fields

- URL uses a URL control and requires an absolute HTTP or HTTPS address.
- DOI, ISBN, ISSN, PMID, and PMCID use identifier controls and server checks.
- Abstract, Extra, History, References, notes, and annotation text use
  multiline controls.
- Annotation type uses a fixed-choice control.
- Bibliographic labels and numbers remain text.

## Test-first steps

1. Add failing exhaustive codec tests for all direct and aliased fields.
2. Make admin drafts and source batches canonical while both database column
   sets still exist.
3. Fix Zotero import, writeback, and item-type transitions through the codec.
4. Add failing date tests for year, exact day, and rejected month, season,
   flexible text, and impossible dates. Implement the pure parser.
5. Add failing validation tests for typed fields. Implement the shared field
   contract and server checks.
6. Add failing projection and public API tests for canonical-only records.
   Implement precision-aware dates.
7. Add failing search-scope and filter escaping tests. Fix request building.
8. Add browser tests for the visible controls and field errors. Implement the
   editor dispatcher.
9. Add the destructive schema migration, remove the 58 alias columns and dead
   alias catalogue code, then regenerate schema artifacts.
10. Wipe and resync development data, rebuild the search index, and run the
    real-service checks.

## Files

Expected changes include:

- `packages/evidence-library-core/src/zotero-schema.ts`
- `packages/evidence-library-core/src/zotero-schema.test.ts`
- `src/lib/admin/field-contract.ts`
- `src/lib/admin/native-item-validation.ts`
- `src/components/admin/admin-schema.ts`
- `src/components/admin/AdminInspector.tsx`
- `src/components/admin/AdminMetadataField.tsx`
- `src/lib/bibliographic-date.ts`
- `src/lib/search-index/projection.ts`
- `src/lib/search-index/consumer.ts`
- `src/config/library-config/search.ts`
- `src/lib/search.ts`
- `src/db/schema/tables/item.ts`
- `src/lib/source-ingestion/zotero/mapper.ts`
- `src/lib/source-writeback/zotero/mapper.ts`
- `src/lib/publication/record-adapter.ts`
- the generated Drizzle migration and schema snapshot
- matching unit, browser, and real-service tests

## Deployment check

1. Run the focused unit tests and TypeScript.
2. Run `npm run test:search-index` and `npm run test:search-worker`.
3. Run the focused admin Playwright tests in Chromium and WebKit.
4. Run the source import and Zotero writeback real-service checks.
5. Wipe and resync the isolated development data.
6. Rebuild the development Meilisearch index.
7. Open a case and a normal record in `/admin`, then confirm their public title,
   year filter, and Newest/Oldest order.
8. Confirm the running Next.js app has no compile or unhandled errors.

## Completion rules

- Every vendored `baseField` round-trips through canonical storage and the
  item-specific editor/Zotero name.
- No alias database column or internal compatibility read remains.
- A malformed date cannot create a derived year or sort value.
- A partial date never becomes a fake exact day.
- The editor uses the shared control for each typed field.
- The server rejects values that the control says are invalid.
- Broad search finds DOI and other metadata.
- Quotes and backslashes in filter values do not break Meilisearch requests.
- Focused unit, real-service, browser, and runtime checks pass.

## Risks

- Existing development rows and JSON patches use alias keys. Wipe them instead
  of adding compatibility reads or a backfill.
- Search settings change. A full development reindex is required.
- Zotero dates are flexible. Do not replace them with one required day picker.
- The private server already applied the original `0025_publication-model.sql`.
  Restore that migration byte-for-byte and move its newer constraint changes
  into the next unapplied forward migration before deploying this schema.
