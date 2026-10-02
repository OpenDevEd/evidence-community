# Evidence Library browser shield

Origin-side guard for the Evidence Library deployments. It blocks AI training
crawlers and networks caught hammering the servers. Everything else gets in:
every bot in Cloudflare Radar's verified directory that is not a training
crawler, such as search engines, assistants, link previews, archivers and feed
readers, plus anyone running a real browser.

Unknown clients get a short "Checking your browser" page that sets a cookie via
JavaScript and reloads, so scrapers posing as ordinary browsers stall there. The
cookie lasts 30 days and is then required for dynamic pages, APIs, RSC
requests, and prefetches. Static assets, robots, sitemaps, feeds, exports,
unAPI discovery, and the authenticated feature flag sync never need it.

## How it works

One Traefik `forwardAuth` middleware (`ode-library-shield@file`) asks the
`shield` container about every request. The decision logic lives entirely in
[forwardauth/default.conf](forwardauth/default.conf):

- source IPs in [forwardauth/banned-ips.conf](forwardauth/banned-ips.conf) →
  `403`
- explicitly denied Cloudflare source IPs are intercepted by a high-priority
  Traefik router and sent to the shield's fixed `403` response
- training crawlers → `403`
- every other recognized bot → pass. Each Radar category gets its own 3 req/s
  budget (burst 15) per hostname, so a search crawl cannot starve link previews
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

- Radar `AI_CRAWLER` bots are blocked as training crawlers, along with
  Bytespider, CCBot, and FacebookBot, which Radar does not verify.
- Every other verified bot is allowed under its Radar category.
- Explicit additions cover bots Radar misses or matches too narrowly, such as
  Slack's `Slackbot-LinkExpanding`, WhatsApp, Mastodon, and Perplexity.
  `CloudVertexBot` is removed from training because it fetches on a user's
  request.

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
202.46.62.0/24
```

The first five were selected from a Traefik access-log sample for
`docs.edtechhub.org` on 2026-08-31. Together they generated 294,998 requests
from 666 rotating source IPs in roughly two hours, primarily spoofing ordinary
Chrome user agents. The first four networks belong to Alibaba Cloud ranges;
the fifth is a China Unicom range.

The sixth network generated 10,138 requests from 120 rotating source IPs
against `docs.opendeved.net` in under 22 minutes on the same day. It requested
8,074 unique paths, including dynamic API and RSC routes, while presenting the
same ordinary Chrome user agent throughout.

Edit [forwardauth/banned-ips.conf](forwardauth/banned-ips.conf) only after
confirming distributed, high-volume crawling across several addresses in the
same network. Do not derive a permanent network ban from one request or one IP.

The Traefik configuration also denies `158.23.18.78/32` before application
routing. That source made 152 requests to `coolify.opendeved.net` in roughly 34
seconds on 2026-08-31, probing 136 mostly PHP, web-shell, and WordPress paths.
Because that hostname is Cloudflare-proxied, the rule matches Cloudflare's
trusted `CF-Connecting-IP` header instead of the Cloudflare edge address seen by
the host firewall.

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
agents passing through their category's crawler budget.
