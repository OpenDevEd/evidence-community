# Execution prompts

## Plan 01

```text
Implement plans/tenant-isolated-deployment/01-private-search-and-one-application.md after reading plans/tenant-isolated-deployment/00-README.md. Estimate 4 to 6 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse existing Compose, search rebuild, source-worker, and acceptance code before adding anything.
2. Delete the replaced source-worker deployment path. Do not keep compatibility behavior.
3. Use red, green, cleanup for pure command and search logic. Add integration checks with the implementation.
4. Read current official Meilisearch, Docker Compose, and Coolify docs when a contract is unclear.
5. Use agents only for read-only maps or one completed major-step review.
6. Never touch unrelated publication work or production deployments.

EXECUTION RHYTHM
Write failing pure tests, implement the smallest shared helper, clean it up, and commit the green unit. Then change effective Compose and acceptance integration, verify real services, and commit each working unit.

COMMIT DISCIPLINE
Use allowed prefixes and add [plan-01] to every commit. Never bypass hooks. Do not commit failing tests. Do not push until authorized.

WHEN TO STOP
Stop only for a missing required API, an unsafe external target, or a plan error that cannot be corrected from evidence. Do not stop for token worry or a question answered in the plan. All listed checks and the deployment gate must be green.

DEVIATIONS
Commit safe work, revise the plan in Git with docs: [plan-01] revise <section> — <reason>, then continue. Write a blocker file only when no safe path exists.

START NOW
Read the README and plan. Read AGENTS.md. Check git status. Read the named code and current official docs. Add the first failing search-command test and begin.

Go.
```

## Plan 02

```text
Implement plans/tenant-isolated-deployment/02-shared-postgresql-provisioning.md after reading plans/tenant-isolated-deployment/00-README.md and the completed Plan 01. Estimate 3 to 5 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Reuse the installed pg client. Add one shared database URL builder because the repository does not have one today.
2. Use one shared PostgreSQL server, one database and login per library, and no shared tenant tables or compatibility mode.
3. Test pure naming, quoting, and desired-state logic before external SQL.
4. Use current official PostgreSQL 17 docs when a grant or utility statement is unclear.
5. Use agents only for read-only maps or one completed major-step review.
6. Never put the Coolify bootstrap superuser in a library runtime URL. Create a fresh restricted database/login for the current development library and do not touch production tenants.

EXECUTION RHYTHM
Write failing pure tests, implement and clean the contract, commit the green unit, then add the real PostgreSQL verifier and commit after both access directions are proven.

COMMIT DISCIPLINE
Use allowed prefixes and add [plan-02] to every commit. Never bypass hooks. Do not commit failing tests. Do not push until authorized.

WHEN TO STOP
Stop only for a missing required API, an unsafe target, or a plan error that cannot be corrected from evidence. All listed checks and the real PostgreSQL gate must be green.

DEVIATIONS
Commit safe work, revise the plan in Git with docs: [plan-02] revise <section> — <reason>, then continue. Write a blocker file only when no safe path exists.

START NOW
Read the README, Plan 01, and Plan 02. Read AGENTS.md. Check git status. Add the first failing database-contract test and begin.

Go.
```

## Plan 03

```text
Implement plans/tenant-isolated-deployment/03-live-cutover-and-isolation-proof.md after reading plans/tenant-isolated-deployment/00-README.md and completed Plans 01 and 02. Estimate 3 to 6 hours and keep working without asking questions already answered by the plan.

STANDING RULES
1. Use only supported Coolify API/CLI writes and read every value back.
2. Preserve the current working library until the replacement stack passes every check.
3. Do not change, stop, or delete older production Evidence Libraries or the shared Meilisearch service.
4. Verify exact commits, images, containers, logs, HTTPS, admin login, PDF upload, search receipts, and cross-tenant denial.
5. Use agents only for read-only target maps or one completed major-step review.
6. Update Outline and GitHub only after the pushed runtime is verified.

EXECUTION RHYTHM
Run all repository checks, push the tested commit, update the current app, verify it, create the temporary proof tenant, run the isolation matrix, then clean up exact temporary and obsolete targets.

COMMIT DISCIPLINE
Use allowed prefixes and the matching [plan-NN] tag for any correction. Never bypass hooks. Do not create a code commit during a failing deployment.

WHEN TO STOP
Stop for an unsafe target, unknown destructive scope, or repeated external failure. Do not stop because Coolify is queued. Wait for exact deployment IDs and finish all runtime checks.

DEVIATIONS
Commit safe work, revise Plan 03 with docs: [plan-03] revise <section> — <reason>, then continue. Write a blocker file only when no safe path exists.

START NOW
Read all plan files and AGENTS.md. Check both repositories and live Coolify state. Confirm Coolify 4.3.1 environment routes before the first write. Start with repository checks, then deploy.

Go.
```
