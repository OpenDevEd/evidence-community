# 01 — Private deployment and admin access

## Goal

Move the isolated development Evidence Library behind Tailscale and enable its existing admin bypass without leaving any public path to the application.

## Scope

- Add the private Tailscale deployment files and behavior checks in `new-el/openscholar`.
- Update the isolated development runtime configuration to use the Tailscale address.
- Redeploy Coolify application `rzbo9als0hdnr4gegtx97qos` from the repository-owned private Compose file.
- During concurrent publication work, deploy the isolated `codex/new-el-private-dev` branch so an edited already-applied migration cannot break this runtime. Return the application to `openscholar` only after that branch restarts cleanly.
- Remove the current Coolify web domain from that application.
- Verify the public library, admin workbench, admin API, settings health, and search worker.

Out of scope: Clerk, OpenScholar login, production Evidence Libraries, existing production tenants, Tailscale Funnel, and a permanent admin authentication design.

## Design

Add `docker/compose.tailscale-development.yaml`. Reuse the build, runtime config, and search-worker behavior from `docker/compose.library.yaml` without creating another application image.

The private stack has these rules:

- `tailscale` uses `tailscale/tailscale:v1.98.10@sha256:cdf5612ded5be1344f1a704b8c5e53496db97376bb533e5e15f141e48bf60cc0`.
- `TS_HOSTNAME=openscholar-el-dev`.
- Map `TAILSCALE_AUTHKEY` to `TS_AUTHKEY` with an empty default so Coolify can render the image-build command without copying the runtime key into build arguments. Read back the runtime value before deploy; `containerboot` must fail if neither saved state nor a runtime key exists.
- `TS_USERSPACE=true`, `TS_AUTH_ONCE=true`, and `TS_STATE_DIR=/var/lib/tailscale`.
- Copy `ops/tailscale-development/serve.json` into the sidecar image at `/config/serve.json` and set `TS_SERVE_CONFIG` to that path. Do not bind-mount the repository directory through Coolify.
- The web and Tailscale services use Coolify's private application network.
- Build the Tailscale service from a repository Dockerfile whose base image is the pinned official image. Install a pinned `socat` package and start a loopback-only forwarder from `127.0.0.1:3000` to `web:3000` before starting the official `containerboot` process.
- Tailscale Serve reaches the supported local target `127.0.0.1:3000`; the forwarder reaches the web service over the private network.
- The web container sets `ADMIN_AUTH_BYPASS=true`.
- No service publishes a host port.
- Coolify has no domain attached to web or Tailscale. A checked-in `traefik.enable=false` label is not treated as a safety boundary.
- The search worker remains a separate internal service and retains its current health check. Web keeps `depends_on: search-indexer: condition: service_healthy`, so database setup finishes before web starts.
- The web service does not declare `ports`. Its internal `expose: 3000` does not publish a host port.

Add `ops/tailscale-development/serve.json` with private HTTP only while Tailscale's confirmed certificate incident prevents new HTTPS certificates:

```json
{
  "TCP": {
    "80": {
      "HTTP": true
    }
  },
  "Web": {
    "${TS_CERT_DOMAIN}:80": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:3000"
        }
      }
    }
  },
  "AllowFunnel": {
    "${TS_CERT_DOMAIN}:80": false
  }
}
```

Add a repository check that parses the rendered Compose model, Tailscale Dockerfile, entrypoint, and Serve JSON. It must fail if it finds a host port, public Traefik route, Funnel, a non-loopback Serve backend, a non-loopback forwarder listener, a forwarder destination other than `web:3000`, a missing baked Serve file, a health check that accepts empty Serve state, a missing admin bypass, an unpinned Tailscale base image or forwarder package, or missing persistent state. The private file uses ordinary YAML only because Coolify 4.1.2 rejects Docker Compose custom tags such as `!reset`.

## Test-first sequence

1. Add failing tests for the private deployment contract. Add the Compose and Serve files until the parsed behavior passes.
2. Update `docs/evidence-library-operations.md` with the private command, required values, the `X-Real-IP` limitation, verification, and rollback. Render the Compose file with real-shaped values.
3. Confirm the Coolify application uses Compose parser version 3 or newer. Use a non-ephemeral reusable auth key; this single development node does not require a tag. Disable key expiry for the registered node.
4. Read the active tailnet from `tailscale status --json` and require `CurrentTailnet.Name=opendeved.net`, `CurrentTailnet.MagicDNSEnabled=true`, and `CurrentTailnet.MagicDNSSuffix=tail40de7d.ts.net`. Prepare a new runtime JSON revision whose canonical `identity.baseUrl` is `https://openscholar-el-dev.tail40de7d.ts.net`. Run `npm run config:validate -- /path/to/private-library.json`. Store it and `TAILSCALE_AUTHKEY` through the Coolify API, then read both settings back. During the certificate incident, prove the matching forwarded host lets private HTTP requests through without redirecting them to the retired public hostname.
5. Push the implementation. Patch Coolify's `git_commit_sha` to that commit and read it back. Delete the exact production `SERVICE_URL_WEB` and `SERVICE_FQDN_WEB` environment records by UUID, read back that both are absent, and confirm `docker_compose_domains` remains empty. Stop the old stack, then prove the old hostname has no router to this app. Only then point Coolify at `docker/compose.tailscale-development.yaml`, deploy, wait for health, run all probes, and get a blocking-finding-free Fable High review.

