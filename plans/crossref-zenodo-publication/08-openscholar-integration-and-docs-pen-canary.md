# 08 — Current-branch integration and docs-pen canary

## Goal

Move the finished DOI publication work onto the current `openscholar` branch without losing the newer tenant-isolated deployment, authentication, source workers, search behavior, or file behavior. Fix the known DOI safety gaps, prove the merged stack, then deploy and qualify Crossref Test and Zenodo Sandbox on `docs-pen` only.

## Current state

- Current `openscholar`: `365fd74e277eefcf268085561acba08192e60b3a`.
- DOI branch: `e388b06b7b97233b2a2e189319bc9f719b20b316`.
- Merge base: `fa3bf5db2e1e87711dd87c1f5b773e2cc838846b`.
- The DOI branch has 15 unique commits and is missing 51 newer `openscholar` commits.
- A test merge reports 11 conflict paths. The largest conflicts are tenant Compose, Drizzle history, the file route, acceptance Compose, and admin browser coverage.
- Crossref test authentication succeeds through `crossrefLoginId` in the pinned core. It accepts a bare organization role or converts a stored personal `email:role` login to Crossref's `email/role` form.
- The Zenodo Sandbox token authenticates successfully.
- The branch passes 108 unit files and 818 tests, TypeScript, lint, schema checks, and the disposable fake-provider publication lifecycle. Real provider qualification is still missing.

## Fixed decisions

1. Start from current `origin/openscholar` in a fresh integration branch. Port the DOI commits onto that base. Do not merge stale deployment files wholesale.
2. Keep current password-session authentication, private per-library Meilisearch, source-sync, source-writeback, tenant networks, Coolify network selection, database provisioning, and current file/public-link behavior.
3. Add one publication worker to each existing library Compose application. Do not create another Coolify application.
4. Keep Tailscale deleted.
5. The Crossref confirmation shows the configured namespace, such as `10.53832/docs-pen.…`. It never shows an exact unreserved counter value. The exact DOI appears only after PostgreSQL reserves it.
6. A DOI is managed only when this library reserved it in `publicationIdentifier`. A DOI found only in item metadata remains external, even when it uses the configured prefix. This phase does not adopt existing DOIs.
7. Records with an active Crossref or Zenodo target cannot be unpublished until a later withdrawal/tombstone design exists. The API returns a plain error explaining how to proceed.
8. Migrations 0025-0028 are already shared by both branches and remain unchanged. Current `openscholar` then owns 0029 and 0030. The DOI branch's three divergent migrations—0029 provider audits, 0030 file MD5, and 0031 Zenodo corrections—become 0031, 0032, and 0033, generated from the current `openscholar` 0030 snapshot. The final schema must contain the union of current `openscholar` and DOI-branch fields.
9. The new required file MD5 is populated from the canonical attachment item's existing `md5` value before the column becomes required. The migration must stop with a clear database error if an existing published file has no valid MD5. No nullable compatibility field remains.
10. Merge and deploy with providers disabled first. Enable and qualify only `docs-pen`. The other development library stays disabled until the canary passes and a later explicit step enables it.
11. `docs-pen` uses suffix namespace `docs-pen.`. Its separate database, publication worker, and Meilisearch keep its queue and search work isolated.
12. Sandbox writes are allowed only through the environment-gated qualification tools. Production Crossref and Zenodo values remain impossible in the schema.
13. Clean Docker builds install the public DOI core through HTTPS. npm records this Git dependency as an SSH URL in `package-lock.json`, so the shared dependency image must rewrite that exact GitHub SSH prefix to public HTTPS before any npm install. Do not add a deploy key, token, or cache-dependent fallback.

## Existing code to reuse

- `src/lib/publication/namespace-repository.ts`: atomic namespace allocation and immutable namespace checks.
- `src/lib/publication/bibliographic-doi.ts`: one DOI resolver for item metadata.
- `src/lib/publication/admin-publication-view.ts`: the only server-built admin view.
- `src/lib/publication/crossref-activation-service.ts`: activation transaction and managed identifier rows.
- `src/lib/admin/native-item-service.ts`: canonical publish/unpublish transaction and mutation locks.
- `src/lib/admin/errors.ts` and `src/lib/admin/http.ts`: plain admin API errors.
- `src/lib/worker-instance.ts` and `src/lib/worker-state-reporter.ts`: shared worker runtime.
- Current `docker/compose.library.yaml`: tenant networks, private Meilisearch, source workers, and Coolify proxy selection.
- `tests/acceptance/fixture/publication-provider-fake.mjs`: deterministic provider behavior.
- `tools/runRuntimeAcceptance.ts`: disposable browser, worker, database, and provider lifecycle.
- `tools/provisionLibraryDatabase.ts`: restricted tenant database creation.
- `docs/evidence-library-operations.md`: live deployment and Coolify environment procedure.

