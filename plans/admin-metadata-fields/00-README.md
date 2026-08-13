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

1. PostgreSQL, drafts, publication, and search use canonical fields such as
   `title`, `date`, and `publisher`.
2. Zotero import, writeback, and the editor translate item-specific names such
   as `caseName` and `dateDecided` at their boundaries.
3. Use one shared field contract for the editor and server validation.
4. Bibliographic dates support only an exact calendar date or a four-digit
   year. The editor uses a date picker for an exact date and a number input for
   a year.
5. Month-only, season, and flexible-text dates are rejected. This is a clean
   breaking rule with no compatibility path.
6. A year uses a precision-aware sort value. It does not pretend to be January
   1.
7. Bibliographic numbers such as volume, issue, pages, ISBN, and patent number
   stay text. They may contain letters, ranges, or punctuation.
8. Remove all 58 duplicate Zotero alias columns. Add the missing canonical
   `medium` and `authority` columns.
9. This is a clean breaking change. Wipe and resync development records, then
   rebuild the search index. Do not add old-field fallbacks or backfills.

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
   replaces duplicate alias storage with one canonical field model, then fixes
   date projection, validation, search, and editor controls.

## Test rules

- Test the shared field behavior through public helpers and validation.
- Test search documents and real Meilisearch results, not private helper calls
  alone.
- Test editor labels, roles, input values, errors, and saved requests.
- Do not test CSS class strings.

## Data choice

Use one destructive Drizzle migration to drop the 58 alias columns and add
`medium` and `authority`. Do not preserve or backfill development rows. Wipe
records, drafts, source state, and queued jobs, then resync or reseed. Rebuild
Meilisearch from PostgreSQL.

## Agent use

Read-only agents may map Zotero rules and existing controls. The main session
owns tests, implementation, commits, browser checks, and deployment.

## Sources

- Current branch code and tests.
- The vendored Zotero schema.
- Zotero's current item-field documentation, checked on 2026-08-13.
