# Plan 03 — Live cutover and isolation proof

## Goal

Move the current development Evidence Library to its private Meilisearch stack, prove the model with a second temporary library, and leave Coolify with one current application plus one shared PostgreSQL resource.

## Scope

1. Push the tested `openscholar` commit.
2. Rename database resource `jsl67a25e78gukd3izzxz4zf` to `evidence-library-postgres` without changing its data, image, or address.
3. Update application `rzbo9als0hdnr4gegtx97qos` with the private Meilisearch key and a runtime config using `http://meilisearch:7700`.
4. Deploy and verify the existing library before removing anything.
5. Create a temporary second database/login and temporary Compose application through supported Coolify APIs, then prove database and queue isolation.
6. Delete the temporary app/database/login and obsolete application `vntgj8bi5omift3a7u279ymd` only after every proof passes.

Before the rename, read back `jsl67a25e78gukd3izzxz4zf` and require all of these exact facts: development environment, name `new-el-openscholar-e2e-db`, PostgreSQL image `pgvector/pgvector:pg17`, database `openscholar_e2e`, and healthy state. Before deleting `vntgj8bi5omift3a7u279ymd`, require development environment, name `new-el-openscholar-e2e`, repository `OpenDevEd/new-el`, branch `openscholar`, Dockerfile build pack, and the expected old development hostname. Abort on any mismatch.

## Design

The shared PostgreSQL resource joins Coolify's predefined `coolify` network. Each Compose application keeps its private application network and must also have Coolify's supported predefined-network connection enabled. Before deployment, read back that setting and the effective Compose network list. From every new app, resolve the shared database UUID and connect to port 5432 before starting migrations. The repository remains portable; it does not hard-code a host-wide Docker network into local Compose.

The current application is updated in place only after repository checks pass. Its private Meilisearch volume is new, so the search worker performs the fail-closed one-time rebuild before the web service becomes ready. The old duplicate application remains available as rollback evidence until the current application and temporary proof tenant pass.

## Test-first steps

1. Run the repository Compose, database, worker, acceptance, unit, type, lint, schema, and build checks before any live write.
2. Read back and validate every exact Coolify target and the live 4.3.1 write contract.
3. Rename and harden the shared PostgreSQL resource, then deploy the current application and finish its complete runtime checks.
4. Create the temporary database/login and temporary Compose app, prove internal PostgreSQL DNS/network access, then run the queue and database isolation matrix.
5. Remove exact temporary resources and the validated obsolete duplicate, then rerun the current library checks and inventory.

## Files and external records

- no repository file should change during the planned cutover unless a verified deployment defect requires a committed plan correction;
- Coolify database `jsl67a25e78gukd3izzxz4zf`;
- Coolify application `rzbo9als0hdnr4gegtx97qos`;
- obsolete development application `vntgj8bi5omift3a7u279ymd` after identity checks;
- one uniquely named temporary database/login and one temporary Coolify Compose application;
- existing Outline architecture/current-state pages and the matching GitHub roadmap items after verification.

## Migration choice

There is no PostgreSQL data migration for the current library. Search is rebuilt from PostgreSQL into the private Meilisearch volume. The temporary database is created fresh, migrated normally, and dropped after proof. The current database is never dropped or copied.

## Live checks

For the current library:

- exact deployed commit and effective Compose;
- all five containers running, Meilisearch healthy, worker idle, no failed outbox rows;
- HTTP redirects to HTTPS;
- public library, item API, facets, and health return 200;
- signed-out admin API returns 401;
- password login returns a Secure host cookie;
- one real PDF upload completes in a secure browser context;
- an existing published record appears after the private-index rebuild;
- a new publish reaches Meilisearch and its receipt finishes.

For isolation:

- two separate PostgreSQL databases and logins on the one server;
- two separate Meilisearch containers and volumes;
- the same index name may exist independently in both services;
- each database login is denied access to the other database;
- pause the temporary library's Meilisearch and create search work in both libraries;
- the current library finishes while the temporary job waits;
- resume the temporary service and confirm its job then finishes;
- each test record is absent from the other library.

## Supported control-plane rules

- Use Coolify API/CLI only. Never write Coolify database rows directly.
- Before each environment write, list records, match `key` plus `is_preview=false`, preserve all flags, update, and read back.
- Coolify is 4.3.1, so confirm the live controller contract before the first write rather than relying on the older 4.1.2 snapshot.
- Confirm every application has the supported predefined-network connection enabled and that the effective Compose joins the `coolify` network before using the shared database UUID as a host.
- Wait for exact deployment IDs and confirm the deployed commit, images, containers, logs, and public HTTP behavior.

## Exact repository checks

```sh
npm run test:library-compose
npm run test:database-provisioning
npm run test:search-worker
npm run test:acceptance
npm run test:unit
npx tsc --noEmit
npm run lint
npm run schema:check
npm run build
```

## Completion rules

- Both live libraries pass the isolation matrix before cleanup.
- The current public URL and admin flow still work after cleanup.
- Coolify development shows one current Evidence Library application and one shared PostgreSQL resource, not the obsolete duplicate.
- The PostgreSQL resource contains the current library database; temporary proof resources are gone.
- The old shared Meilisearch is no longer used by the current library.
- The pushed commit, deployment ID, runtime revision, health evidence, and changed architecture decision are recorded in the existing Outline pages and GitHub roadmap only after readback.

## Risks

- Do not delete the obsolete app first; it is rollback evidence until the new stack works.
- Do not drop `openscholar_e2e` or its login.
- A Coolify deployment marked finished is not enough. Inspect the actual containers and HTTP behavior.
- The old shared Meilisearch may still serve older production libraries. Do not stop or delete that shared service in this plan.
