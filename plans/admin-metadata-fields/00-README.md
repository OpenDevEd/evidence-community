# Admin metadata fields

## Problem

The record editor renders almost every Zotero field as ordinary text. The
server also treats almost every field as arbitrary text. Search then tries to
interpret some of that text on its own.

This causes three user-visible failures:

- records such as cases and statutes can lose their canonical title or date in
  public search;
- malformed dates can become a fake January 1 date; and
- the editor does not give people controls that match the value they are
  entering.

## Fixed decisions

1. Keep Zotero's item-specific field names in PostgreSQL and in Zotero
   writeback. For example, a case keeps `caseName` and `dateDecided`.
2. Use Zotero's `baseField` only to add canonical search fields such as `title`
   and `date`.
3. Use one shared field contract for the editor and server validation.
4. Bibliographic dates support year, month, exact date, and flexible text. They
   are not ordinary HTML date values.
5. Flexible text stays visible, but search derives a year or sort value only
   when the date is understood.
6. Partial dates use a precision-aware sort value. They do not pretend to be
   January 1.
7. Bibliographic numbers such as volume, issue, pages, ISBN, and patent number
   stay text. They may contain letters, ranges, or punctuation.
8. This is a clean breaking change. Rebuild the development search index. Do
   not add old-field fallbacks.

## Existing code to reuse

- Vendored Zotero field and `baseField` data in
  `packages/evidence-library-core/vendor/zotero-schema.json`.
- Schema access in `packages/evidence-library-core/src/zotero-schema.ts`.
- Existing NextUI `Input`, `Textarea`, `Select`, and `Autocomplete` wrappers.
- Existing field errors and focus behavior in `AdminInspector.tsx`.
- Existing PostgreSQL-to-Meilisearch projection in
  `src/lib/search-index/projection.ts`.
- Existing real-service search checks in `tools/verifySearchOutbox.ts`.

## Plan

1. [01-shared-field-contract-and-search.md](01-shared-field-contract-and-search.md)
   fixes canonical fields, date projection, validation, and editor controls.

## Test rules

- Test the shared field behavior through public helpers and validation.
- Test search documents and real Meilisearch results, not private helper calls
  alone.
- Test editor labels, roles, input values, errors, and saved requests.
- Do not test CSS class strings.

## Data choice

No PostgreSQL migration is needed. The source field names remain unchanged.
The development Meilisearch index must be rebuilt because its derived fields
change.

## Agent use

Read-only agents may map Zotero rules and existing controls. The main session
owns tests, implementation, commits, browser checks, and deployment.

## Sources

- Current branch code and tests.
- The vendored Zotero schema.
- Zotero's current item-field documentation, checked on 2026-08-13.

