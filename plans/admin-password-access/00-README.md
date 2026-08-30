# Password-protected Evidence Library admin

Status: ready to implement on 2026-08-13.

## Goal

Restore the development Evidence Library on its normal public HTTPS address. Keep the public library open. Require one password for `/admin` and every `/api/admin/**` route.

## Fixed decisions

1. Delete the Tailscale deployment, key, sidecar, checks, and old plan. There is no compatibility path.
2. Use the normal `docker/compose.library.yaml` deployment and the Coolify HTTPS domain `https://docs-openscholar-compose-e2e.opendev.space`.
3. Add `authentication.adminPassword` to the private library configuration. Reuse the existing private `authentication.secret` to sign the login cookie. The public configuration already removes private authentication values.
4. A successful native form submission creates a short-lived signed cookie. The cookie is `HttpOnly`, `SameSite=Strict`, and available only on this site. It is always `Secure` in production and omits `Secure` only on the local HTTP development server so WebKit tests can log in.
5. The cookie stores no password. A changed admin password or authentication secret immediately ends existing sessions.
6. The admin page shows a password form when signed out. Every admin API returns `401` when the cookie is missing, expired, or changed.
7. Logout deletes the cookie. No bypass environment variable or old 404 gate remains.
8. Reuse the existing admin response headers, private runtime configuration, authentication secret, and bounded client rate-limiter shape. Count only failed passwords. Do not let successful logins consume the failure budget. Do not add a database, user table, authentication package, or second signing secret for one password.
9. The native form posts to one small session route. Verification tools reuse one shared helper that logs in through that same route and sends the returned cookie. No test bypass remains.

## Plan

- [01-admin-password-and-normal-https.md](./01-admin-password-and-normal-https.md)

## Existing code to reuse

- `src/lib/admin/http.ts` is the one API gate and already adds private no-store headers.
- `src/app/[locale]/admin/page.tsx` is the one page gate.
- `src/lib/ai/rate-limit.ts` owns the shared Redis connection and atomic limiter pattern that can be reused for a separate admin-login policy.
- `docker/compose.library.yaml` is the normal web and search-worker deployment.
- `tests/e2e/admin.spec.ts` already covers the real admin workbench.
- `tools/verifyNativeFileHttp.ts` and the admin browser tests cover PDF upload behavior.

## Test rules

- Write pure cookie and password tests first.
- Test the form through visible labels, messages, and native Enter submission.
- Test APIs with no cookie, a changed cookie, and a valid cookie.
- Do not test CSS class names.
- Run the real deployed site over HTTPS and confirm PDF upload works in a secure browser context.

## Migration

No database migration. Delete the old deployment path outright.

## Agent use

- Fable-5 at High reviews this plan after the plan commit.
- Fable-5 at High reviews the completed pushed step after tests and live checks.
- Reviews are read-only. They do not edit, push, or deploy.

## Sources

- Installed Next.js authentication guide: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- Installed Next.js cookies guide: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`
- Installed Next.js forms guide: `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- Coolify Docker Compose guide: <https://coolify.io/docs/knowledge-base/docker/compose>
