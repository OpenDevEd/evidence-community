# Evidence Library deployment and operations

This is the operational contract for deploying the shared Evidence Library
image. Each running application process serves one library from one validated
JSON document.

## Deployment contract

| Input           | Required contract                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment      | Use `docker/compose.library.yaml` so the web app, workers, and private Meilisearch use one repository-owned release                      |
| Image           | Set `RUNTIME_IMAGE` to `ghcr.io/opendeved/evidence-library-runtime@sha256:<64 lowercase hex characters>`                                 |
| Configuration   | Set `LIBRARY_CONFIG_JSON` to the complete validated seed document; Compose initializes the writable `LIBRARY_CONFIG_PATH` volume from it |
| Release         | Set Coolify's `SOURCE_COMMIT` value on every service through the checked-in release label                                                |
| Process         | Each image prepares config access as root, then runs as UID/GID `1001`                                                                   |
| Network         | Expose `PORT`, default `3000`, through the deployment proxy                                                                              |
| Client identity | The deployment proxy must overwrite `X-Real-IP`; never expose the application origin directly                                            |
| Health          | Probe `GET /api/library-config/health`                                                                                                   |
| Dependencies    | Make server-side services and upstreams reachable from the application; make public assets and browser analytics reachable from clients  |

The Compose file seeds one named configuration volume from
`LIBRARY_CONFIG_JSON`, then mounts the active file at `LIBRARY_CONFIG_PATH` in
the web app and all four workers. Library values and secrets belong in this
server-only document, not in `NEXT_PUBLIC_*` variables or customer image
builds. `sources[]` lists every Zotero group the library can import from and,
with `writebackEnabled: true`, write to; records choose their own sources at
publish time and there is no default writeback source. The default deployment
has seven services: the web app, four workers, private persistent Meilisearch,
and private ephemeral Redis. A web-only deployment is incomplete.

Set the Coolify application field `connect_to_docker_network` to `false` through
the provisioning API. The checked-in Compose attaches only the five runtime
containers to the external `coolify` network. Meilisearch stays on the private
application network, so another library cannot share its service-name DNS.

`LIBRARY_CONFIG_JSON` is the startup and software-update seed. An ordinary
configuration publish uses the authenticated runtime API described below and
does not redeploy the Compose application. A software update or routing change
still updates the seed and replaces the application through the deployment
platform. The host-directory steps below are only for running the image
directly with Docker. They do not apply to the Compose path.

Run Compose from the repository root with the immutable image reference:

```bash
MEILISEARCH_MASTER_KEY=example-meilisearch-key \
LIBRARY_CONFIG_JSON="$(jq -c '.services.search = {engine: "meilisearch", meilisearch: {host: "http://meilisearch:7700", key: "example-meilisearch-key", index: "example_library"}}' config/library.example.json)" \
SOURCE_COMMIT="$(git rev-parse HEAD)" \
RUNTIME_IMAGE="ghcr.io/opendeved/evidence-library-runtime@sha256:<digest>" \
  docker compose --project-directory . \
  -f docker/compose.library.yaml config
```

