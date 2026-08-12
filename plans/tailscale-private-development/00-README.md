# Tailscale-only development Evidence Library

Status: planned. The current development deployment is public and keeps `/admin` disabled, so this plan changes both facts in one release.

## Goal

Make the development Evidence Library reachable only from Mohammed's Tailscale network, then enable the existing temporary admin bypass. A visitor on the public internet must not be able to reach the public library, `/admin`, or any API.

## Proven starting point

- Repository: `OpenDevEd/new-el`, branch `openscholar`, commit `2f5e8157fe7fef9ed8028426c6c421ef95e5a8ca`.
- Coolify application: `rzbo9als0hdnr4gegtx97qos` (`openscholar-e2e-compose`).
- Current public address: `https://docs-openscholar-compose-e2e.opendev.space`.
- `/api/library-config/health` returns `200` with active revision `openscholar-e2e-4`.
- `/admin` renders the app's 404 page because the web container does not receive `ADMIN_AUTH_BYPASS=true`.
- `/api/admin/library` returns the app's `404 not_found` response for the same reason.
- The Coolify host and application do not currently run Tailscale.

## Fixed decisions

1. This is a `new-el` deployment step. It is not OpenScholar route or Clerk work.
2. Use the existing `ADMIN_AUTH_BYPASS` gate. Do not build a second admin login or identity system.
3. Never enable the bypass while a public route can reach the app.
4. Tailscale Serve is the only ingress. Tailscale Funnel stays off.
5. The private Compose starts Next.js with `--hostname 127.0.0.1`, so the backend listens only on loopback inside the shared Tailscale network namespace.
6. The repository owns the Compose file, Serve file, checks, and operating guide. Coolify stores only required deployment values and secrets.
7. The only new secret is `TAILSCALE_AUTHKEY`. Use a non-ephemeral tagged key. Keep Tailscale state in a named volume, set `TS_AUTH_ONCE=true`, and disable key expiry for the registered node.
8. The private address is `https://openscholar-el-dev.tail5a46da.ts.net`. The matching runtime `identity.baseUrl` must take effect in the same deploy that follows removal of the public route.
9. Do not use Tailscale identity headers as application authentication. Membership of the tailnet is the temporary development gate.
10. The generic library Compose remains secure by default. The admin bypass exists only in the private development Compose.

## Plan

1. [01 — Private deployment and admin access](./01-private-deployment-and-admin-access.md)

This step must finish before work continues on the OpenScholar Evidence Library configuration interface.

## Existing code to reuse

- `docker/compose.library.yaml` for the web, search worker, runtime config, health, and build contract.
- `src/lib/admin/access.ts` for the exact bypass check.
- `src/lib/admin/http.ts` for the shared admin API gate.
- `src/lib/runtime-routing.ts` for canonical-host behavior.
- `ops/library-shield/probe.sh` only as a donor for clear deployment probes. Library Shield is not the access boundary.
- `docs/evidence-library-operations.md` for the deployment contract.

## Repository-owned deployment shape

The private Compose file adds a pinned `tailscale/tailscale` sidecar. The web container shares the sidecar's network namespace. Its command starts Next.js with `--hostname 127.0.0.1`, and Tailscale Serve sends private HTTPS traffic to `127.0.0.1:3000`.

The Compose file publishes no host ports. Coolify must have no domain attached to either service. The deployment check must inspect the effective Traefik labels because Coolify can override a checked-in `traefik.enable=false` label when a domain remains attached.

## Test rules

- Use red, green, clean up for the deployment contract checker.
- Check parsed Compose behavior and Serve behavior. Do not assert formatting or YAML text.
- Run the admin access unit test and the deployment checker.
- Render the real Compose file with `docker compose config`.
- Prove behavior from one Tailscale device and one non-Tailscale public path.
- A Cloudflare or shared-Traefik 404 from the old hostname is safe. The old hostname must never return this application's health data, workbench, or headers.

## Data and migration choice

There is no database migration. Existing development data stays in its isolated PostgreSQL database, Meilisearch index, and storage buckets.

The runtime configuration changes `identity.baseUrl` to the private Tailscale address and gets a new revision and `updatedAt`. No compatibility URL or redirect to the old public hostname remains.

## Agent use

- Use one implementation agent at a time because Compose, Coolify, and the live deployment are one change.
- Have Fable High review the completed plan and the completed deployment step.
- Reviewers stay read-only. They do not deploy, change Tailscale, push, or delete resources.

## Sources

- [Tailscale Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Tailscale identity](https://tailscale.com/docs/concepts/tailscale-identity)
- [Coolify Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose)
- `AGENTS.md`
- `docker/compose.library.yaml`
- `docs/evidence-library-operations.md`
