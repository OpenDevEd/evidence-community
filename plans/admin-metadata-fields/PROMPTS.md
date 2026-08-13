# Prompts

## Plan 01

```text
Read plans/admin-metadata-fields/01-shared-field-contract-and-search.md and
plans/admin-metadata-fields/00-README.md.

Allow 4-8 hours. Keep working without asking questions whose answers are in the
plan.

STANDING RULES
1. Reuse the vendored Zotero schema and current admin controls before building.
2. Keep canonical fields in PostgreSQL and all internal services. Translate
   item-specific Zotero field names only at editor/import/writeback boundaries.
3. Do not keep the broken Date.parse or fake-January behavior.
4. Use one shared contract for controls and server validation.
5. Use red-green-clean-up for pure logic and add tests with every integration.
6. Delete all duplicate alias columns. Do not add compatibility reads or a
   backfill; development data is disposable.
7. Check current official Zotero behavior instead of guessing.
8. Protect unrelated dirty publication and Zenodo work.
9. Use read-only agents for broad research; keep tests, edits, and commits here.

EXECUTION RHYTHM
For pure schema, date, validation, and filter logic, write one failing behavior
test, make it pass, and clean it up before moving on. For the editor, search
worker, and browser integration, add the matching test with each working unit.
Commit after every green unit.

COMMIT DISCIPLINE
Use conventional commit prefixes. Add [plan-01] to every commit. Stage named
files only. Never include unrelated publication or Zenodo work. Never bypass a
hook. Do not push without current user permission.

WHEN TO STOP
Stop only when the completion rules pass or a real missing API makes the plan
unsafe. Do not stop for token worry or a question answered by the plan. The
running app and real search checks must be green.

DEVIATIONS
If the plan is wrong, commit safe work, update this plan, commit the reason, and
continue. If a required API does not exist, write 01-BLOCKER.md with the proof
and stop.

START NOW
Read the plan and README. Check git status and the running services. Start with
the first schema test. Keep unrelated dirty files untouched.

Go.
```