Every service gets the label
`org.opendeved.evidence-library.release=$SOURCE_COMMIT`. Keep **Include Source
Commit in Build** off and **Escape special characters in labels** off.
Openscholar manages both settings, writes `SOURCE_COMMIT` as a Coolify
environment value, and checks the saved values after every application update.
Coolify escapes dollar signs in labels by default; leaving that setting on
stores the Compose expression as text instead of the release commit. Enabling
source commits in builds also invalidates the Docker build cache on every
commit. See Coolify's [application update API](https://coolify.io/docs/api-reference/api/applications/update-application-by-uuid)
and [Docker Compose build settings](https://coolify.io/docs/applications/build-packs/docker-compose).

## Publish a runtime image

`.github/workflows/runtime-image.yml` publishes one private GHCR image after
the complete `CI` workflow succeeds for an exact commit on `main`. Its release
runner has a separate OS user, Docker daemon, BuildKit cache and GitHub runner
group. The publish job receives `packages: write`; test jobs do not.

The image tag is the 40-character source commit. Deployments use the digest
reported in the workflow summary, never the tag. An existing tag is accepted
only when its image revision label matches that commit, and the job does not
rewrite it.

The workflow has four jobs. `select` checks the commit and finds the previous
release. `publish` builds the image on the release runner while `notes` writes
the release notes on a light runner. `release` waits for both and creates the
GitHub Release `runtime-<commit>` as a prerelease. Openscholar offers only
commits that have a release, so a failed build or failed notes never reach a
library owner. Rerun the workflow to retry; an existing image is reused and the
notes are written again.

Shared dev offers a prerelease as soon as it's published. Production offers a
release only after it's promoted on Openscholar's community releases page
(`/settings/admin/community-releases`), which clears GitHub's prerelease flag.
Communities move from that page one at a time, smallest first. Updates only go
forward; going back is done by hand on the server.

### Release notes

`.github/scripts/release-notes.mjs` turns the first-parent commits since the
previous release into notes for library owners. It reads each pull request's
title and body with the workflow token, asks `openai/gpt-6-luna` through
OpenRouter at maximum reasoning for a strict JSON answer, and prints the
release body. The `OPENROUTER_API_KEY` repository secret is the only setup.

The body has a fixed shape that Openscholar parses: the first line is a
one-sentence summary and every `- ` line is one note. Other lines, such as the
image reference, are ignored, except `Database changes: <count>`, the migrations
added since the previous release, which the releases page shows. Edit the
release body in GitHub to fix wording;
Openscholar picks the change up on its next check. When nothing is visible to
owners the body says "Behind-the-scenes improvements and maintenance."

For release recovery, run **Runtime image** from GitHub Actions and enter the
exact commit. The workflow accepts only a commit in `main` with a successful
`main` push run of `CI`. A commit that already has a release keeps it; only the
image is checked again.

## Run the library runtime verifier

Deploy one runtime verifier for the development server from
`docker/compose.runtime-verifier.yaml`. It has two services:

- `runtime-verifier` is the only service on the external `coolify` network and
  the only service that receives a public HTTPS domain.
- `docker-socket-proxy` mounts the host Docker socket and stays on an internal
  network. The pinned Tecnativa proxy allows the verifier to inspect images,
  manage its guard containers, and attach them to the two required networks.

The verifier container never mounts `/var/run/docker.sock`. It calls the proxy
at `http://docker-socket-proxy:2375`. It writes the per-library Traefik routes
to `/data/coolify/proxy/dynamic` and copied guard configurations to
`/data/evidence-library-runtime-guards`; both host paths are mounted by the
Compose file. Set one environment value:

| Variable                                  | Value                                    |
| ----------------------------------------- | ---------------------------------------- |
| `EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN` | Bearer token containing 32 to 1024 bytes |

`PORT` defaults to `3000`. Assign the verifier's public HTTPS domain to
`runtime-verifier:3000`. Port `3001` serves the temporary maintenance response
and, at `/released`, the 404 page for released custom domains. It is reached
only through the verifier's Traefik routes inside the shared proxy network and
must not receive a public domain or host port. Do not assign a domain or host port to `docker-socket-proxy`.

The executable is also available as a package command:

```bash
EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN='<32-byte-or-longer token>' \
EVIDENCE_LIBRARY_RUNTIME_VERIFIER_DOCKER_URL='http://127.0.0.1:2375' \
EVIDENCE_LIBRARY_MAINTENANCE_URL='http://127.0.0.1:3001' \
EVIDENCE_LIBRARY_TRAEFIK_DYNAMIC_PATH='/data/coolify/proxy/dynamic' \
EVIDENCE_LIBRARY_RUNTIME_GUARD_STATE_PATH='/data/evidence-library-runtime-guards' \
  npm run runtime:verifier
```

Readiness remains one fixed request:

```http
POST /v1/library-runtime/readiness
Authorization: Bearer <EVIDENCE_LIBRARY_RUNTIME_VERIFIER_TOKEN>
Content-Type: application/json

{"applicationUuid":"<24-character Coolify application UUID>","commit":"<40-character Git commit>","runtimeImage":"ghcr.io/opendeved/evidence-library-runtime@sha256:<64 lowercase hex characters>"}
```

It asks Docker for containers whose `com.docker.compose.project` label exactly
matches the requested application UUID. It checks the Coolify and project
labels before inspecting a container, then checks them again in the inspect
response. It returns ready only when the seven expected services are running,
the services with health checks are healthy, every release label matches the
requested commit, and Meilisearch has no published host port. It also checks
that the five Evidence Library services name the exact requested image, that
Docker reports the requested digest for their local image, and that all five
containers have the same image ID.

Docker calls time out after two seconds. Each response is capped at 512 KiB,
and one application can return at most 24 containers. Bad Docker data and proxy
errors return the fixed `runtime_inspection_failed` response. Docker error text
never reaches the caller.

Openscholar also uses six fixed route operations:

| Path                               | Effect                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/v1/library-runtime/maintenance`  | Routes a first activation to the maintenance response.                                                               |
| `/v1/library-runtime/protection`   | Copies the active config, starts or reuses one temporary web guard, then routes all current and pending hosts to it. |
| `/v1/library-runtime/activation`   | Tries the ready replacement while retaining the guard as its fallback.                                               |
| `/v1/library-runtime/finalization` | Writes the permanent custom-domain route, then removes the guard, copied config, and guard route.                    |
| `/v1/library-runtime/domains`      | Replaces the permanent custom-domain route between deployments.                                                      |
| `/v1/library-runtime/removal`      | Removes both routes, the guard, and copied config during teardown.                                                   |

The first four receive `applicationUuid`, `commit`, `runtimeImage`, `revision`,
one or two `platformOrigins`, and up to twenty transition `customOrigins`.
Domains receives only `applicationUuid` and up to twenty `customOrigins`, and
answers `{"status":"routed","customOrigins":[...]}` with the normalized origins.
Removal receives only `applicationUuid`. Callers cannot supply a container
name, command, image outside the pinned runtime reference, file path, network,
upstream address, or Traefik rule.

### Permanent custom-domain routes

Custom domains do not use Coolify domain labels, so attaching or detaching one
needs no redeploy. The verifier writes
`ode-evidence-library-domains-<applicationUuid>.yaml` to the Traefik dynamic
directory, and Traefik reloads it in about two seconds. Its HTTPS router sends
the custom hosts to Coolify's platform-address service, `https-0-<uuid>...@docker`.
The verifier reads that name from the web container's labels each time,
because Coolify versions name it differently. It uses the one running web
container, which must be healthy when it has a health check, and ignores exited
ones. It fails with `runtime_web_not_ready` when there is no such container and
with
`runtime_web_route_missing` when the label is absent, instead of writing a
dangling route. An empty list deletes the file. If 20 seconds have passed
since the request arrived, it changes nothing and answers 503
`runtime_route_deadline`. Openscholar stops waiting after 30 seconds, so a late
write could otherwise replace a newer host set.

Its routers use priority 100000. The temporary guard route uses 200000 and wins
during a deployment. Coolify label routers default to their rule length, so
they stay below both. Finalization writes the domains file from its
`customOrigins` before it deletes the guard route, so custom hosts always have
a route and a renamed Coolify service is picked up at every deployment.

Coolify's label router for a removed host keeps sending it to the library until
the next deployment recreates the container. So the domains operation reads the
previous file first. Every host it routed or released that is missing from the
new list becomes a released host. Released hosts get their own `http` and
`https` routers, `<name>-released-http` and `<name>-released-https`, at
priority 50000. That beats every label router and loses to any custom route,
so re-adding the host, here or on another library, takes it back. They rewrite
the path to `/released` on the maintenance port, which answers 404 "This
address is not in use" with `Cache-Control: no-store`. The file keeps the 20
most recently released hosts. Older ones fall back to their label router until
the next deployment. A file with released hosts but no custom hosts holds only
the released routers. Finalization writes no released routers, because the
deployment has just replaced the labels. If the previous file is not the
verifier's own JSON, the operation changes nothing and answers 500
`runtime_domains_route_unreadable`.

| Router                          | Priority          |
| ------------------------------- | ----------------- |
| Temporary guard                 | 200000            |
| Custom domains                  | 100000            |
| Released custom domains         | 50000             |
| Coolify labels                  | Rule length       |

Every route host must be a lowercase DNS name with at least two labels: only
letters, digits, and inner hyphens, 63 characters per label and 253 in total,
with no trailing dot. Punycode names are allowed. Traefik renders dynamic files
as Go templates, so braces or backticks in a host would break the file. The
verifier writes every route file by atomic replacement from
machine-rendered JSON. Never hand-edit these files: while any file in the
dynamic directory is malformed, Traefik ignores all later file-provider
changes.

The guard is only the current `web` image plus a copied active configuration.
It joins the same private application network and the shared proxy network. It
does not start duplicate workers, Redis, Meilisearch, or storage. A failed
replacement therefore leaves the last public site serving; search and other
private services may still be briefly unavailable while their containers are
replaced. A first activation has no old site, so it serves the maintenance
response until the replacement passes readiness.

The verifier is a host control-plane service. Its bearer-protected endpoint
must remain private to Openscholar because its Docker proxy permissions can
create and remove guard containers and connect them to networks.

## Delete library volumes

Deploy one fixed volume deleter on the development Coolify server from
`docker/compose.volume-deleter.yaml`. The service receives a public HTTPS
domain because hosted Openscholar actions must reach it. Set one environment
value:

| Variable                                | Value                                    |
| --------------------------------------- | ---------------------------------------- |
| `EVIDENCE_LIBRARY_VOLUME_DELETER_TOKEN` | Bearer token containing 32 to 1024 bytes |

Assign the domain to `volume-deleter:3000`. The container mounts the host
Docker socket because Docker has no narrower credential for removing one
volume. It exposes no Docker proxy. Keep the endpoint token private and do not
place unrelated services in this Compose resource.

The service accepts one deletion request:

```http
POST /v1/library-volumes/delete
Authorization: Bearer <EVIDENCE_LIBRARY_VOLUME_DELETER_TOKEN>
Content-Type: application/json

{"applicationUuid":"<24-character Coolify application UUID>"}
```

The request accepts only `applicationUuid`. The service derives
`<application-uuid>_meilisearch-data` and
`<application-uuid>_library-config-data`; callers cannot send a volume name,
Docker path or command. It asks Docker for every container that references the
derived volume and returns `volume_in_use` without deleting when any exists.
It then inspects the volume, deletes it without force and inspects it again.
Success is `outcome: "deleted"` or the idempotent `outcome: "absent"`.
Unexpected Docker responses, timeouts and an unconfirmed deletion return the
fixed `volume_deletion_failed` response. Docker response text never reaches
the caller.

Openscholar calls this service after deleting the matching Coolify
application. A `volume_in_use` or `volume_deletion_failed` result keeps the
library teardown pending for retry. Teardown is complete only after the
service confirms both derived volumes and the private network are absent.
The service also removes `<application-uuid>_private` after checking its
Compose project label. It detaches only Coolify's proxy endpoint. Any remaining
library or unknown container blocks cleanup. Other networks stay unchanged.

## Create a library database

Libraries share one PostgreSQL server, but each library has its own database
and login. Openscholar creates them through the database provisioner. Build the
small provisioner image from its named Docker target:

```bash
docker build --target database-provisioner \
  --tag evidence-library-database-provisioner .
```

The container reads these values only from its environment:

| Variable                                      | Value                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `EVIDENCE_LIBRARY_ADMIN_DATABASE_URL`         | PostgreSQL administrator URL used to create databases, logins, and extensions      |
| `EVIDENCE_LIBRARY_DATABASE_RUNTIME_HOST`      | Internal PostgreSQL host and optional port written into each library's runtime URL |
| `EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN` | Bearer token with at least 32 bytes                                                |
| `EVIDENCE_LIBRARY_SEARCH_ADMIN_URL`           | The shared Elasticsearch with its administrator login, `http://elastic:<password>@evidence-library-elasticsearch:9200` |
| `EVIDENCE_LIBRARY_SEARCH_RUNTIME_HOST`        | Where libraries reach that Elasticsearch, written into each search receipt: `http://evidence-library-elasticsearch:9200` |
| `PORT`                                        | HTTP port, default `3000`                                                          |

`GET /health` returns `{"status":"ok"}`. Database setup uses this endpoint:

```http
POST /v1/library-databases/reconcile
Authorization: Bearer <EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN>
Content-Type: application/json

{"libraryId":"<Openscholar Evidence Library ID>","password":"<saved database password>"}
```

The request accepts only `libraryId` and `password`. The service derives the
database and login names from the library ID. Callers cannot send a PostgreSQL
host, administrator URL, database name, login name, migration path, or SQL.

A successful request returns:

```json
{
	"libraryId": "<same Openscholar Evidence Library ID>",
	"outcome": "created",
	"databaseName": "el_...",
	"loginName": "el_..._user",
	"databaseUrl": "postgresql://..."
}
```

`libraryId` is the exact ID from the request so Openscholar can bind the receipt
to the setup operation. `outcome` is `created` for a new database, `matched`
when the saved request already matches PostgreSQL, and `updated` when
reconciliation repairs a safe existing database. Error responses use the bounded
`{"error":{"code":"...","message":"..."}}` shape and do not return database
errors or environment values.

The administrator creates the login and database, removes powerful rights and
role memberships, revokes public database access, and installs `vector` and
`pg_trgm`. The restricted library login then runs every checked-in Drizzle
migration. A retry uses the same names and password. The service stops if
another login owns the database, the login has server-wide rights, or it owns
another database.

Development teardown uses the same authenticated service:

```http
POST /v1/library-databases/delete
Authorization: Bearer <EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN>
Content-Type: application/json

{"libraryId":"<Openscholar Evidence Library ID>"}
```

The request accepts only `libraryId`. The service derives the database and
login names, stops connections to that database, drops the database, drops the
restricted login, and reads both back. It refuses to delete a database owned by
another login, a login with server-wide rights or role memberships, or a login
that owns another database. A retry returns `outcome: "absent"` after both
resources are gone.

Operators can run the same reconciler directly for a chosen database and login.
Do not replace it with one-off SQL:

```bash
npm run database:provision -- \
  --admin-url "$EVIDENCE_LIBRARY_ADMIN_DATABASE_URL" \
  --database example_library \
  --user example_library_user \
  --password "$EXAMPLE_LIBRARY_DATABASE_PASSWORD" \
  --runtime-host evidence-library-postgres:5432
```

The command prints the same outcome, database name, login name, and runtime URL
as the HTTP service.

Prove the rule against a real development PostgreSQL server:

```bash
EVIDENCE_LIBRARY_ADMIN_DATABASE_URL="$EVIDENCE_LIBRARY_ADMIN_DATABASE_URL" \
  npm run test:database-provisioning
```

The check creates two temporary databases, confirms reconciliation ran every
Drizzle migration, proves both cross-library connections fail, checks
`created`, `matched`, and `updated`, rejects a conflicting owner, and removes
its test databases and logins.

## Copy old-key redirects out of Meilisearch

From the release with OpenDevEd/new-el#716 on, an old record key redirects
from the library's `itemRedirect` table in PostgreSQL instead of Meilisearch's
`redirects` index. The table starts empty, so old-key links stop redirecting
until the copy runs. Run it in each library's `search-indexer` container (its
Coolify terminal, or `docker exec`) right after that release, while the
library's `services.search` still names its Meilisearch:

