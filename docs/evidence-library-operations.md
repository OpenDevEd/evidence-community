# Evidence Library deployment and operations

This is the operational contract for deploying the shared Evidence Library
image. Each running application process serves one library from one validated
JSON document.

## Deployment contract

| Input | Required contract |
| --- | --- |
| Deployment | Use `docker/compose.library.yaml` so the web app and search worker use one repository-owned release |
| Image | Build the repository `Dockerfile`; do not pass customer build arguments |
| Configuration | Set `LIBRARY_CONFIG_JSON` to the complete validated runtime document; Compose mounts it at `LIBRARY_CONFIG_PATH` |
| Process | Each image prepares config access as root, then runs as UID/GID `1001` |
| Network | Expose `PORT`, default `3000`, through the deployment proxy |
| Client identity | The deployment proxy must overwrite `X-Real-IP`; never expose the application origin directly |
| Health | Probe `GET /api/library-config/health` |
| Dependencies | Make server-side services and upstreams reachable from the application; make public assets and browser analytics reachable from clients |

The Compose file sets `LIBRARY_CONFIG_PATH`. Library values and secrets belong
in `LIBRARY_CONFIG_JSON`, not in `NEXT_PUBLIC_*` variables or customer image
builds. The default deployment always includes one search worker. A web-only
deployment is incomplete because it cannot create search settings or publish
records into Meilisearch.

To change a Coolify deployment, update `LIBRARY_CONFIG_JSON` and redeploy the
repository Compose file. The host-directory steps below are only for running
the image directly with Docker. They do not apply to the Coolify Compose path.

Run Compose from the repository root. This matches Coolify and keeps the build
context on the repository Dockerfile and source tree:

```bash
LIBRARY_CONFIG_JSON="$(jq -c . config/library.example.json)" \
  docker compose --project-directory . \
  -f docker/compose.library.yaml config
```

## Private Tailscale development deployment

The isolated development library uses
`docker/compose.tailscale-development.yaml`. It reuses the shared web and search
worker services, adds a pinned Tailscale sidecar, and enables the existing
temporary admin bypass. It publishes no host port. Tailscale Serve is its only
ingress, and Funnel is off.

The private address is:

```text
http://openscholar-el-dev.tail40de7d.ts.net
```

The active tailnet must report `opendeved.net`, MagicDNS enabled, and the suffix
`tail40de7d.ts.net`. Check it before deployment:

```bash
tailscale status --json | jq '{BackendState, CurrentTailnet}'
```

Coolify application `rzbo9als0hdnr4gegtx97qos` stores only these deployment
inputs after its old generated-domain records are removed:

| Key | Purpose |
| --- | --- |
| `LIBRARY_CONFIG_JSON` | Complete validated runtime settings with `identity.baseUrl` set to the private address |
| `TAILSCALE_AUTHKEY` | Non-ephemeral reusable key used as the sidecar's `TS_AUTHKEY` |

The Compose file, Serve rules, image pin, loopback bridge, bypass setting,
health checks, and persistent Tailscale state all live in the repository. The
auth key is the only new secret. Tailscale state is saved in a named volume, so
ordinary container restarts do not need the key again.

Render and verify the repository contract before changing Coolify:

```bash
npm run test:tailscale-development
LIBRARY_CONFIG_JSON="$(jq -c . /path/to/private-library.json)" \
TAILSCALE_AUTHKEY=test-only-compose-value \
docker compose --project-directory . \
  -f docker/compose.tailscale-development.yaml config
```

Deploy in this order:

1. Validate a new named runtime revision whose `identity.baseUrl` is the private address.
2. Push the checked repository commit and point Coolify at that exact commit.
3. Delete the production `SERVICE_URL_WEB` and `SERVICE_FQDN_WEB` records by their exact Coolify environment UUIDs, read back that both are absent, and confirm `docker_compose_domains` is empty.
4. Stop the old stack and prove its public hostname no longer reaches this application.
5. Select `/docker/compose.tailscale-development.yaml`, store the two required inputs, deploy, and inspect the generated labels before accepting the bypass as safe.

