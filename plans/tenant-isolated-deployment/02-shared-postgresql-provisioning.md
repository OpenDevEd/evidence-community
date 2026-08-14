# Plan 02 — Shared PostgreSQL provisioning

## Goal

Create one repeatable repository-owned command that gives each Evidence Library its own PostgreSQL database and login inside a shared PostgreSQL server.

## Scope

1. Add a pure database-name and SQL contract under `src/lib/deployment/`.
2. Add `tools/provisionLibraryDatabase.ts` using the existing `pg` package.
3. Create or normalize a login with no superuser, database-creation, role-creation, or replication rights.
4. Create a database owned by that login, revoke public connection access, and grant access only to the owner.
5. Install the repository-required `vector` and `pg_trgm` extensions with the administrator connection before the restricted login runs Drizzle migrations.
6. Make rerunning the same request safe. Reject an existing database owned by a different login.
7. Output the exact runtime database URL using an explicit internal host. Do not create Coolify resources or store the password elsewhere in this command.

## Design

Accept these required values:

- PostgreSQL administrator URL;
- database name;
- login name;
- login password; and
- internal runtime host.

Names use lowercase letters, numbers, and underscores and must fit PostgreSQL's 63-byte identifier limit. Passwords must be nonblank. SQL identifiers and values are quoted by one shared helper even after validation.

Acquire a PostgreSQL advisory lock for the target database while provisioning. Check role and database ownership before changing anything. The same desired request may run again and return the same result. A different owner is a hard error.

The tenant login must stay restricted and cannot install trusted or superuser-only extensions. The provisioner therefore connects to the target database with the administrator URL and installs the exact extensions used by checked-in migrations: `vector` from `drizzle/0000_openscholar-source-model.sql` and `pg_trgm` from `drizzle/0007_admin_item_list_projection.sql`. Do not grant extension-install rights to the tenant login.

This command is the runtime primitive that OpenScholar provisioning can call later. Do not add a second schema, shared tenant tables, or a compatibility mode.

Reuse `pg`, which is already a direct dependency, and the repository's normal `URL` handling style. There is no existing database-URL builder to extend, so add exactly one pure URL builder beside the provisioning contract and use it from the CLI and tests.

## Migration choice

No application schema migration is added. The provisioner creates a new empty
database; the existing search worker startup then runs the repository's
checked-in Drizzle migrations. A Coolify bootstrap superuser must never appear
in a library runtime URL. The current development library therefore gets a new
restricted login and database. Its disposable records are not copied from the
administrator-owned bootstrap database.

## Test-first steps

1. Add failing unit tests for names, quoting, URL building, and desired-state decisions.
2. Implement the pure contract.
3. Add a real PostgreSQL verifier that creates two temporary databases and logins on one server.
4. Prove both required extensions exist and each restricted login can run every migration and read its own database.
5. Prove each login is denied access to the other database.
6. Rerun provisioning and prove it changes nothing except resetting the requested password and access rules.

## Files

- `src/lib/deployment/library-database.ts`
- `tools/provisionLibraryDatabase.ts`
- `tools/verifyLibraryDatabaseProvisioning.ts`
- `tests/unit/library-database-provisioning.test.ts`
- `package.json`
- `docs/evidence-library-operations.md`

## Exact tests

```sh
npx vitest run tests/unit/library-database-provisioning.test.ts
npm run test:database-provisioning
npx tsc --noEmit
npm run lint
```

The real verifier uses `EVIDENCE_LIBRARY_ADMIN_DATABASE_URL`. It must create uniquely named temporary resources and remove them in `finally`.

## Deployment gate

Run the command against the development shared PostgreSQL resource for a new
current-library database and a temporary second library. Then verify with real
`psql` connections that each login reaches only its own database. Keep the
Coolify bootstrap superuser as server administration only; do not demote it or
put it in a runtime config.

## Completion rules

- Unit and real PostgreSQL checks pass.
- The existing administrator database remains intact during cutover.
- The current library runs with a restricted login that owns only its library database and application objects.
- `vector` and `pg_trgm` are installed by the administrator before migrations.
- Both cross-tenant connection attempts fail.
- Rerunning the same desired state succeeds without a duplicate role or database.
- The command prints a valid internal runtime URL and no manual SQL is needed.

## Risks

- PostgreSQL grants can silently leave public database access enabled. The verifier must check both directions with the tenant logins.
- `CREATE DATABASE` cannot run in a transaction. The advisory lock and ownership readback make a partial retry safe.
- The shared server is one failure domain. Backups and capacity limits remain server-level operations.
- Never use a broad `REASSIGN OWNED` from the Coolify bootstrap role. It also
  owns PostgreSQL system databases and extensions.