```bash
npm run -s search:copy-redirects
```

It prints `{"indexFound":true,"read":...,"copied":...,"otherLibraries":...,"unreadable":...}`.
`copied` counts this library's redirects. `otherLibraries` counts documents of
other libraries sharing the index, which it leaves alone. `unreadable` counts
documents that name no record key; check them if it isn't 0.
`"indexFound":false` means the library never had redirects. Running it again
changes nothing. Copy every library before it moves to Elasticsearch
(OpenDevEd/new-el#722): after that the copy can't reach Meilisearch.

## Upgrade to a chosen search engine

From the release with OpenDevEd/new-el#722 on, `services.search` names the
library's engine and holds each engine's connection:

```json
"search": {"engine": "meilisearch", "meilisearch": {"host": "http://meilisearch:7700", "key": "<key>", "index": "<index>"}}
```

Until OpenScholar writes `engine`, this runtime reads the old
`{host, key, index}` shape as a library on Meilisearch, so libraries upgrade
with the configuration they have. The old shape goes once OpenScholar sends
`engine` for every library. An older runtime rejects the new shape.

On each library host, before this runtime:

1. Deploy the shared Elasticsearch ("Run the shared Elasticsearch" below).
   Every library's Compose file joins its `library-search` network, so even a
   library that stays on Meilisearch fails to start on a host without it.
2. Set `EVIDENCE_LIBRARY_SEARCH_ADMIN_URL` and
   `EVIDENCE_LIBRARY_SEARCH_RUNTIME_HOST` on the database provisioner and attach
   it to `library-search`. Without them the provisioner refuses to start, and
   setting up a new library's database stops with it.

Then, for each library:

3. Deploy this runtime with the library's configuration as it is. Migration
   `0098` records Meilisearch as the engine readers search for every library
   whose worker has built an index, so readers see no change.
4. To move the library to Elasticsearch, add the `elasticsearch` connection
   from its search receipt and set `engine` to `elasticsearch`. Do this only
   once OpenScholar sends `engine`: the runtime refuses any revision without a
   connection for the engine the active one chose, so OpenScholar's old shape
   can no longer publish to a library on Elasticsearch, and a redeploy whose
   `LIBRARY_CONFIG_JSON` lacks it doesn't start (its log names
   `SEARCH_ENGINE_DROPPED`). The search
   worker builds the Elasticsearch index while readers stay on Meilisearch,
   then moves them and deletes the Meilisearch index (`docs/search-indexing.md`,
   "Switching engines"). Records get their vectors after the move: until the
   backfill finishes, Similar Resources answers 503 and AI search ranks by
   words alone (about 17 minutes for AIED on OpenRouter, 28 hours on a 16-core
   CPU model).

