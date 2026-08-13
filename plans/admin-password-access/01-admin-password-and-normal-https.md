# Step 01: Add the admin password and restore normal HTTPS

## Goal

Replace the temporary Tailscale bypass with a small password login and deploy the whole Evidence Library through its normal HTTPS domain.

## Scope

### Authentication

1. Replace `src/lib/admin/access.ts` with server-only helpers that:
   - require `authentication.adminPassword` and the existing `authentication.secret` from the private library configuration;
   - compare the submitted password in constant time;
   - create and verify a versioned, expiring HMAC-SHA-256 session token;
   - bind the token to both current secrets so changing either one ends old sessions.
2. Replace `requireAdminBypass()` with one request-cookie gate in `src/lib/admin/http.ts`. Update every `/api/admin/**` handler to pass its request to that gate.
3. Add native login and logout forms under `src/app/[locale]/admin/`. Use Server Actions to set and delete the cookie. Keep errors plain and do not expose configuration details.
4. Add a small bounded login-attempt limiter by extracting the reusable fixed-window logic from `src/lib/ai-rate-limit.ts`. Do not add a second copy.
5. Remove every `ADMIN_AUTH_BYPASS` reference. Local browser tests use the private password and signing secret in their test library configuration instead.

### Deployment

1. Delete `docker/compose.tailscale-development.yaml`, `ops/tailscale-development/`, its checker, its test, and its package script.
2. Add the private `authentication.adminPassword` field to the library configuration schema. Keep it out of the public configuration beside `authentication.secret`. Require both fields when the admin runs.
3. Replace the Tailscale section in `docs/evidence-library-operations.md` with the normal HTTPS and password setup. Update `docs/source-ingestion-contract.md` so it no longer describes a bypass.
4. Push the tested commit. Through the supported Coolify API, point application `rzbo9als0hdnr4gegtx97qos` to `/docker/compose.library.yaml`, attach `docs-openscholar-compose-e2e.opendev.space` to `web:3000`, remove `TAILSCALE_AUTHKEY`, and update `LIBRARY_CONFIG_JSON` with the admin password, HTTPS base URL, revision, and timestamp.
5. Read the saved Coolify values and generated Compose model back before deploying.

## Test-first steps

1. Add failing unit tests for correct password, wrong password, valid token, expiry, tampering, changed password, and changed signing secret. Implement the pure helper and clean it up.
2. Add failing route tests for `401` without a valid cookie and success with one. Replace every old bypass call and prove all admin route files use the new gate.
3. Add failing browser tests for the password label, wrong-password message, Enter-to-submit, successful workbench access, reload persistence, and logout. Implement the native forms without effects.
4. Add a failing Compose contract test for required admin values and for the complete absence of Tailscale and the bypass. Remove the old deployment and update the normal Compose file.
5. Run focused tests, all admin unit tests, Chromium admin tests, WebKit admin tests, TypeScript/build checks, and repository schema checks.

## Exact checks

```sh
npm ci
npm run schema:check
npx vitest run tests/unit/admin-access.test.ts tests/unit/admin-auth-routes.test.ts tests/unit/ai-rate-limit.test.ts
npx playwright test tests/e2e/admin.spec.ts --project=chromium --project=webkit-admin
npm run build
docker compose -f docker/compose.library.yaml config
rg -n "ADMIN_AUTH_BYPASS|TAILSCALE|Tailscale|tailscale" --glob '!plans/admin-password-access/**' .
```

After the app change is present in the development checkout:

```sh
npx pm2 logs next --lines 5 --nostream
```

The newest output must contain `✓ Compiled` and no module, type, compile, or unhandled error.

## Live checks

1. `http://docs-openscholar-compose-e2e.opendev.space` redirects to HTTPS.
2. The public library opens without a login.
3. `/admin` shows the password form. A wrong password stays signed out. Enter with the right password opens the workbench.
4. The browser reports `isSecureContext=true` and `crypto.subtle` exists.
5. Upload and publish one small PDF. Confirm the file reaches storage and the admin UI shows it.
6. Logout, then prove `/api/admin/library` returns `401` without the cookie and succeeds after logging in again.
7. Coolify shows only `web` and `search-indexer`; both are healthy. No Tailscale container, stored key, domain, or volume remains.

## Completion rules

- All old bypass and Tailscale code is deleted.
- The native password form works with Enter.
- The signed cookie protects the page and every admin API.
- The normal HTTPS deployment is healthy and PDF upload works.
- The pushed commit matches the deployed commit.
- `npx pm2 logs next --lines 5 --nostream` is green when the development checkout receives the change.
- Fable-5 High reports no blocking finding.
- The Evidence Library operating guide and the smallest relevant Outline page describe the verified new setup.

## Known risks

- The login limiter is process-local. This development deployment has one web process, so that boundary is deliberate. A multi-instance deployment must use shared state.
- Changing either admin secret signs everyone out immediately.
- The old public domain may still have a stale proxy route during deployment. Do not enable the password runtime until Coolify's generated HTTPS route points only to this web service.
