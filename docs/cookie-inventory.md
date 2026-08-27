# Cookie and analytics storage inventory

This inventory reflects the target Coolify implementation as of August 27,
2026. Vendor-dashboard retention and regional settings must be verified during
deployment before the policy is published.

## Strictly necessary

| Name | Owner | Purpose | Retention | Notes |
| --- | --- | --- | --- | --- |
| `analytics_consent` | Application | Versioned record containing the decision timestamp and separate analytics/replay booleans. | 180 days | Contains no analytics or user identifier. An old or malformed version is treated as pending and prompts again. |
| `NEXT_LOCALE` | Application / Next.js | Language preference. | Browser-managed | Functional. |
| Auth.js session, callback, and CSRF cookies | Application / Auth.js | Authentication and request protection when account features are used. | Auth.js-managed | Exact names vary with HTTPS and deployment configuration. |
| `__cf_bm` | Cloudflare | Bot management and abuse detection. | Short-lived | Infrastructure/security. |
| `_cfuvid` | Cloudflare | Rate-limiting and security support. | Short-lived | Infrastructure/security. |

## Optional after product-analytics consent

| Name | Owner | Purpose | Retention | Notes |
| --- | --- | --- | --- | --- |
| `_ga`, `_ga_*`, `_gid`, `_gat*` | Google Analytics | Pseudonymous analytics identity and session/measurement state. | Google-managed | The application clears known values on revocation. Google is never loaded before consent. |
| `ph_*` cookies | PostHog | Pseudonymous device/session persistence and PostHog consent state. | PostHog-managed | The application resets identity and clears known values on revocation. |
| `ph_*`, `posthog*` in local/session storage | PostHog | Pseudonymous analytics persistence. | PostHog-managed | Only created after consent. |
| `utm:active` in local storage | Application | Normalised campaign attribution. | Configurable; 30-day default | Only stored after consent and cleared on revocation. |

## No-consent aggregate mode

Rejected browser events use no analytics cookie or local-storage identity. The
server forwards only schema-validated event properties, disables PostHog GeoIP
and person processing, and uses one `aggregate:<library>:<UTC day>` key shared by
all non-consented events for that library and day.

This mode counts events. It does not produce a visitor, device, browser, or
cross-day session count.

The allowlist covers page paths, attachment actions, result-count outcomes,
copy/export format and feature context, and content-free server AI telemetry.
It never contains search text, selected filter values, generated content, or
publication metadata.

## Implementation checks

- `posthog-js` may only be imported by `src/lib/analytics.ts`.
- `posthog-node` may only be imported by `src/lib/posthog.ts`.
- A request-body `distinctId` is accepted for server event linking only when the
  versioned consent cookie independently confirms product-analytics consent.
- AI telemetry never contains prompts, messages, abstracts, search bodies, PDF
  contents, filenames, or OpenRouter generation IDs.
- Session replay masks all text, inputs, and attributes and does not record
  network bodies/headers, canvas, or cross-origin iframes.