Rollback: deploy the previous image with the previous configuration revision.
This runtime saves the library's active configuration in the new shape; the
older runtime finds that file invalid and starts from the revision it is given.
A library still on Meilisearch notices nothing, before or after rolling forward
again. A library that had moved to Elasticsearch has no Meilisearch index left;
the older worker refills it from PostgreSQL, and search finds only the records
indexed so far until it finishes. Rolling forward rebuilds its Elasticsearch
index on its own, since the projection signature the older worker stored differs
(`drizzle/rollback/0098_search-engine.sql`).

## Run the shared Elasticsearch

Every library on a host searches one Elasticsearch, deployed once per host from
`docker/compose.search.yaml` as its own Coolify application, before the
libraries. It builds `docker/elasticsearch.Dockerfile` (Elasticsearch 9.5.5 on
the free Basic licence, with the ICU plugin), keeps its data in the
`elasticsearch-data` volume, publishes no port, and creates the
`library-search` network. Each library's `web` and `search-indexer` containers
join that network and reach it as
`http://evidence-library-elasticsearch:9200`, a name no other application on
the shared `coolify` network answers to; the other workers don't. Set
`ELASTICSEARCH_ADMIN_PASSWORD`, and `ELASTICSEARCH_HEAP` (4 GB by default: the
heap held 2.0 GB with AIED's 282,948 records and Wealth Inequality's 56,098
loaded together). Leave memory beside the heap for every library's vectors:
about `records × dimensions × 4` bytes each, 1.2 GB for AIED at 1,024
dimensions (`docs/search-indexing.md`, Embedder). Set `vm.max_map_count` to at
least 262144 on the host (`sysctl -w vm.max_map_count=262144`, and in
`/etc/sysctl.d/` to keep it): single-node mode skips the check that would
otherwise refuse to start below it, and the index fails under load instead.

