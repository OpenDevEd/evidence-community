# Plan 01: Shared field contract and search

## Goal

Make the record editor, server validation, Zotero field mapping, and
Meilisearch agree about what every metadata field means.

## Scope

- Carry Zotero field type and `baseField` meaning into the admin schema.
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

The database keeps provider field names such as `caseName`. Search adds the
canonical `title` from Zotero's `baseField` declaration. The same rule applies
to canonical dates and the other declared base fields.

### Dates

The stored bibliographic value stays exactly as entered after trimming. A
shared parser returns:

- the understood year;
- the precision: year, month, day, season, or literal;
- a numeric sort value when the date is understood; and
- an ISO date only for an exact calendar day.

Unrecognised flexible text remains visible but has no derived year or sort
value. Impossible ISO-looking values are rejected.

The editor provides a precision choice and the matching year, month, exact
date, or flexible-date control. Access date uses a calendar date control.

### Other fields

- URL uses a URL control and requires an absolute HTTP or HTTPS address.
- DOI, ISBN, ISSN, PMID, and PMCID use identifier controls and server checks.
- Abstract, Extra, History, References, notes, and annotation text use
  multiline controls.
- Annotation type uses a fixed-choice control.
- Bibliographic labels and numbers remain text.

## Test-first steps

1. Add failing schema tests for direct and inherited field meaning.
2. Add failing date tests for year, month, day, season, flexible text, and
   impossible dates. Implement the pure parser.
3. Add failing validation tests for typed fields. Implement the shared field
   contract and server checks.
4. Add failing projection tests for case, email, patent, and statute canonical
   fields. Implement canonical projection and precision-aware dates.
5. Add failing search-scope and filter escaping tests. Fix request building.
6. Add browser tests for the visible controls and field errors. Implement the
   editor dispatcher.
7. Rebuild the development search index and run the real-service checks.

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
- matching unit, browser, and real-service tests

## Deployment check

1. Run the focused unit tests and TypeScript.
2. Run `npm run test:search-index` and `npm run test:search-worker`.
3. Run the focused admin Playwright tests in Chromium and WebKit.
4. Rebuild the development Meilisearch index.
5. Open a case and a normal record in `/admin`, then confirm their public title,
   year filter, and Newest/Oldest order.
6. Confirm the running Next.js app has no compile or unhandled errors.

## Completion rules

- Every vendored `baseField` appears correctly in the search document.
- A malformed date cannot create a derived year or sort value.
- A partial date never becomes a fake exact day.
- The editor uses the shared control for each typed field.
- The server rejects values that the control says are invalid.
- Broad search finds DOI and other metadata.
- Quotes and backslashes in filter values do not break Meilisearch requests.
- Focused unit, real-service, browser, and runtime checks pass.

## Risks

- A stricter field rule may reject bad development records. Development data is
  disposable; correct or reseed it rather than adding a fallback.
- Search settings change. A full development reindex is required.
- Zotero dates are flexible. Do not replace them with one required day picker.

