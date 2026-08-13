# Execution prompts

## Plan 01

```text
Read plans/truthful-publish-completion/01-search-completion-and-cache-version.md and plans/truthful-publish-completion/00-README.md. Allow 4 to 6 hours. Keep working without asking questions already answered by those files.

STANDING RULES
1. Search and reuse existing code first. Delete the replaced invalidation path.
2. Make clean breaking changes. Do not add legacy reads or fallbacks.
3. Write a failing pure or real-service test before each plain-logic change.
4. Read the installed Next.js docs before changing a cache or route rule.
5. Check the real PostgreSQL, Meilisearch, worker, and same public URL. Tests alone are not enough.
6. Use read-only agents for broad research. Keep edits, commits, and final checks in the main session.

EXECUTION RHYTHM
Write the counter and acknowledgement tests first. Make them green. Clean up. Then add the migration and integrations, testing each working unit. Commit after each green unit.

COMMIT DISCIPLINE
Use conventional commit prefixes. Stage named files only. Never include unrelated Crossref or Zenodo changes. Never commit with a relevant failing test. Do not bypass hooks.

WHEN TO STOP
Stop only when every completion rule is proven, the real worker checks pass, the deployment is healthy, or a real blocker file has been written. Do not stop for token worry or a question answered in the plan.

DEVIATIONS
If the design is wrong, commit safe work, update this plan, commit the plan change, then continue. If a required API is missing, write the next blocker file and stop.

START NOW
Read both plan files, check git status, inspect the current worker and migration journal, read the installed Next.js cache guide, and start the first red test.

Go.
```

## Plan 02

```text
Read plans/truthful-publish-completion/02-admin-completion-and-browser-refresh.md, plans/truthful-publish-completion/00-README.md, and completed Plan 01. Allow 4 to 6 hours. Keep working without asking questions already answered by those files.

STANDING RULES
1. Extend the existing receipt hook and provider. Do not build a second polling system.
2. Make clean breaking changes. Delete immediate-success text and unused paths.
3. Write a failing hook test before the waiter logic. Use behavior tests for UI and browser refresh.
4. Do not use an effect to mirror app state. Fetch keys and action handlers own the flow.
5. Check the real browser, PostgreSQL, Meilisearch, and worker after tests pass.
6. Use read-only agents for broad research. Keep edits, commits, and final checks in the main session.

EXECUTION RHYTHM
Make the receipt waiter green first. Clean it up. Then wire one direct publish action, then all other receipt-returning actions, then public SWR version keys. Commit each green unit.

COMMIT DISCIPLINE
Use conventional commit prefixes. Stage named files only. Never include unrelated Crossref or Zenodo changes. Never commit with a relevant failing test. Do not bypass hooks.

WHEN TO STOP
Stop only when every completion rule is proven, Chromium and WebKit pass, the real worker check passes, and the deployed app is healthy. Do not stop for token worry or a question answered in the plan.

DEVIATIONS
If the design is wrong, commit safe work, update this plan, commit the plan change, then continue. If a required API is missing, write the next blocker file and stop.

START NOW
Read all named files, check git status, inspect current admin receipt tests and public SWR keys, and start the first red hook test.

Go.
```
