# Evidence Library browser shield

Origin-side scraper speed bump for the Evidence Library deployments. First-time
browser visits get a short "Checking your browser" page that sets a cookie via
JavaScript and reloads; non-JavaScript scrapers stall there. The cookie is then
required for dynamic pages, APIs, RSC requests, and prefetches. Static assets,
robots, sitemaps, feeds, exports, unAPI discovery, the authenticated feature
flag sync, and recognized search or user-triggered crawlers have narrow explicit
bypasses. Training crawlers are denied, while allowed automated clients still
share a crawler rate limit.

## How it works

One Traefik `forwardAuth` middleware (`ode-library-shield@file`) asks the
`shield` container about every request. The decision logic lives entirely in
[forwardauth/default.conf](forwardauth/default.conf):

- source IPs in [forwardauth/banned-ips.conf](forwardauth/banned-ips.conf) →
  `403`
- training crawlers and known bulk scrapers → `403`
- recognized search, assistant, and user-triggered crawlers → pass, sharing a
  3 req/s budget (burst 15) per hostname
- every client, including blocked crawlers, can fetch `robots.txt`
- cookie present, or a static/robots/sitemap/feed/export/unAPI/sync path →
  pass
- uncookied top-level GET HTML → `401` + challenge page
- other uncookied dynamic/API/RSC/prefetch requests → `403`

A library is shielded because its Coolify application attaches the middleware —
there is no hostname list, no wildcard, and no duplicated routing state. All of
the app's hostnames, current and future, are covered automatically.

## Bot catalog

The crawler split comes from Cloudflare Radar's verified bot directory, not a
hand-maintained user-agent list. At image build time,
[forwardauth/sync-radar-bots.sh](forwardauth/sync-radar-bots.sh) renders the
bundled last-known-good [Radar snapshot](forwardauth/radar-bots.snapshot.json)
into Nginx maps. When `CLOUDFLARE_RADAR_API_TOKEN` is configured, the container
refreshes the verified catalog at startup and every 24 hours. A failed refresh
keeps the last valid map and does not interrupt Nginx.

[forwardauth/radar-policy.json](forwardauth/radar-policy.json) contains only the
local policy layer:

- Radar `AI_CRAWLER` bots are blocked as training crawlers.
- `AI_ASSISTANT`, `AI_SEARCH`, and `SEARCH_ENGINE_CRAWLER` bots are allowed
  through the shared crawler budget.
- Explicit additions/removals cover agents whose Radar category does not match
  the desired policy, plus known bulk SEO scrapers.

Optional environment variables on the shield application:

```text
CLOUDFLARE_RADAR_API_TOKEN=<token with Radar API access>
RADAR_BOT_SYNC_INTERVAL_SECONDS=86400
```

The refresh interval must be at least 300 seconds. Without a token, the bundled
snapshot remains active; rebuild the shield image after updating that snapshot.

## Confirmed source-IP bans

The following networks are denied before cookie, route, or user-agent checks:

```text
43.119.100.0/24
43.119.104.0/24
47.82.201.0/24
47.82.202.0/24
116.179.33.0/24
```

They were selected from a Traefik access-log sample for `docs.edtechhub.org` on
2026-08-31. Together they generated 294,998 requests from 666 rotating source
IPs in roughly two hours, primarily spoofing ordinary Chrome user agents. The
first four networks belong to Alibaba Cloud ranges; the fifth is a China Unicom
range. Edit [forwardauth/banned-ips.conf](forwardauth/banned-ips.conf) only after
confirming distributed, high-volume crawling across several addresses in the
same network. Do not derive a permanent ban from one request or one IP.

## Components

- **Shield app** — Coolify application built from this repo (compose build
  pack, base directory `ops/library-shield/forwardauth`). Internal-only; no
  domain.
- **Generated bot policy** — Cloudflare Radar snapshot, policy overrides, and
  refresh scripts under [forwardauth](forwardauth/).
- **Traefik middlewares** — [forwardauth/middlewares.yaml](forwardauth/middlewares.yaml),
  deployed to `/data/coolify/proxy/dynamic/ode-library-shield-forwardauth.yaml`
  on the server (copy manually when it changes; Traefik hot-reloads).
- **Per-app labels** — each library app's `https-*` router gets the middleware
  chain appended in its Coolify custom labels (Configuration → Advanced →
  Container Labels), then redeploy:

  Cloudflare-proxied hostname router:

  ```text
  traefik.http.routers.https-N-<uuid>.middlewares=gzip,ode-shield-cf-origin@file,ode-shield-rate-cf@file,ode-shield-inflight@file,ode-library-shield@file
  ```

  Direct (non-Cloudflare) hostname router:

  ```text
  traefik.http.routers.https-N-<uuid>.middlewares=gzip,ode-shield-rate-direct@file,ode-shield-inflight@file,ode-library-shield@file
  ```

  Direct hostnames get real client IPs through PROXY protocol from the
  front at `91.98.221.197` (trusted in Traefik's entrypoint config), so the
  `rate-direct` limiter keys correctly. The `cf-origin` allowlist stops
  direct-to-origin requests from forging `CF-Connecting-IP` on Cloudflare
  hostnames.

## Verify

```sh
ops/library-shield/probe.sh docs-kaleidoscopio.opendev.space docs.opendeved.net
```

Each hostname is checked for: challenge on uncookied HTML, real page with a
cookie, dynamic API and RSC denial without a cookie, cookied API access,
`robots.txt` passing, training crawlers receiving `403`, and assistant search
agents passing through the shared crawler budget.