After deployment, check all three containers and the Serve rules. The generated
Compose model must have no published host ports and no Traefik router labels.
Tailscale Serve must proxy private HTTP 80 to `127.0.0.1:3000`. The pinned `socat` process in
the repository-owned Tailscale image must listen only on that loopback address
and forward to `web:3000` over Coolify's private application network. Do not
enable Coolify's Raw Compose mode: the checked-in file works with the normal
parser and keeps the whole setup in the repository.

Run the live boundary probe from a device connected to the tailnet:

```bash
ops/tailscale-development/probe.sh \
  http://openscholar-el-dev.tail40de7d.ts.net \
  https://docs-openscholar-compose-e2e.opendev.space
```

Also open `/lib` and `/admin` at the private address in a real browser. The
admin API must return `Cache-Control: private, no-store`. The old public
hostname may return a Cloudflare or shared-proxy 404; that is safe as long as
it does not return this library's health data or admin workbench.

Tailscale Serve does not replace an incoming `X-Real-IP` header. The current AI
rate limiter trusts that header. This is accepted only for this private
development deployment because every caller is already inside the tailnet.

To roll back, stop the private stack first. Point Coolify back at
`/docker/compose.library.yaml`, store a new runtime revision with the approved
public address, restore the public domain records, and deploy. Confirm `/admin`
and every admin API are hidden before the public route is restored. Never add a
public domain to the Tailscale Compose deployment.

## Prepare a library for direct Docker use

Create a host directory whose owner can activate changes and whose numeric group
matches the container's GID `1001`. The setgid bit keeps atomically replaced
files in that group:

```bash
sudo install -d \
  -o "$(id -u)" \
  -g 1001 \
  -m 2750 \
  /srv/evidence-library/runtime
```

Start from the complete example and assign a new `revision` and `updatedAt`
whenever content changes:

```bash
cp config/library.example.json \
  /srv/evidence-library/runtime/candidate.json
chmod 0640 /srv/evidence-library/runtime/candidate.json
npm run config:validate -- \
  /srv/evidence-library/runtime/candidate.json
```

Validation checks the complete schema, limits, catalogs, and cross-field
dependencies without changing the active library. An equivalent permission
setup is valid as long as the application user can traverse the directory and
read `library.json`, while the operator can create and replace files.

## External configuration tooling

Every running image serves two value-free machine-readable contracts:

| URL | Purpose |
| --- | --- |
| `/library-config.schema.json` | Draft 2020-12 structural schema generated from the runtime Zod schema |
| `/library-config.catalogs.json` | Selectable values, rich platform options, extensible-choice markers, and write-only paths |

These artifacts describe fields and constraints but never contain values from
the active library. Paths marked `writeOnly` belong in server-side
configuration storage and are removed from the browser's public runtime
projection. The PostHog project key is intentionally not write-only because
the configured browser analytics client must receive it.

JSON Schema cannot express every custom refinement or cross-field dependency.
External tooling may use it for forms and immediate structural feedback, but
must use the runtime validation command before publishing:

```bash
npm run config:validate -- /path/to/candidate.json
```

Generated artifacts are committed for consumers and regenerated during builds.
CI can detect drift without rewriting files:

```bash
npm run schema:check
```

## Run the image directly

Build the shared image:

```bash
docker build -t evidence-library:local .
```

Activate the first configuration:

```bash
npm run config:activate -- \
  /srv/evidence-library/runtime/candidate.json \
  /srv/evidence-library/runtime/library.json
```

Run the image with the directory mounted read-only:

```bash
docker run -d \
  --name evidence-library \
  --restart unless-stopped \
  -p 3000:3000 \
  -e LIBRARY_CONFIG_PATH=/runtime/config/library.json \
  -v /srv/evidence-library/runtime:/runtime/config:ro \
  evidence-library:local
```

The image checks whether UID `1001` can read the configured file. When a
platform supplies a root-owned writable file mount, the image grants group
`1001` read access before dropping privileges. A read-only mount must already
be readable by UID or GID `1001`.

Mount the directory when configuration must change without a restart.
Activation replaces the file atomically. A single-file bind mount can remain
attached to the previous inode, so single-file mounts support restart-based
configuration delivery only.

The same image can serve another library by starting another container with a
different configuration directory, port, PostgreSQL database, and Meilisearch
index.

## Observe health

```bash
curl --fail-with-body http://127.0.0.1:3000/api/library-config/health
```

An active response contains revision metadata only:

