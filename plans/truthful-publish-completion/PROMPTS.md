# Execution prompts

## Plan 01

```text
Read plans/truthful-publish-completion/01-next-cache-invalidation.md and plans/truthful-publish-completion/00-README.md. Allow 2 to 3 hours. Keep working without asking questions already answered there.

STANDING RULES
1. Reuse the existing cache-tag helper and receipt route.
2. Delete early invalidation calls. Do not add compatibility paths.
3. Write failing behavior tests before plain logic.
4. Read the installed Next.js revalidateTag guide.
5. Do not change public cache headers, SWR settings, or proxy caching.
6. Use read-only agents for broad research; keep edits and commits in the main session.

EXECUTION RHYTHM
Test tag selection first, then the receipt route, then remove early calls. Commit each green unit.

COMMIT DISCIPLINE
Use conventional commits. Stage named files only. Do not include unrelated publication-worker work. Never commit with a relevant failing test or bypass hooks.

WHEN TO STOP
Stop only when completion rules and live checks pass or a real blocker file exists. Do not stop for a question answered in the plan.

DEVIATIONS
If the plan is wrong, commit safe work, update and commit the plan, then continue. Write a blocker file only for a missing required API.

START NOW
Read the plan and README, check git status, read the installed Next.js guide, inspect current tag and receipt helpers, and start the first red test.

Go.
```

## Plan 02

```text
Read plans/truthful-publish-completion/02-admin-publish-completion.md, plans/truthful-publish-completion/00-README.md, and completed Plan 01. Allow 3 to 4 hours. Keep working without asking questions already answered there.

STANDING RULES
1. Extend the existing receipt hook. Do not build a second poller.
2. Delete immediate-success behavior. Do not add compatibility paths.
3. Write the failing promise tests before hook logic.
4. Run action work in handlers. Do not add state-sync effects.
5. Check the real browser, PostgreSQL, Meilisearch, and worker.
6. Use read-only agents for broad research; keep edits and commits in the main session.
7. Keep active action waits on every exact receipt, including two revisions of one record.
8. Retry temporary status-request failures twice, then stop truthfully on the third consecutive failure.
9. Observe batch completion promises immediately and await them even when intermediate UI refresh fails.

EXECUTION RHYTHM
Make the receipt promise green, wire one direct publish, then all other receipt actions, then run real lifecycle tests. Commit each green unit.

COMMIT DISCIPLINE
Use conventional commits. Stage named files only. Do not include unrelated publication-worker work. Never commit with a relevant failing test or bypass hooks.

WHEN TO STOP
Stop only when every completion rule, Chromium, WebKit, and live checks pass. Do not stop for a question answered in the plan.

DEVIATIONS
If the plan is wrong, commit safe work, update and commit the plan, then continue. Write a blocker file only for a missing required API.

START NOW
Read all named files, check git status, inspect existing hook and browser tests, and start the first red hook test.

Go.
```
