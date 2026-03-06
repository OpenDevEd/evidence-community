# Cookie Inventory

This inventory reflects the current application behavior as of March 6, 2026.

## Essential cookies

| Name | Owner | Purpose | Required | Retention | Notes |
| --- | --- | --- | --- | --- | --- |
| `analytics_consent` | First-party application | Stores the user's analytics consent choice (`pending`, `granted`, `denied`). | Yes | 180 days | Used to gate PostHog and Google Analytics before they load. |
| `NEXT_LOCALE` | First-party application / Next.js | Stores the user's language preference. | Yes | Browser-managed | Functional cookie for localized routing. |
| `__cf_bm` | Cloudflare | Bot-management and abuse detection. | Yes | Cloudflare-managed, short-lived | Security/infrastructure cookie. |
| `_cfuvid` | Cloudflare | Distinguishes visitors behind shared IPs for rate limiting and security controls. | Yes | Cloudflare-managed, short-lived | Security/infrastructure cookie. |
| `__client_uat` | Clerk | Tracks session freshness for Clerk authentication flows. | Yes | Clerk-managed | Authentication/session helper. |
| `__client_uat_<suffix>` | Clerk | Instance-scoped variant of Clerk session freshness state. | Yes | Clerk-managed | Authentication/session helper. |
| `__clerk_db_jwt` | Clerk (development) | Development browser token for Clerk dev instances. | Yes in development | Clerk-managed | Development-only cookie; should not be documented as a production auth dependency. |
| `__clerk_db_jwt_<suffix>` | Clerk (development) | Instance-scoped development browser token for Clerk dev instances. | Yes in development | Clerk-managed | Development-only cookie. |

## Conditional analytics cookies and storage

These must not exist before explicit consent is granted.

| Name | Owner | Purpose | Required | Retention | Notes |
| --- | --- | --- | --- | --- | --- |
| `_ga` and `_ga_*` | Google Analytics | Analytics measurement and visit/session attribution. | No | Google-managed | Only loaded after `analytics_consent=granted`. |
| `ph_*` cookies | PostHog | Analytics persistence for consented PostHog sessions. | No | PostHog-managed | Only created after consent. The app clears these on denial/revocation. |
| `ph_*`, `posthog*`, `posthog-opted` in `localStorage` | PostHog | Client analytics persistence. | No | PostHog-managed | Stored locally, not cookies, but relevant for privacy review. |
| `utm:active` in `localStorage` | First-party application | Stores consented UTM attribution data. | No | Configurable | Only persisted after consent. |

## Notes for policy drafting

- The screenshot-visible cookies `__cf_bm`, `_cfuvid`, `NEXT_LOCALE`, and Clerk cookies are not analytics cookies.
- `analytics_consent` is the only first-party consent cookie introduced by this application for analytics gating.
- Clerk cookie names can vary by environment and deployment shape. Production documentation should describe them by purpose rather than assuming every development cookie exists in production.
- Google Analytics and PostHog are designed not to load before consent. If they appear before consent, that is a regression.