`ELASTIC_PASSWORD` sets the `elastic` password on the first start only. To
change it later, change it in Elasticsearch first
(`POST /_security/user/elastic/_password`), then `ELASTICSEARCH_ADMIN_PASSWORD`
and the provisioner's `EVIDENCE_LIBRARY_SEARCH_ADMIN_URL`; otherwise the health
check and the provisioner get 401.

The database provisioner joins `library-search` too and creates each library's
login with the same token and request as its database:

```http
POST /v1/library-search/reconcile
Authorization: Bearer <EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN>
Content-Type: application/json

{"libraryId":"<OpenScholar Evidence Library ID>","password":"<saved search key>"}
```

It answers `{"libraryId":"...","outcome":"created","host":"http://evidence-library-elasticsearch:9200","index":"el_..."}`.
The login, its role, and the library's search alias share the name of the
library's database. The role reaches only that alias and the indexes named
`<name>_*` behind it, which the library's search worker creates and swaps. A
retry with the same password answers `matched`; a new password or a role changed
by hand answers `updated`. `POST /v1/library-search/delete` with only
`libraryId` deletes the library's indexes, login, and role, and answers `absent`
once they are gone. Failures answer `search_reconciliation_failed` without
Elasticsearch's details.

Prove the login rules against a real Elasticsearch (the test starts its own
container unless `EVIDENCE_LIBRARY_TEST_ELASTICSEARCH_ADMIN_URL` names one):

```bash
DATABASE_URL_POST=postgresql://... npx vitest run --config vitest.integration.config.ts \
  tests/integration/library-search-provisioning.test.ts
```

## HTTPS and admin access

Every library uses the normal Compose file and a public HTTPS origin. Set
`identity.baseUrl` to that exact HTTPS origin. Coolify must force HTTP requests
to HTTPS and route the hostname to the `web` service on port `3000`.

Every deployed library must configure `authentication.openScholar` with its
Openscholar Convex site origin, Evidence Library ID, Openscholar page for the
library (`libraryUrl`), the account page readers and admins use (`accountUrl`),
its `els_` machine credential, and its own Clerk OAuth application (`oauth`:
issuer, client ID and client secret). It must also set `authentication.secret`,
which signs session cookies and encrypts the OAuth tokens the library stores.
Openscholar writes all of these; the runtime configuration is invalid when any
is missing.

Readers and admins sign in with their Openscholar account. The library uses
Better Auth with Openscholar's Clerk instance as its OAuth and OpenID Connect
provider. Public pages never redirect: only the Sign in button starts sign-in.

Opening `/admin` without a session cookie answers `307` to the library's own
`/api/admin/sign-in?return=<path>`, which starts the OAuth flow (PKCE and a
state cookie) and comes back to `/api/auth/callback/openscholar`, then to the
admin path. Sessions last 30 days and extend while in use. The admin role is
not stored in the session: each admin request asks Openscholar's
`admin-session/check` by Clerk user ID, and the answer is reused for about a
minute. Someone signed in without a role sees which organisation to ask.

While a reader is active the library refreshes their Clerk token and copies
their name and avatar at most every 15 minutes. If that fails it asks
Openscholar's `reader-status`; only `deleted` removes the reader. Openscholar
also calls `DELETE /api/v1/openscholar/readers/{clerkUserId}` with the machine
credential when an account is deleted.

`return` is checked here, not trusted. It must be a path inside this library's
admin, such as `/admin`, `/admin/items?scope=drafts`, or `/en-GB/admin`.
Anything else, including a full address or one starting with `//`, is replaced
by `/admin`.

