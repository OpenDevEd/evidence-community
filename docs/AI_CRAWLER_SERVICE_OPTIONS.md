# Managed AI crawler controls

Research date: 2026-08-31

## Recommendation

Use Cloudflare's managed AI traffic policies for every Cloudflare-proxied public
hostname. Configure:

- Search: Allow
- Agent: Allow
- Training: Block

Cloudflare now classifies bot traffic by behavior and exposes these three
managed policies on every plan. A bot can have more than one behavior, and a
Training block also catches mixed-purpose Search and Training crawlers.
[Cloudflare's policy documentation](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)
matches the requested distinction directly.

Enable Bot Preference Sync too. This replaces the older one-purpose managed
`robots.txt` setting. It derives `robots.txt` from the same Search, Agent, and
Training choices, prepends the generated rules to the application's existing
file, and periodically refreshes the list from Cloudflare's BotBase. It is
available on all plans. Cloudflare announced the transition from legacy managed
`robots.txt` in August 2026.
[Bot Preference Sync announcement](https://blog.cloudflare.com/bot-preference-sync/)
The current API exposes the zone setting as `bot_preference_sync_enabled`.
[Cloudflare Bot Management API](https://developers.cloudflare.com/api/resources/bot_management/)

Do not remove the origin shield. Remove its hand-maintained AI provider lists,
but keep its generic browser challenge, connection cap, and rate limiting. Those
controls solve a different problem: unknown automation and crawlers that claim
to be ordinary Chrome. Cloudflare documents that Free-plan AI Crawl Control
identifies self-declared crawlers from their user-agent strings; stronger bot
identity and detection IDs require Bot Management.
[AI Crawl Control crawler management](https://developers.cloudflare.com/ai-crawl-control/features/manage-ai-crawlers/)

The repository also exposes direct, non-Cloudflare hostnames. Cloudflare cannot
enforce a policy on traffic that bypasses its edge. A live header check on
2026-08-31 found `cf-ray` on 10 of 17 primary tenant domains. The remaining
seven were not confirmed Cloudflare-proxied, including `docs.edtechhub.org`, the
site that triggered this work. Either proxy every public hostname through
Cloudflare or retain a small origin fallback for those direct routes. The
existing Cloudflare-origin IP allowlist already prevents bypass on proxied
hostnames.

## Externally managed tenant domains

Yes: an OpenDevEd Enterprise zone can front hostnames owned and DNS-hosted by
other organizations through **Cloudflare for SaaS**. The owner need not transfer
the domain, change nameservers, or give OpenDevEd account access. It must route
the individual hostname to OpenDevEd's SaaS target. An Enterprise zone cannot
intercept an unrelated hostname that still routes directly to Coolify.
[Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)
[requires each custom hostname's DNS to point to the provider's SaaS target](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/).

### Required cooperation

| Customer situation | Required customer action | Nameserver or account access needed? |
| --- | --- | --- |
| Subdomain, any ordinary DNS provider | Add or replace one `CNAME`, for example `docs.customer.org CNAME libraries.opendeved.net` | No |
| Apex with alias/flattening support | Point the apex alias to the SaaS target | No |
| Apex requiring an `A` record | Point the apex to the static prefixes assigned by Cloudflare Apex Proxying | No, but Apex Proxying is a paid Enterprise add-on |
| Customer already uses Cloudflare | Create the same `CNAME`; it can remain proxied, producing an Orange-to-Orange (O2O) flow | No access to its account; its owner creates the record |
| No DNS change and the record does not already use the selected SaaS target | **Impossible at Cloudflare's edge** | Keep the origin shield |

For O2O, the customer zone's settings run first and OpenDevEd's SaaS-zone
settings run second; Bot Management and WAF rules work in both.
[Orange-to-Orange routing](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/saas-customers/how-it-works/)
and its
[product compatibility table](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/saas-customers/product-compatibility/)
document this. Apex Proxying supports a root-domain `A` record, but its owner
must still change that record.
[Apex Proxying](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/)

A no-touch exception may exist if a tenant already CNAMEs to an
OpenDevEd-controlled hostname that can become the SaaS target. Verify this from
live DNS; it does not help direct `A`/`AAAA` records or external CNAME targets.

### Exact request and onboarding flow

1. Ask the account team to enable Cloudflare for SaaS on the selected Enterprise
   zone; Enterprise ownership alone does not enable it.
2. In that zone, create a proxied fallback-origin record that resolves to the
   Coolify/Traefik origin; designate it as the fallback origin and create a
   stable CNAME target such as `libraries.opendeved.net`.
3. Create a custom-hostname object for each tenant hostname.
4. For zero downtime, have the owner publish hostname-ownership and certificate
   DCV records before cutover. Alternatively, cut the CNAME first and use
   real-time/HTTP validation, accepting a possible short TLS activation window.
5. The owner changes only the relevant hostname's DNS record to the SaaS target.
   Cut over only when custom-hostname `status` and `ssl.status` are both `active`.
6. Traffic becomes: visitor -> tenant DNS -> OpenDevEd SaaS target -> OpenDevEd
   Cloudflare zone -> Coolify origin.

Hostname ownership and certificate issuance are separate checks.
[Cloudflare's validation documentation](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/)
defines the status fields; its
[certificate validation guide](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/)
documents HTTP, TXT, and Delegated DCV.

Cloudflare preserves the tenant `Host` header. With the fallback origin it also
uses that hostname as origin SNI, so Full (strict) requires Coolify to present a
valid tenant-hostname certificate. A custom origin instead uses the custom-origin
name as SNI while retaining the tenant `Host`; use an Origin Rule if the backend
expects another Host. SNI rewrites require Enterprise entitlement and do not
support wildcard custom hostnames.
[Connection request details](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/reference/connection-details/)
[Custom-origin and SNI behavior](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/)

### Security-policy propagation

Enterprise bot mitigation, WAF, analytics, and DDoS protection extend to custom
hostnames. WAF for SaaS can apply custom, rate-limit, and managed rules, with
optional custom metadata for per-tenant scope.
[Cloudflare for SaaS plan capabilities](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
and
[WAF for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/waf-for-saas/)
confirm that boundary. The SaaS-zone AI policy can therefore block Training and
allow Search/Agent before traffic reaches Coolify.
[AI bot policies](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)

Cloudflare does not document Bot Preference Sync inheritance for SaaS custom
hostnames as explicitly as WAF/bot mitigation. Keep the application's
provider-specific `robots.txt` until a pilot confirms the generated directives
through the tenant hostname. Edge blocking does not depend on `robots.txt`.

Enterprise hostname allowance and pricing are contractual; the documented
maximum is unlimited, with sales contact above 50,000. Apex Proxying and custom
metadata are paid add-ons; SNI Rewrite also needs the account team.
[Current Cloudflare for SaaS plan matrix](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)

**Recommendation:** ask the Cloudflare account team to enable or confirm
Cloudflare for SaaS, WAF for SaaS, and Bot Management on the existing Enterprise
zone, plus Apex Proxying only for true apexes. Pilot one external subdomain, then
inventory all live DNS targets. Existing CNAMEs to a reusable OpenDevEd target
may need no customer edit; every other hostname needs one DNS change. Keep the
origin shield for partners who cannot or will not make it.

## Ranked options

| Rank | Option | Training versus search | Enforcement and identity | Cost and maintenance | Fit here |
| --- | --- | --- | --- | --- | --- |
| 1 | Cloudflare AI Crawl Control plus Bot Preference Sync | Native Search, Agent, and Training behaviors; per-crawler overrides | Edge WAF block before the origin. Free-plan crawler attribution is user-agent based. Enterprise Bot Management adds detection IDs and stronger signals. | Managed policies and preference sync are available on all plans and update without repository changes. | Best fit for the 10 confirmed proxied tenant domains. It will not cover the seven unconfirmed domains until they are proxied. |
| 2 | Known Agents, formerly Dark Visitors | Separate `AI Data Scraper`, `AI Data Provider`, `AI Search Crawler`, and `AI Assistant` categories | Automatic `robots.txt` is advisory. Its paid identification API reports verified, spoofed, unverifiable, and unknown requests, but Nginx enforcement would require a custom integration or Cloudflare Worker. | Automatic `robots.txt` is on the Free plan. Current plans are $29/month for 1 million API events and $299/month for 10 million. | A possible fallback if the site leaves Cloudflare, but its catalog needs review against provider documentation before enforcement. |
| 3 | Cloudflare Radar Bots API as a data feed | Returns bot category, operator, user-agent patterns, and Web Bot Auth metadata | The API provides data, not enforcement. Pulling it into Nginx still means building a scheduler, generator, safe reload, and failure handling. | Maintained by Cloudflare; no repository list to vendor, but the sync machinery would be ours. | Useful for audits. Inferior to using Crawl Control on the same network. |
| 4 | `ai.robots.txt` open-source list | Its generated files deliberately include every AI-related bot regardless of purpose | Ships an Nginx user-agent regex and `robots.txt`; any client can spoof a user agent. | Free, MIT-licensed, community-maintained, and has release feeds. Updating deployed Nginx remains our job. | Wrong policy. Its Nginx file blocks `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, and other traffic we want to allow. |
| 5 | IAB/ABC International Spiders and Bots List | No AI training versus assistant/search distinction. It separates human from non-human traffic for measurement. | User-agent files plus an IP exclusion list; intended for analytics and advertising traffic filtering. | Updated monthly. ABC subscriptions start at GBP 4,285 plus VAT per year. | Not suitable for access policy and much more expensive than the relevant choices. |

## Source notes

Cloudflare's [AI Crawl Control overview](https://developers.cloudflare.com/ai-crawl-control/)
says the service is available on all plans and provides per-crawler controls,
traffic analysis, and robots compliance monitoring. Blocking creates or updates
a WAF custom rule, so it rejects requests before they reach Coolify.
[Crawler action and WAF behavior](https://developers.cloudflare.com/ai-crawl-control/features/manage-ai-crawlers/)

Bot Preference Sync keeps the stated `robots.txt` policy aligned with those
enforced behavior settings. Unlike the legacy managed `robots.txt` option, it
can reflect Search, Agent, and Training choices instead of publishing one fixed
training block. It does not read individual custom WAF exceptions, so a zone
with per-crawler agreements may still need a hand-edited file.
[Bot Preference Sync details](https://blog.cloudflare.com/bot-preference-sync/)

Cloudflare's maintained
[bot reference](https://developers.cloudflare.com/ai-crawl-control/reference/bots/)
already separates training crawlers such as `GPTBot`, `ClaudeBot`, `CCBot`, and
`Meta-ExternalAgent` from search and assistant traffic such as
`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`,
`PerplexityBot`, and `Perplexity-User`. The larger
[Radar Bots Directory](https://radar.cloudflare.com/bots/directory) and
[Radar Bots API](https://developers.cloudflare.com/api/resources/radar/subresources/bots/)
hold the maintained catalog. Cloudflare verifies approved bots through Web Bot
Auth, published IP ranges, or reverse DNS.
[Verified bot requirements](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/)

Known Agents can generate and cache a daily `robots.txt` from selected agent
categories. Its official example keeps `AI Data Scraper` and `AI Data Provider`
separate from `AI Search Crawler` and `AI Assistant`.
[Known Agents automatic robots.txt](https://knownagents.com/docs/robots-txt/nodejs)
Its identification API can distinguish verified agents from spoofed names.
[Known Agents identification API](https://knownagents.com/docs/identification/nodejs)
Current plan limits and prices come from its
[pricing page](https://knownagents.com/pricing).

Do not consume the Known Agents catalog as unreviewed authority. Its current
[`Google-Extended` page](https://knownagents.com/agents/google-extended) says
correctly that the token should not appear in requests, then presents a concrete
`Google-Extended/1.0` HTTP user agent and describes traffic attributed to it.
Google's own documentation says `Google-Extended` has no separate HTTP user
agent and is only a `robots.txt` control token.
[Official Google crawler documentation](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended)
That contradiction is enough to require first-party review before using Known
Agents categories to drive a hard block.

The open-source
[`ai.robots.txt` repository](https://github.com/ai-robots-txt/ai.robots.txt)
ships ready-made Nginx and robots files, but its README says the list covers AI
crawlers of all purposes. Its generated
[Nginx configuration](https://github.com/ai-robots-txt/ai.robots.txt/blob/main/nginx-block-ai-bots.conf)
confirms that it blocks user-directed and search agents along with training
crawlers.

ABC describes the IAB/ABC product as a non-human traffic measurement list. It
publishes user-agent and IP files, updates monthly, and starts at GBP 4,285 plus
VAT annually.
[ABC Spiders and Robots Service](https://www.abc.org.uk/assurance/bots-and-spiders)

## Limits no service removes

- A crawler that uses residential IPs and an ordinary Chrome user agent does
  not present a stable AI identity. Keep generic behavioral defenses for it.
- A direct origin hostname bypasses Cloudflare policy.
- `robots.txt` is voluntary. Use edge or origin enforcement as well.
- Providers sometimes combine purposes under one identity. In particular,
  `Google-Extended` covers both model improvement and Gemini grounding. A strict
  Training block must deny that mixed use even though some grounding traffic
  would otherwise be useful.

## No-DNS-control outcome

The domain owners will not be asked to change DNS, so Cloudflare cannot be the
common enforcement point. Every usable option must run on the Coolify origin or
inside the application.

**DataDome is the closest managed replacement.** Its supported Traefik
middleware sends request signals to DataDome and enforces the returned decision
before the application. Agentic Trust uses signed-agent verification, official
IP lists, reverse DNS, network attribution, and fingerprints. DataDome says
training collectors generally default to Block while other agents generally use
an intent-based policy. This is a technical fit for every hostname that already
reaches this Traefik instance, but the current entry plan is USD 3,830 per month.
[Traefik integration](https://docs.datadome.co/docs/traefik),
[AI agent identification](https://docs.datadome.co/docs/ai-agent-identification),
[default policy guidance](https://docs.datadome.co/docs/checklist-before-activating-protection),
and [pricing](https://datadome.co/pricing/) document those boundaries.

**Cloudflare Radar is the best low-cost catalog source, not a detection
service.** Its Bots API returns maintained bot categories and user-agent
patterns, including separate `AI_CRAWLER`, `AI_SEARCH`, and `AI_ASSISTANT`
categories. A small updater can generate the Nginx maps, validate them, retain a
last-known-good copy, and reload only after `nginx -t` succeeds. Radar cannot
authenticate a request at the origin or detect a Chrome-spoofed scraper.
[Radar Bots API](https://developers.cloudflare.com/api/resources/radar/subresources/bots/methods/list/)

**CrowdSec complements that catalog.** Its Traefik bouncer and AppSec component
can block abusive IPs and application attacks at the origin. It does not know
whether an AI request is for training, search, or a user-directed assistant, so
it cannot replace the crawler policy.
[CrowdSec Traefik integration](https://docs.crowdsec.net/docs/next/appsec/quickstart/traefik/)

### Revised deployment direction

1. Keep the Traefik forward-auth shield as the single enforcement point for all
   library domains on the server.
2. Generate its known-agent maps from the Cloudflare Radar catalog, with a small
   reviewed override file for provider-specific conflicts and policy-only
   `robots.txt` tokens.
3. Put allow-listed search and assistant identities behind one strict shared
   hostname budget. Radar supplies maintained identities, but does not verify a
   request at the origin; the rate budget limits damage from a spoofed identity.
   Provider IP lists, reverse DNS, or signed credentials can strengthen this
   later where they are reliably available.
4. Keep the per-IP Traefik limit, global in-flight limit, and browser challenge
   for unknown automation. The 2026-08-31 log review found five distributed
   source networks that survived those controls, so the shield now denies those
   reviewed CIDRs. Add CrowdSec only if network churn makes static review too
   slow or operationally expensive.
5. Consider DataDome only if its broader bot and fraud protection justifies the
   published monthly minimum.
