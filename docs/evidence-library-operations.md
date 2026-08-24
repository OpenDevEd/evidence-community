# Evidence Library deployment and operations

This is the operational contract for deploying the shared Evidence Library
image. Each running application process serves one library from one validated
JSON document.

## Deployment contract

| Input           | Required contract                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment      | Use `docker/compose.library.yaml` so the web app, workers, and private Meilisearch use one repository-owned release                     |
| Image           | Build the repository `Dockerfile`; do not pass customer build arguments                                                                 |
| Configuration   | Set `LIBRARY_CONFIG_JSON` to the complete validated runtime document; Compose mounts it at `LIBRARY_CONFIG_PATH`                        |
| Process         | Each image prepares config access as root, then runs as UID/GID `1001`                                                                  |
| Network         | Expose `PORT`, default `3000`, through the deployment proxy                                                                             |
| Client identity | The deployment proxy must overwrite `X-Real-IP`; never expose the application origin directly                                           |
| Health          | Probe `GET /api/library-config/health`                                                                                                  |
| Dependencies    | Make server-side services and upstreams reachable from the application; make public assets and browser analytics reachable from clients |

The Compose file sets `LIBRARY_CONFIG_PATH`. Library values and secrets belong
in `LIBRARY_CONFIG_JSON`, not in `NEXT_PUBLIC_*` variables or customer image
builds. `sources[]` lists every Zotero group the library can import from and,
with `writebackEnabled: true`, write to; records choose their own sources at
publish time and there is no default writeback source. The default deployment includes the search, source-sync, and
source-writeback, and publication workers plus one private persistent
Meilisearch service. A web-only deployment is incomplete.

Set the Coolify application field `connect_to_docker_network` to `false` through
the provisioning API. The checked-in Compose attaches only the five runtime
containers to the external `coolify` network. Meilisearch stays on the private
application network, so another library cannot share its service-name DNS.

To change a Coolify deployment, update `LIBRARY_CONFIG_JSON` and redeploy the
repository Compose file. The host-directory steps below are only for running
the image directly with Docker. They do not apply to the Coolify Compose path.

Run Compose from the repository root. This matches Coolify and keeps the build
context on the repository Dockerfile and source tree:

```bash
MEILISEARCH_MASTER_KEY="$(jq -r .services.search.key config/library.example.json)" \
LIBRARY_CONFIG_JSON="$(jq -c '.services.search.host = "http://meilisearch:7700"' config/library.example.json)" \
  docker compose --project-directory . \
  -f docker/compose.library.yaml config
```

## Create a library database

Libraries share one PostgreSQL server, but each library has its own database
and login. Create both with the checked-in command. Do not run one-off SQL:

```bash
npm run database:provision -- \
  --admin-url "$EVIDENCE_LIBRARY_ADMIN_DATABASE_URL" \
  --database example_library \
  --user example_library_user \
  --password "$EXAMPLE_LIBRARY_DATABASE_PASSWORD" \
  --runtime-host evidence-library-postgres:5432
```

The command removes powerful login rights, removes role memberships, blocks
public database access, and prints the database URL for the runtime config.
Running the same command again is safe. It stops if the database belongs to a
different login or the login already owns another database.

Prove the rule against a real development PostgreSQL server:

```bash
EVIDENCE_LIBRARY_ADMIN_DATABASE_URL="$EVIDENCE_LIBRARY_ADMIN_DATABASE_URL" \
  npm run test:database-provisioning
```

The check creates two temporary databases, runs every Drizzle migration, proves
both cross-library connections fail, reruns provisioning, and removes its test
databases and logins.

## HTTPS and admin access

Every library uses the normal Compose file and a public HTTPS origin. Set
`identity.baseUrl` to that exact HTTPS origin. Coolify must force HTTP requests
to HTTPS and route the hostname to the `web` service on port `3000`.

The private runtime configuration must contain both
`authentication.adminPassword` and `authentication.secret`. The password form
creates a signed 12-hour cookie. The cookie is HTTP-only, same-site strict,
host-only, and secure in production. It contains no password. Changing either
private value signs out every existing session.

The public library stays open. `/admin` shows the password form when signed
out. Every admin data API returns `401` with `Cache-Control: private, no-store`
unless it receives a valid cookie. Login failures share a small fixed window
per client address. The deployment proxy must overwrite `X-Real-IP` so an
internet caller cannot choose that address.

After deployment, check the HTTP redirect, the HTTPS certificate, the login
form, reload persistence, logout, and one real PDF upload. In the browser,
`window.isSecureContext` must be true and `crypto.subtle` must exist.

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

