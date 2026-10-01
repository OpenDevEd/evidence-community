# Cookie Inventory

This inventory reflects the current application behavior as of September 12, 2026.

## Essential cookies

| Name                                                      | Owner                             | Purpose                                                                                   | Required               | Retention                       | Notes                                                                                                    |
| --------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `analytics_consent`                                       | First-party application           | Stores analytics and replay preferences, tenant scope, library and built-in policy versions, and decision time. | Yes                    | 180 days                        | PostHog and Google Analytics do not load in the browser unless product analytics is allowed.             |
| `NEXT_LOCALE`                                             | First-party application / Next.js | Stores the user's language preference.                                                    | Yes                    | Browser-managed                 | Functional cookie for localized routing.                                                                 |
| `ai_rate_limit_id`                                        | First-party application           | Keeps one anonymous browser quota across AI requests and web processes.                   | Yes when AI is used    | 365 days                        | HTTP-only, same-site cookie scoped to `/api/ai`; it contains a random identifier, not an account ID.     |
| `__cf_bm`                                                 | Cloudflare                        | Bot-management and abuse detection.                                                       | Yes                    | Cloudflare-managed, short-lived | Security/infrastructure cookie.                                                                          |
| `_cfuvid`                                                 | Cloudflare                        | Distinguishes visitors behind shared IPs for rate limiting and security controls.         | Yes                    | Cloudflare-managed, short-lived | Security/infrastructure cookie.                                                                          |
| `evidence-library.session_token` or `__Secure-evidence-library.session_token` | Better Auth | Keeps a reader or admin signed in with their OpenScholar account. | Yes when signed in | 30 days, extended while in use | HTTP-only. Secure deployments use the secure-prefixed name. |
| `evidence-library.session_data` or `__Secure-evidence-library.session_data` | Better Auth | Caches the signed session for a few minutes so each page does not query the database. | Yes when signed in | 5 minutes | HTTP-only and signed. |
| `evidence-library.state` or `__Secure-evidence-library.state` | Better Auth | Ties the return from OpenScholar to the sign-in this browser started. | Yes during sign-in | 5 minutes | HTTP-only. Set only after the person presses Sign in or opens `/admin`. |

## Conditional analytics cookies and storage

These must not exist before explicit consent is granted.

| Name                                                  | Owner                   | Purpose                                               | Required | Retention          | Notes                                                                  |
| ----------------------------------------------------- | ----------------------- | ----------------------------------------------------- | -------- | ------------------ | ---------------------------------------------------------------------- |
| `_ga` and `_ga_*`                                     | Google Analytics        | Analytics measurement and visit/session attribution.  | No       | Google-managed     | Only loaded when a current `analytics_consent` record allows product analytics.                         |
| `ph_*` cookies                                        | PostHog                 | Analytics persistence for consented PostHog sessions. | No       | PostHog-managed    | Only created after consent. The app clears these on denial/revocation. |
| `ph_*`, `posthog*`, `posthog-opted` in `localStorage` | PostHog                 | Client analytics persistence.                         | No       | PostHog-managed    | Stored locally, not cookies, but relevant for privacy review.          |
| `utm:active` in `localStorage`                        | First-party application | Stores consented UTM campaign attribution data.       | No       | Runtime-configured | Removed whenever product analytics is not allowed.                     |

## Notes for policy drafting

- The security, locale, and sign-in cookies above are not analytics cookies.
- `analytics_consent` is the only first-party consent cookie introduced by this application for analytics gating. `ai_rate_limit_id` is an essential abuse-prevention cookie and does not enable analytics.
- Google Analytics and PostHog are designed not to load before consent. If they appear before consent, that is a regression.
- Declined visitors can send strict same-origin aggregate events. Those requests use the consent cookie but create no browser analytics identifier or vendor storage.