## Test seams

These are the required public seams for the test-first work:

1. Admin publication view and dialog: an unactivated record shows only the namespace preview; the activation response shows the exact reserved DOI.
2. Crossref activation API: a metadata-only DOI is external and cannot be claimed; a locally reserved managed DOI remains idempotent.
3. Unpublish API: an activated target returns a conflict and keeps the public record; a record without a target still unpublishes normally.
4. Migration/runtime: a current tenant database upgrades through 0031-0033, preserves a published PDF with a valid MD5, and starts all workers.
5. Provider lifecycle: the environment-gated tools create one fresh test record, deposit it to Crossref Test, verify it, redeposit a metadata edit under the same DOI, publish the PDF to Zenodo Sandbox using that DOI, and re-read both remote records.
6. Tenant boundary: `docs-pen` receives the target, jobs, identifiers, worker activity, and search update; the other library receives none.

## Implementation steps

### 1. Correct the plan and integrate the branches

- Commit this plan before code.
- Create a fresh branch from `origin/openscholar`.
- Port the DOI commits in order, resolving conflicts against the current branch.
- Keep current Compose and add only the publication worker and its health dependency.
- Keep current authentication in the file route while adding the Zenodo file-correction request contract.
- Keep current acceptance services and add the fake publication provider and publication worker.
- Delete `docker/compose.tailscale-development.yaml`, `ops/tailscale-development/`, `tools/verifyTailscaleDevelopmentDeployment.ts`, `tests/unit/tailscale-development-deployment.test.ts`, the `test:tailscale-development` package script, and the Tailscale deployment section in `docs/evidence-library-operations.md`.
- Require `git grep -i tailscale` to return matches only under `plans/`.

### 2. Fix DOI ownership, preview, and unpublish safety test-first

- Add a failing view/browser test proving the confirmation contains `prefix/namespace…` and no exact sequence.
- Remove `previewDoi` and the read-only next-counter guess from the admin view.
- Remove the second exact-number placeholder ending in `000000` from `admin-publication-view.ts`; before reservation the UI may show only the namespace.
- Add a failing activation/API test proving a same-prefix metadata DOI is external unless a managed identifier row already exists for this item.
- Delete the prefix-only adoption path. Do not add a compatibility claim flow.
- Add failing service and route tests proving active publication targets block unpublish without changing PostgreSQL or Meilisearch receipts.
- Add the guard inside the canonical unpublish transaction, not only in React or the route.

### 3. Rebuild migrations and prove the merged runtime

- Keep the already-shared migrations 0025-0028 unchanged. Recreate only the DOI branch's three divergent migrations as 0031 provider audits, 0032 file MD5, and 0033 Zenodo corrections from current `openscholar` 0030.
- Populate `itemFilePublication.md5` from the canonical attachment row, validate it, then set it required.
- Regenerate Drizzle snapshots and `_journal.json`; never hand-merge snapshot JSON.
- Compare the generated final schema with both branch tips and account for every current `openscholar` field and every DOI publication field.
- Confirm `test:library-compose` and `test:database-provisioning` exist immediately after the port, before relying on them in the full gate.
- Run schema checks, TypeScript, lint, unit tests, database provisioning, library Compose checks, publication worker checks, full acceptance, and browser tests.
- Build the production image and inspect the effective Compose model: web/source/search/publication workers use the runtime networks; Meilisearch stays private; web selects the Coolify network for the proxy.
- Prove a clean dependency image can install the pinned public DOI core without an SSH client, SSH key, or warm npm cache.

### 4. Add real sandbox qualification tools

