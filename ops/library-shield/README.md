# Evidence Library browser shield

Origin-side scraper speed bump for the Evidence Library deployments. First-time
browser visits get a short "Checking your browser" page that sets a cookie via
JavaScript and reloads; non-JavaScript scrapers stall there. APIs, assets, RSC
requests, feeds and crawlers are never challenged, so pages can't break the way
the old path-based shield broke `/en-US/lib/<key>`.

## How it works

One Traefik `forwardAuth` middleware (`ode-library-shield@file`) asks the
`shield` container about every request. The decision logic lives entirely in
[forwardauth/default.conf](forwardauth/default.conf):

- bad-bot user agents → `403`
- search crawlers → pass, rate-limited to 3 req/s (burst 15) per IP+UA
- cookie present, non-GET, API/RSC/asset/feed/sitemap paths, non-HTML → pass
- everything else (uncookied top-level GET HTML) → `401` + challenge page

A library is shielded because its Coolify application attaches the middleware —
there is no hostname list, no wildcard, and no duplicated routing state. All of
the app's hostnames, current and future, are covered automatically.

## Components

- **Shield app** — Coolify application built from this repo (compose build
  pack, base directory `ops/library-shield/forwardauth`). Internal-only; no
  domain.
- **Traefik middlewares** — [forwardauth/middlewares.yaml](forwardauth/middlewares.yaml),
  deployed to `/data/coolify/proxy/dynamic/ode-library-shield-forwardauth.yaml`
  on the server (copy manually when it changes; Traefik hot-reloads).
- **Per-app labels** — each library app's `https-*` router gets the middleware
  chain appended in its Coolify custom labels (Configuration → Advanced →
  Container Labels), then redeploy:

  Cloudflare-proxied hostname router:

  ```text
  traefik.http.routers.https-N-<uuid>.middlewares=gzip,ode-shield-cf-origin@file,ode-shield-rate-cf@file,ode-shield-inflight-cf@file,ode-library-shield@file
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

Each hostname is checked for: challenge on uncookied HTML, real page with
cookie, JSON from `/api/auth/session` without a cookie, `robots.txt` passing,
and GPTBot receiving `403`.