```json
{
  "state": "active",
  "active": {
    "schemaVersion": 1,
    "revision": "example-1",
    "updatedAt": "2026-07-27T12:30:00.000Z"
  },
  "rejected": null
}
```

The full configuration and its secrets are never returned by this endpoint.
Responses use `Cache-Control: no-store`.

The endpoint returns:

| State | HTTP status | Meaning |
| --- | ---: | --- |
| Active configuration loaded | `200` | The process has a usable revision |
| Invalid update rejected; previous revision retained | `200` | Service remains available; JSON `state` is `rejected` |
| No valid revision has loaded | `503` | Startup/configuration failure |

The image health check uses this endpoint. Operational monitoring must also
alert when the JSON `state` is `rejected`, because the container intentionally
stays available on its last valid configuration.

This health route proves configuration availability. It does not prove
PostgreSQL, Meilisearch, SMTP, analytics, AI providers, or external assets are
healthy; monitor those dependencies separately and run the acceptance suite
before release.

## Activate a change without restarting

Validate and activate from a source checkout that can write the host directory:

```bash
npm run config:validate -- \
  /srv/evidence-library/runtime/candidate.json
npm run config:activate -- \
  /srv/evidence-library/runtime/candidate.json \
  /srv/evidence-library/runtime/library.json
```

Activation:

1. takes an exclusive activation lock;
2. validates and normalizes the candidate;
3. rejects a changed revision unless its `updatedAt` is newer than the active
   or rejected target revision;
4. preserves the previous valid revision as `library.json.previous`;
5. replaces `library.json` atomically;
6. preserves the active file mode.

The next full application request observes the replacement. A revision may be
reused only when its normalized content is identical; changed content requires
a new revision.

Confirm the exact revision:

```bash
curl --fail-with-body http://127.0.0.1:3000/api/library-config/health
```

## Rejection and rollback

If a malformed or invalid replacement appears after a valid revision has
loaded, production requests continue using the last valid configuration. The
health response reports both the retained `active` revision and the rejected
revision metadata.

Roll back to `library.json.previous`:

```bash
npm run config:activate -- --rollback \
  /srv/evidence-library/runtime/library.json \
  --health-url http://127.0.0.1:3000/api/library-config/health
```

Rollback validates the backup and publishes it as a new revision with a newer
`updatedAt`; it does not reuse the historical revision identifier. Supplying
the health URL is required when the active file is invalid so rollback can
remain monotonic.

If the application is stopped or health returns `503`, use the last recorded
active `updatedAt` value from monitoring or release metadata instead:

```bash
npm run config:activate -- --rollback \
  /srv/evidence-library/runtime/library.json \
  --minimum-updated-at 2026-07-27T12:30:00.000Z
```

Only one activation or rollback may run at a time. If an operation reports an
existing `.activation.lock`, verify that no configuration operation is still
running before removing a stale lock.

## Runtime URLs and assets

- Logos, favicons, institution logos, navigation images, fonts, and similar
  public assets are rendered from their configured URLs. The browser must be
  able to reach them.
- Enabled gap maps are streamed through
  `/gapmaps/<slug>.html`; the application server fetches their configured
  source URLs and accepts approved HTML content types.
- Enabled RIS and BibTeX exports are streamed through `/lib/export/ris` and
  `/lib/export/bibtex`; Atom is streamed through `/lib/atom.xml`. The
  application validates upstream status and content type.
- Proxied gap maps and exports are not cached by the application.
- PostgreSQL, Meilisearch, SMTP, server analytics, and AI provider endpoints
  must be reachable from the container network. Browser analytics hosts must
  also be reachable from the user's browser.
- Paid AI generation endpoints allow ten requests per `X-Real-IP` per minute.
  The application deliberately trusts only that proxy-owned header and groups
  requests without it into one fail-closed bucket.

## Release verification

Run the complete local contract before deploying the shared image:

```bash
npm run lint
npx tsc --noEmit
npm run schema:check
npm run test:unit
npm run test:acceptance
```

`npm run test:acceptance` starts real PostgreSQL, Meilisearch, Mailpit, and
HTTPS upstream fixtures. It verifies two libraries, independently enabled and
disabled integrations, mobile behavior, secret boundaries, live activation,
rejection, last-valid retention, and rollback using the same image.
