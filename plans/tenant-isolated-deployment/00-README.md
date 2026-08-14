# Tenant-isolated Evidence Library deployment

## Problem

The development library currently appears in Coolify as two applications and one database resource. Its search worker also uses a shared Meilisearch service. That makes the deployment hard to understand and lets one library's search queue compete with another library's queue.

## Fixed decisions

1. One Evidence Library is one Coolify Compose application.
2. That application contains the web app, search worker, source-sync worker, source-writeback worker, and one private Meilisearch service.
3. Meilisearch has a named volume, no public port, and one queue used only by that library. It never joins the shared PostgreSQL network.
4. All Evidence Libraries share one PostgreSQL server. Each library gets its own database and login. No tables are shared between libraries.
5. Storage and Zotero translation may remain shared services. Storage buckets remain separate per library.
6. PostgreSQL remains the source of truth. A durable database marker stays pending until a missing or interrupted private-index rebuild finishes, then normal outbox processing continues.
7. `docker/compose.sources.yaml` is deleted when its workers move into the main Compose file. There is no second deployment path.
8. OpenScholar will later call these deployment primitives. This plan does not build the self-service subscription flow or the cross-repository publishing API.

## Plans

1. [Private search and one application](01-private-search-and-one-application.md)
2. [Shared PostgreSQL provisioning](02-shared-postgresql-provisioning.md)
3. [Live cutover and isolation proof](03-live-cutover-and-isolation-proof.md)

## Dependencies

Plan 01 must land first because Plan 03 deploys its new Compose and search bootstrap behavior. Plan 02 may be implemented after Plan 01 and must pass before Plan 03 creates the temporary proof tenant. Plan 03 depends on both earlier plans, supported Coolify API access, the development shared PostgreSQL resource, and the existing isolated library configuration.

## Existing code to reuse

- `docker/compose.library.yaml` already owns the web and search-worker release.
- `docker/compose.sources.yaml` already defines the two source workers that will move into the main stack.
- `tests/acceptance/compose.yaml` already runs two libraries and is the correct place to prove search isolation.
- `rebuildSearchIndex()` in `src/lib/search-index/consumer.ts` already rebuilds Meilisearch from PostgreSQL.
- `tools/runRuntimeAcceptance.ts` already drives real PostgreSQL, Meilisearch, Next.js, and browser checks.
- `pg` is already a direct dependency and is reused by the database provisioner.

## Migration choice

One additive Evidence Library schema migration adds the durable search-rebuild
marker. The live app currently uses
Coolify's PostgreSQL bootstrap superuser, so it moves to a fresh database and
restricted login created by the repository provisioner. Development records in
the old administrator-owned database are disposable and are not copied. Search
data is rebuilt into a new private Meilisearch volume.

Development verification may create a second temporary database and application. They must be deleted after the isolation proof. The current working application and administrator database remain untouched until the replacement database and private search stack are healthy.

## Test rules

- Test the search command and database naming/SQL logic before integration work.
- Render the effective Compose JSON and test services, health checks, volumes, dependencies, and public ports. Do not test YAML text.
- Prove Meilisearch is attached only to the private application network while the four runtime containers also reach the external PostgreSQL network.
- Use two real PostgreSQL databases and two real Meilisearch services.
- Pause one Meilisearch service and prove the other library still indexes.
- Verify both directions of database denial with the real tenant logins.
- Verify the deployed HTTPS site, password login, PDF upload, search rebuild, worker health, and public pages.

## Agent use

Use other agents for read-only caller maps and major plan or completed-step review. Keep the test-first loop, plan corrections, commits, deployment writes, and final verification in the main session. One review per plan or major step is enough.

## Sources

- PostgreSQL `CREATE DATABASE`: https://www.postgresql.org/docs/17/sql-createdatabase.html
- PostgreSQL database privileges: https://www.postgresql.org/docs/17/ddl-priv.html
- PostgreSQL `GRANT`: https://www.postgresql.org/docs/17/sql-grant.html
- Coolify Compose applications: https://coolify.io/docs/applications/build-packs/docker-compose
- Meilisearch health: https://www.meilisearch.com/docs/reference/api/health/get-health
- Meilisearch security: https://www.meilisearch.com/docs/resources/self_hosting/security/overview
