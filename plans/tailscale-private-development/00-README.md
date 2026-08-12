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
4. Tailscale Serve is the only ingress. Tailscale Funnel stays off. Use private HTTP while Tailscale's confirmed certificate-creation incident blocks every new MagicDNS certificate.
5. The web service stays on Coolify's private application network. It publishes no host port and has no Traefik router. A small forwarder in the repository-owned Tailscale image bridges `127.0.0.1:3000` to `web:3000`, because Tailscale Serve supports only a loopback HTTP target.
6. The repository owns the Compose file, Serve file, checks, and operating guide. Coolify stores only required deployment values and secrets.
7. The only new secret is `TAILSCALE_AUTHKEY`. Use a non-ephemeral reusable key. This single development node does not require a tag. Keep Tailscale state in a named volume, set `TS_AUTH_ONCE=true`, and disable key expiry for the registered node.
8. The private address is `http://openscholar-el-dev.tail40de7d.ts.net`. The active `opendeved.net` tailnet reported that MagicDNS suffix on 2026-08-12. The matching runtime `identity.baseUrl` must take effect in the same deploy that follows removal of the public route.
9. Do not use Tailscale identity headers as application authentication. Membership of the tailnet is the temporary development gate.
10. The generic library Compose remains secure by default. The admin bypass exists only in the private development Compose.
11. Coolify renders Compose once with build-time values and again with runtime values. `TS_AUTHKEY` therefore uses an empty build-time default, while the checked Coolify runtime environment must contain `TAILSCALE_AUTHKEY` before deployment. The key is not passed into the image build.
12. Bake `serve.json` into the repository-owned Tailscale image. Do not use a relative bind mount: Coolify converts it into deployment storage instead of preserving the checked-out repository directory.

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

The private Compose file builds a small sidecar from the pinned `tailscale/tailscale` image. A pinned `socat` process listens only on the sidecar's loopback address and forwards to `web:3000` over Coolify's private application network. Tailscale Serve sends private HTTP traffic to its supported `127.0.0.1:3000` target.

The first live deployment attempt, `xk2eeaemp55ye0bbp88fd5bj`, proved that Coolify 4.1.2 cannot parse Docker Compose's `!reset` YAML tag. Coolify caught that parser error, saved an empty service model, and Docker Compose returned `no service selected`. Coolify also adds its application network to each service, so `network_mode: service:tailscale` would conflict with that generated network. The private Compose must therefore use ordinary YAML and normal private service networking. Raw Compose mode is not used because it would be a one-off server setting instead of a repository-owned deployment.

The second live deployment attempt, `dw9yqkar9ny3po19o2uc0aeh`, proved that Coolify expands service environment values during its image-build command using only build-time variables. A required `TAILSCALE_AUTHKEY` expression therefore stopped the build even though the runtime value was present. The Compose file must allow an empty build-time expansion and rely on the read-back runtime environment check plus Tailscale startup failure if that runtime value is absent.

Deployment `c9bke7r2axlyybqmmy8a2nlw` started all three private containers and registered the Tailscale node, but proved that Coolify turns the relative Serve-directory bind mount into an empty persistent directory. The sidecar image must copy the repository Serve file to `/config/serve.json`, and its health check must fail unless `tailscale serve status --json` contains the private listener.

Deployment `m586zml5pj3n7g0h9br4vk1x` loaded the repository Serve configuration correctly, but certificate requests failed because Tailscale's public status page reports an active certificate-creation incident affecting new Serve and Funnel services. Private HTTP keeps the development site usable without adding a public path or manual certificate setup. Tailscale's WireGuard connection still encrypts the traffic. Move back to HTTPS in a later clean change after Tailscale resolves the incident; do not keep both addresses.

The Compose file publishes no host ports. Coolify must have no domain attached to either service. The current application stores that public route in the production `SERVICE_URL_WEB` and `SERVICE_FQDN_WEB` environment records even though `docker_compose_domains` is already empty. Delete those exact records by UUID and read back their absence before stopping the public stack. The deployment check must inspect the effective Traefik labels because Coolify can override a checked-in `traefik.enable=false` label when a saved service domain remains attached.

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