The public library stays open. Admin pages and APIs use one role policy:

- Owners and Editors can use the existing content tools for records,
  collections, files, publishing, search status, and source writeback.
- Library setup, configuration, deployment, and membership actions are
  Owner-only. This runtime does not currently expose those actions, so no
  existing content route is restricted to Owners.

An invalid or missing cookie returns `401`. A valid role without the requested
permission returns `403`. Both API responses use
`Cache-Control: private, no-store`.

Workers do not read the admin cookie or copy its user identity into work. Search,
source sync, source writeback, and publication workers claim saved PostgreSQL
work and use the library's runtime service credentials.

After deployment, create a fresh code in Openscholar and check the redirect,
HTTPS certificate, reload persistence, logout, code replay rejection, and one
real PDF upload. In the browser, `window.isSecureContext` must be true and
`crypto.subtle` must exist.

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

Mount a writable directory owned by UID `1001` when configuration must change
without a restart. Activation replaces the file atomically. A read-only mount
or a single-file bind mount supports restart-based configuration delivery
only because the runtime cannot replace the active file in place.

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
5. The public library URL returns a successful HTTP response, and `/admin`
   answers with a redirect to the configured Openscholar page.

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
curl --include --silent --output /dev/null --write-out '%{http_code} %{redirect_url}\n' \
  https://library.example.org/admin
```

## Activate a change without restarting

Openscholar normally activates a complete configuration through the running
library. The request uses the machine credential from the currently active
configuration:

```http
PUT /api/openscholar/configuration
Authorization: Bearer <authentication.openScholar.machineCredential>
Content-Type: application/json

<complete runtime configuration document>
```

A successful response reports `status: "active"`, the exact requested
`revision`, and the SHA-256 of the submitted bytes. The route validates the
document, preserves the previous valid revision, and atomically replaces the
active file. The web app observes the new file on its next request. Each worker
finishes or aborts its current cycle, exits, and is restarted by Compose with
the new revision.

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

Openscholar can restore the immediately preserved revision without inventing a
new revision identifier:

```http
DELETE /api/openscholar/configuration
Authorization: Bearer <authentication.openScholar.machineCredential>
Content-Type: application/json