- Add the three Phase 07 scripts: `test:crossref-test-live`, `test:zenodo-sandbox-live`, and `test:publication-sandbox-lifecycle`.
- Each tool requires an explicit environment gate and exits before a provider call when the gate, test/sandbox endpoint, credentials, fresh fixture identity, or unique namespace is missing. Credential errors must accept both bare organization-role logins and personal logins normalized by `crossrefLoginId`.
- Use the application publication API and worker. Do not submit directly with a second provider client.
- Poll saved receipts and provider diagnostics. Do not use arbitrary sleeps as success checks.
- Preserve Crossref batch/submission IDs and Zenodo record/version IDs in the final evidence.

### 5. Push, deploy, qualify, and document

- Push the reviewed integration branch, read back its remote SHA, then fast-forward `openscholar` only after every local gate passes.
- Deploy that exact `openscholar` SHA to `docs-pen` with publication disabled. Poll the exact Coolify deployment to `finished` and verify five existing services plus the new publication worker are healthy.
- Update the compact `LIBRARY_CONFIG_JSON` with Crossref Test, Zenodo Sandbox, `docs-pen.`, and the existing worker defaults. Read the exact saved environment value back before redeploying.
- Run the complete real sandbox lifecycle once. Do not reuse a failed or successful DOI for a fresh run.
- Verify the public page, admin state after reload, publication worker health, search receipt, database rows, Crossref diagnostic, and Zenodo record/PDF/checksum.
- If qualification fails after providers are enabled, redeploy the named, previously verified disabled `LIBRARY_CONFIG_JSON`. Keep every DOI, identifier, target, job, journal, and provider receipt; never delete a `publicationIdentifier` to roll back configuration.
- Update the existing Evidence Library current-state and runbook Outline pages only after the pushed commit and live checks are proven. Read both pages back.

## Exact checks

```sh
npm ci
npm run schema:check
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:library-compose
npm run test:database-provisioning
npm run test:publication-model
npm run test:publication-worker
npm run test:crossref-activation
npm run test:zenodo-activation
npm run test:native-lifecycle
npm run test:linked-item-lifecycle
npm run test:search-worker
npm run test:acceptance
npm run test:e2e
npm run build
```

After the disabled deployment is healthy:

```sh
npm run test:crossref-test-live
npm run test:zenodo-sandbox-live
npm run test:publication-sandbox-lifecycle
```

## Deployability gate

The exact Coolify deployment returned by the deploy request must finish with `status=finished` at the pushed `openscholar` SHA. Then:

- `https://docs-pen.opendev.space/api/library-config/health` returns `200` and the new revision;
- web, search-indexer, source-sync, source-writeback, publication-worker, and private Meilisearch are running and healthy;
- the publication overview reports Crossref Test and Zenodo Sandbox enabled only after the configuration deployment;
- every worker has a fresh heartbeat and no failed or dead-lettered work;
- the other development library has no publication target, identifier, or job from the canary.

## Data migration choice

Clean forward migration. No compatibility columns, fallback reads, or dual schema paths. Existing published files keep working because MD5 is copied from the canonical attachment row during the migration. If a development row lacks a valid MD5, stop the deployment, remove that invalid development file publication, and republish its PDF through the normal admin flow before retrying.

## Completion rules

- The integration contains current `openscholar` behavior plus publication work, with no Tailscale or duplicate worker path.
- The namespace preview is truthful and exact DOI reservation is atomic.
- Metadata-only DOIs cannot be adopted as managed identifiers.
- Active DOI targets cannot be unpublished into a broken public link.
- Migrations 0031-0033 apply to both disposable acceptance databases and the existing `docs-pen` database.
- Every exact local check above passes.
- The exact pushed SHA is live and healthy on `docs-pen`.
- One fresh Crossref Test deposit, metadata redeposit, and Zenodo Sandbox publication settle successfully and remain correct after reload.
- The original development library remains unchanged and healthy.
- Outline records only the verified pushed and deployed result.

## Known risks

- Crossref verification is asynchronous. Use diagnostics and saved pending state rather than a fixed wait.
- Zenodo Sandbox can be reset. Preserve the local evidence and distinguish a sandbox reset from application failure.
- A provider request can succeed before the response is received. Every qualification retry must use the saved job, identifier, and journal rather than creating another target.
- Existing published-file rows need a valid canonical attachment MD5 before migration 0032 can become required.
- npm normalizes the pinned GitHub dependency to an SSH URL in `package-lock.json`; the Docker dependency stage must keep the checked-in HTTPS rewrite or clean server builds will fail before compilation.
- The user has authorized sandbox deployment and provider writes only for `docs-pen`; production and the other library remain out of scope.