| URL                             | Purpose                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `/library-config.schema.json`   | Draft 2020-12 structural schema generated from the runtime Zod schema                     |
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
different configuration directory, port, PostgreSQL database, and private
Meilisearch service.

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

| State                                               | HTTP status | Meaning                                               |
| --------------------------------------------------- | ----------: | ----------------------------------------------------- |
| Active configuration loaded                         |       `200` | The process has a usable revision                     |
| Invalid update rejected; previous revision retained |       `200` | Service remains available; JSON `state` is `rejected` |
| No valid revision has loaded                        |       `503` | Startup/configuration failure                         |

The image health check uses this endpoint. Operational monitoring must also
alert when the JSON `state` is `rejected`, because the container intentionally
stays available on its last valid configuration.

This health route proves configuration availability. It does not prove
PostgreSQL, Meilisearch, SMTP, analytics, AI providers, or external assets are
healthy; monitor those dependencies separately and run the acceptance suite
before release.

## Decide whether a Compose deployment is ready

Keep the Coolify deployment result, Compose service state, and configuration
response as separate evidence. Do not copy them into another readiness store.
A library is ready only when all of these checks pass:

1. Coolify reports that the requested deployment succeeded.
2. `docker compose ps --all` reports one container for `web`,
   `search-indexer`, `source-sync`, `source-writeback`, `publication-worker`,
   and `meilisearch`. None is missing, exited, restarting, dead, or unhealthy.
3. `web`, `search-indexer`, `publication-worker`, and `meilisearch` are
   healthy. `source-sync` and `source-writeback` are running.
4. `GET /api/library-config/health` returns `200`, reports `state: "active"`,
   reports the requested `active.revision`, and has no rejected revision.
5. The public library URL and `/admin` return a successful HTTP response.

The source workers intentionally have no container health check. An idle source
worker has no active connection lease to refresh. Its running container is the
startup signal. Per-connection run and error records remain the source of truth
for later import or writeback failures.

Use the existing Compose result to name a missing, exited, or unhealthy
container. Use the existing Coolify deployment result to name a failed build or
deployment step. Do not replace either result with a second health state
machine. A successful configuration response alone never makes the deployment
ready.

From a host with access to the application, inspect the same evidence with:

```bash
docker compose --project-directory . \
  -f docker/compose.library.yaml ps --all --format json
curl --fail-with-body https://library.example.org/api/library-config/health
curl --fail-with-body https://library.example.org/en/lib
curl --fail-with-body https://library.example.org/admin
```

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
npm run check:changed
npm run test:acceptance
```

`npm run test:acceptance` first starts the repository Compose deployment with
all five required processes and its private Meilisearch. It checks real Compose
state and health, the active revision, the public site, and `/admin`. The rest
of the suite starts two disposable libraries, PostgreSQL, Meilisearch, Mailpit,
workers, and local HTTPS fixtures for external services. It runs every desktop
and mobile browser check, including the complete mocked Crossref and Zenodo
publication flow. It also verifies independently enabled and disabled
integrations, secret boundaries, live activation, rejection, last-valid
retention, and rollback using the same production image.

The command removes its Docker environment when it ends. If a run was
interrupted, or was started with `--keep` for live inspection, remove its
environment before ending the work:

```bash
npm run test:acceptance:cleanup
```

The cleanup command removes only Evidence Library acceptance environments whose
test process has ended. It leaves active tests and unrelated development
containers running.

## Real publication sandbox checks

These commands may write only to the docs-pen Crossref Test and Zenodo Sandbox
accounts. They create one record and reuse one saved evidence file across all
three checks.

```bash
export PUBLICATION_SANDBOX_CONFIRM=docs-pen
export PUBLICATION_SANDBOX_BASE_URL=https://docs-pen.opendev.space
export PUBLICATION_SANDBOX_RUN_ID=docs-pen-$(date +%Y%m%d-%H%M%S)
export PUBLICATION_EXPECTED_CROSSREF_PREFIX=10.53832
export PUBLICATION_EXPECTED_CROSSREF_NAMESPACE=docs-pen.
export PUBLICATION_SANDBOX_EVIDENCE_PATH=/tmp/${PUBLICATION_SANDBOX_RUN_ID}.json
export EVIDENCE_LIBRARY_ADMIN_PASSWORD='<docs-pen admin password>'

npm run test:crossref-test-live
npm run test:zenodo-sandbox-live
npm run test:publication-sandbox-lifecycle
```

The scripts stop before creating a record unless the website, provider
environments, DOI prefix, namespace, admin login, and publication worker all
match docs-pen. The final JSON contains the record keys, DOI, Crossref Test
submission IDs, Zenodo Sandbox record ID, and PDF hashes. It does not contain
provider credentials.