{"revision":"<previous-revision>"}
```

Only one activation or restore may run at a time. A live lock returns a
conflict, and a lock left behind for more than 30 seconds is removed
automatically before the next operation.

## Runtime URLs and assets

- Logos, favicons, institution logos, navigation images, fonts, and similar
  public assets are rendered from their configured URLs. The browser must be
  able to reach them.
- Enabled gap maps are streamed through
  `/gapmaps/<slug>.html`; the application server fetches their configured
  source URLs and accepts approved HTML content types.
- The library builds every citation file itself from its own records. There are
  no external file addresses. `exports.ris`, `exports.bibtex`, and `exports.atom`
  are switches. RIS and BibTeX are on by default; the Atom feed is off.
- Single-record downloads at `/lib/<key>/export/ris` and
  `/lib/<key>/export/bibtex` need `features.downloads` and the switch for that
  format. The download dialog offers only the formats that are switched on.
- Whole-library files at `/lib/export/ris` and `/lib/export/bibtex` need the
  same two switches. They read PostgreSQL 250 records at a time, walking the
  record key upwards, and stop after 20 000 records. Because paging follows the
  record key rather than a row number, a record added or removed while the file
  is being written cannot make another record appear twice or be missed. The
  file is named after the library short name.
- `features.homePage` gives the library a front page at `/`. While it is off,
  `/` redirects to `/lib`, and the sitemap leaves `/` out.
- `home` holds the front page's answers from Openscholar's Home card: the
  introduction, the curation statement and up to five typed steps, the team
  sentence and the people shown, up to three example questions, the publication
  the steps follow, the involvement buttons, a closing section and renamed
  headings. Longer answers are Markdown limited to bold, italic, links and
  bulleted lists. Openscholar fills in each person's name and photo when the
  library is published, plus a `directory` of every owner and editor that names
  whoever approved the followed publication; the directory never reaches the
  browser. Without `home` the page shows a generated introduction and the
  suggestion button.
- A curation step's type decides what the page fills in. `arrival`, `check`
  and `publication` follow one publication through review. `search`, `sync`
  and `duplicates` count from the library's active OpenAlex searches: the
  words, phrases and topics their OQL looks for, the records added in the last
  30 days, and the repeats merged away. `fulltext` counts the records with a
  PDF. A `text` step can carry a figure its owner writes. Each count is set
  large under the step's name; a zero shows as 0, so the page does not move
  when the figures arrive.
  Steps can also carry an `icon`, any Hugeicon id, and a typed step without one
  shows its type's icon. These types, `icon` and `figure` only widen the
  schema, so saved configurations need no migration. Rollback: an older runtime
  rejects a revision that uses them, so before rolling a library back to an
  image older than these step types, activate a configuration revision without
  them first.
- The Atom feed at `/lib/atom.xml` needs `features.atomFeed` and
  `exports.atom`. It lists the 50 most recently added records.
- Exports read a fixed list of citation columns. Stored full text, cover
  images, notes and file details are never loaded.
- Exports show the same records as the public library. Records carrying a
  hidden tag are left out. Records carrying a coming-soon or internal tag stay
  in, because the public library shows them with a badge.
- Proxied gap maps and generated exports are not cached by the application.
- PostgreSQL, Meilisearch, private Redis, SMTP, server analytics, and AI
  provider endpoints must be reachable from the container network. Browser
  analytics hosts must also be reachable from the user's browser.
- AI generation endpoints use the private Redis URL in `services.redis.url`.
  Each browser receives ten requests per minute, 250 per day, 1,000 per seven
  days, and 5,000 per 30 days. A separate 1,000-per-minute network limit uses
  the proxy-owned `X-Real-IP` header. Missing or unavailable Redis returns a
  controlled 503 instead of allowing an uncounted request.
- The day, week, and month counters start only after the browser returns its
  issued cookie. Cookie-refusing clients create only minute-lived browser keys
  and remain covered by the separate network limit. These browser counters are
  an ordinary-use quota, not an authentication boundary: a client that refuses
  or rotates cookies can avoid the browser identity windows, but still cannot
  exceed the proxy-owned 1,000-per-minute network limit.
- Redis reconnects after temporary socket loss. It fails closed at a 128 MB
  `noeviction` ceiling, so a full Redis also returns the controlled 503 instead
  of risking an out-of-memory container failure or uncounted AI requests.

## Release verification

Run the complete local contract before deploying the shared image:

```bash
npm run check:changed
SOURCE_COMMIT="$(git rev-parse HEAD)" npm run test:library-compose
npm run test:acceptance
```

`npm run test:acceptance` first starts the repository Compose deployment with
all seven services. It checks real Compose state and health, the active
revision, the public site, and the `/admin` redirect to Openscholar. The rest of
the suite starts two disposable libraries, PostgreSQL, Meilisearch, Mailpit,
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

## Real-service admin sign-in

Real-service checks that call the deployed admin HTTP API sign in through the
library's real flow with a development Clerk test user who has a role in that
library's Openscholar organisation. Set the development Clerk keys and the test
user once:

```bash
export CLERK_SECRET_KEY='<development sk_test_ key>'
export CLERK_PUBLISHABLE_KEY='<development pk_test_ key>'
export EVIDENCE_LIBRARY_TEST_CLERK_USER_ID='<user_ ID of the test admin>'
npm run test:search-worker
npm run test:native-file-http
npm run test:admin-item-batch-http
npm run test:linked-item-lifecycle
npm run test:admin-zotero-live -- --confirm-group <group-id>
```

Each check opens `/admin` in a headless browser, signs the test user in on
Clerk's page with a one-time sign-in token, and keeps the library's session
cookie. `EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE` instead reuses cookies copied
from a signed-in browser. The linked-item check signs in only when
`EVIDENCE_LIBRARY_TEST_URL` is set. The acceptance suite signs its own admins in
through the library's database and does not need these values.

## Real publication sandbox checks

These commands require a disposable library configured with Crossref Test and
Zenodo Sandbox. Use an Editor or Owner session. They reserve a DOI on a draft,
submit it for review, approve the snapshot, then repeat review and approval for
the metadata update and PDF. They reuse one evidence file across all three checks.

```bash
export PUBLICATION_SANDBOX_BASE_URL=https://your-sandbox-library.example.org
export PUBLICATION_SANDBOX_CONFIRM=https://your-sandbox-library.example.org
export PUBLICATION_SANDBOX_LIBRARY_ID=your-openscholar-library-id
export PUBLICATION_SANDBOX_RUN_ID=publication-$(date +%Y%m%d-%H%M%S)
export PUBLICATION_EXPECTED_CROSSREF_PREFIX=10.53832
export PUBLICATION_EXPECTED_CROSSREF_NAMESPACE=your-confirmed-sandbox-namespace
export PUBLICATION_SANDBOX_EVIDENCE_PATH=/tmp/${PUBLICATION_SANDBOX_RUN_ID}.json
npm run test:crossref-test-live
npm run test:zenodo-sandbox-live
npm run test:publication-sandbox-lifecycle
```

Check the target in Openscholar and type its origin separately into
`PUBLICATION_SANDBOX_CONFIRM`. The lifecycle check also needs Playwright's
Chromium browser (`npx playwright install chromium`).

The scripts stop before creating a record unless the website, provider
environments, DOI prefix, namespace, admin login, and publication worker all
match the explicitly confirmed library. Both provider environments are checked
before any record is created. The runtime must include this qualification
preflight endpoint. Start a new run and evidence file when changing libraries;
evidence from the old direct-publish script is not accepted. A failed run can
resume with the same run ID and evidence file. The final JSON contains the record keys, DOI, Crossref Test
submission IDs, Zenodo Sandbox record ID, and PDF hashes. It does not contain
provider credentials.

## Library digest schedules

`notifications.schedule` selects one recurrence. Both use an IANA timezone and
`HH:mm` local time:

```json
{"frequency":"weekly","weekday":1,"time":"09:00","timezone":"Europe/London"}
```

```json
{"frequency":"monthly","dayOfMonth":31,"time":"09:00","timezone":"Europe/London"}
```

Weekdays run from Sunday `0` to Saturday `6`. Monthly days run from `1` to `31`.
A shorter month uses its last day. Manual sends and scheduled sends share the
same digest cutoff and publication deduplication. Empty manual sends leave the
cutoff unchanged. Changing frequency preserves already announced publications.

`notifications.digestCovers` chooses what a digest covers. `published`, the
default, takes the publications dated from the day the period starts up to the
day before it ends, in the schedule's timezone, whenever they were added. A
record without a full `YYYY-MM-DD` date belongs to no period. `added` takes the
publications added to the library in the period. Instant emails always announce
additions.

`notifications.pausedSince`, the time digests were paused, stops scheduled
digests without turning subscriptions off. No digest is prepared while it is
set; emails about additions, digests already prepared and a digest an owner
asks for by hand are unaffected. When the pause ends, the digest goes out at
the next scheduled time, never for a time that passed during the pause, and
covers everything since the last digest, up to a month back (32 days).
Additions older than that are in no digest.

`notifications.approval` makes a written digest wait for a person. With it on,
a digest AI has written is saved as the edition's draft and emailed to nobody.
It appears in `/admin` under Digests, and when an Editor or Owner publishes it
readers see it and it is emailed to everyone subscribed at that moment,
including readers who joined while it waited. The digests page then gives the
day of the next digest without a time. Off, the default, a digest is published
and emailed as soon as it is written.

`notifications.attribution` tells readers who checked each digest. With it on,
the digest's page, the list of digests and the email name the Editor or Owner
who published it, with their photo, or say "Written by AI" for a digest nobody
checked. The editor's note shows above the text with that person's name and
role. Their account ID is never sent to readers. Off, the default, readers see
neither the name nor the note.

A digest lists at most 1,000 publications and 1.5 MB of their metadata. When a
period has more, every review and synthesis is picked first, by its study type
(review of reviews, meta-analysis, systematic review, literature review or
bibliometric study), then the rest by rank: a record with an abstract of at
least 200 characters first, then by a score of 3 for a journal OpenAlex marks
as core, 2 for ten or more references (1 for fewer), 1 for a known institution
and twice the natural log of one plus the citation count. A dataset or software
record loses 1. A retracted record or a journal's front matter is in no digest.
The edition stores and sends what was picked in that rank order, so each of its
two lists on the digest's page, reviews and syntheses and other publications,
is one ranking. The page shows how its publications were chosen whenever it
lists fewer than the period has.

A record's study type is the one an editor set, or else the one its reading
found (`itemReading`, see the record reading plan). A digest request sends
each publication's `studyType`, and leaves it out for a record not read yet.
When the list is made, the edition stores the period's publications by type in
`notificationEdition.studyTypes`, with `unread` for those not read yet, so the
counts add up to its `publicationCount`. The page's Publications card shows
each type listed out of the period's. An edition listed before types has no
period counts and shows what it lists.

The AI is offered meta-analysis or randomised trial only when the record's
title, abstract or PDF opening has the words for it, in the libraries'
languages (`src/lib/readings/type-words.ts`). Migration 0090 queued every
earlier AI call of either type; the reading cycle asks those without their
words again, type only, and leaves the rest unread.

A type the AI gave is uncertain when it was less than 60% sure, and is asked
again from the record's PDF once it has one. The library's
`filters.uncertainStudyTypes` chooses how readers see it: `marked` (the
default) shows the type marked uncertain; `separate` shows Uncertain in its
place on the record and as its own row in the Study types filter. The search
document stores both `studyType` and `studyTypeShown`, which holds `uncertain`
for an uncertain type, so switching needs no new index.

To write the digest of a past period, or rewrite the edition that already ends
when it does, send the period to the manual digest route with the library's
machine credential:

```sh
curl -X POST "$LIBRARY_URL/api/v1/openscholar/digests" \
  -H "Authorization: Bearer $MACHINE_CREDENTIAL" -H "Content-Type: application/json" \
  -d '{"period":{"start":"2026-09-01T00:00:00Z","end":"2026-10-01T00:00:00Z"}}'