## Files that change

- `docker/compose.tailscale-development.yaml`
- `ops/tailscale-development/serve.json`
- `ops/tailscale-development/probe.sh`
- `tools/verifyTailscaleDevelopmentDeployment.ts`
- focused test file for the deployment checker
- `package.json`
- `docs/evidence-library-operations.md`

Do not change the admin page, admin APIs, or bypass helper. They already implement the required behavior.

## Exact checks

```sh
npm run test:tailscale-development
npm run test:unit -- tests/unit/admin-access.test.ts
npm run config:validate -- /path/to/private-library.json
LIBRARY_CONFIG_JSON="$(jq -c . /path/to/private-library.json)" \
TAILSCALE_AUTHKEY=test-only-compose-value \
docker compose --project-directory . \
  -f docker/compose.tailscale-development.yaml config
git diff --check
```

After deployment, from a Tailscale device:

```sh
curl --fail-with-body http://openscholar-el-dev.tail40de7d.ts.net/api/library-config/health
curl --fail-with-body http://openscholar-el-dev.tail40de7d.ts.net/api/admin/library
```

Open these paths in a real browser on a Tailscale device:

- `http://openscholar-el-dev.tail40de7d.ts.net/lib`
- `http://openscholar-el-dev.tail40de7d.ts.net/admin`

From a non-Tailscale path, prove the old hostname and direct server IP do not reach this application. The old hostname must not return the library health JSON, admin workbench markers, or app-specific headers. A Cloudflare or shared-Traefik 404 is a pass. The app's streamed 404 can use HTTP 200, so check the response body as well as the status. If the old DNS record is removed, NXDOMAIN is also a pass.

Inspect the live Compose model and container ports. Prove there is no host port and no Traefik router for web. Confirm Tailscale Serve reaches `127.0.0.1:3000`, the forwarder listens only on loopback, and the forwarder reaches `web:3000` through the private application network.

## Deployability gate

- `docker compose config` succeeds with no host ports, no public route, Serve targeting loopback through the checked forwarder, Funnel off, and the bypass on.
- Coolify reports the Tailscale, web, and search-worker containers healthy. Its stored `git_commit_sha` and deployed commit both match the pushed commit.
- `tailscale serve status --json` shows HTTP 80 proxying to `127.0.0.1:3000` and no Funnel.
- The health endpoint returns the new active revision.
- `/admin` shows the real workbench without a login page.
- `/api/admin/library` returns `200` with `Cache-Control: private, no-store`.
- The old public hostname cannot reach this application.
- The Tailnet address does not redirect to the old hostname.

## Completion rules

- Coolify stores only `TAILSCALE_AUTHKEY` and `LIBRARY_CONFIG_JSON`; the checker asserts this.
- The public route is gone before the bypass is accepted as enabled.
- The library and admin paths work in a real browser over Tailscale.
- Search worker health stays green.
- Focused tests, runtime-config validation, Compose render, public denial, and private browser checks all pass.
- The pushed commit and deployment evidence receive a blocking-finding-free Fable High review.
- Update and reread the Evidence Library current-state page in Outline after the verified commit is pushed and deployed.

## Data migration choice

There is no database migration. Existing isolated development data stays in its current PostgreSQL database, Meilisearch index, and storage buckets. Only the runtime URL and deployment path change.

## Rollback

1. Stop the private stack so the bypass is no longer running.
2. Point Coolify back at `docker/compose.library.yaml`.
3. Store a new named runtime revision with the approved public `identity.baseUrl`.
4. Re-add the public domain only after the generic Compose is selected.
5. Deploy and verify the public library while confirming `/admin` and its APIs are hidden again.

Never attach a public domain to a deployment running the bypass Compose.

## Risks

- The current public route comes from saved production `SERVICE_URL_WEB` and `SERVICE_FQDN_WEB` records even though `docker_compose_domains` is empty. Resolve each record by exact key and production scope, delete it by UUID, read back that both are absent, and inspect effective labels before enabling the bypass.
- A mismatched `identity.baseUrl` redirects the private address to the old public hostname.
- Losing the Tailscale state volume forces the node to authenticate again.
- An unpinned sidecar image can change deployment behavior without a repository commit.
- An old hostname may still return a Cloudflare or shared-Traefik 404. It fails the boundary only if it reaches this application.
- Tailscale Serve does not overwrite `X-Real-IP`, while the current AI rate limiter reads that header. This development-only deployment accepts that limit and records it in the operating guide.
- Coolify 4.1.2 rejects Docker Compose custom YAML tags and adds its private application network to every service. Keep this file on ordinary YAML and normal service networking; do not enable Raw Compose as a server-only workaround.
- Tailscale Serve supports only loopback HTTP proxy targets. Keep the forwarder bound to `127.0.0.1`; never change Serve directly to a Docker service name.
- Tailscale reports an active certificate-creation incident. Private HTTP is encrypted by Tailscale but can face browser DNS-rebinding risks. This development-only bypass accepts that temporary limit; return to HTTPS with a clean replacement after certificate creation recovers.