```

It always selects by publication date, keeps the edition's record and address,
leaves the schedule alone and emails no subscriber, also when the library asks
for approval and a person publishes it later (`notificationEdition.silent`). The period's days are read
in the schedule's timezone, so a library outside UTC gives its own midnights,
such as `2026-09-01T00:00:00-04:00`. To rewrite an existing edition, send its
exact `windowStart` and `windowEnd`.

A new edition is published as soon as it is written, unless the library asks
for approval (`notifications.approval`). Rewriting an edition
readers already have leaves it up: its list of publications is replaced at
once, and the new text is saved as a draft (`notificationEdition.draft`) until
it is published. Each edition keeps the text AI wrote in `ai`, beside the
title, summary and text readers see. An edition waits to be written while its
`nextAttemptAt` is set.

The library's team works on digests in `/admin`, under Digests. Anyone with a
role can change an edition's title, summary, text and editor's note; the change
is saved as the edition's draft and readers keep the published text, as with a
record. A Creator sends the draft for review and can take it back. An Editor or
Owner sends it back or publishes it. Publishing an edition for the first time
emails its subscribers; publishing a change to one readers already have updates
the page and sends nothing. The person who publishes is recorded with their
name and photo as they were then (`checkedBy`), and each step is kept in
`notificationEditionEvent`. Every save carries the revision it was made from
(`draftRevision`), so a save over someone else's newer text is refused. Saved
text may hold second-level headings, paragraphs, bold and links to public
records in the edition, and nothing else. An edition whose draft a person has
changed is not rewritten: the rewrite route answers with the reason.

This release replaces `notifications.weekly` with `notifications.schedule` and
renames the subscriber preference and edition stream to `digest`. Migration
`0058` preserves subscriber tokens, editions and cutoffs. Openscholar owner
configuration version 5 converts saved weekly schedules when creating a new
revision; frozen revisions stay unchanged. For a runtime upgrade, prepare and
validate a new configuration with `frequency: "weekly"` and the existing clock
settings, then deploy it with this runtime. An older runtime cannot read that
configuration. Rollback requires the matching old configuration and reversing
the three column renames and `digest` stream value, or restoring the pre-upgrade
database snapshot. Never rewrite historical configuration files in place.
