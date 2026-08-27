# Cookies and analytics

## How {{SITE_HOST}} uses browser storage

{{SITE_HOST}} uses strictly necessary cookies to operate the website. With your
permission, it also uses optional product analytics and, if separately enabled,
masked session replay and diagnostics.

You can accept all optional processing, reject it, or enable product analytics
without session replay. You can change your choice at any time through **Cookie
settings** in the footer.

## Strictly necessary cookies

These cookies support essential functions and do not require analytics consent.

| Name | Owner | Purpose | Retention |
| --- | --- | --- | --- |
| `analytics_consent` | {{SITE_HOST}} | Stores the consent-policy version, decision timestamp, product-analytics choice, and session-replay choice. It does not contain a user or analytics identifier. | 180 days |
| `NEXT_LOCALE` | {{SITE_HOST}} / Next.js | Stores the selected language for localised routing. | Browser-managed |
| Auth.js session, callback, and CSRF cookies | {{SITE_HOST}} / Auth.js | Securely supports sign-in, sessions, and protection of authentication requests when account features are used. Exact names may use a secure prefix. | Session or authentication configuration |
| `__cf_bm` | Cloudflare | Bot management and abuse protection. | Short-lived; Cloudflare-managed |
| `_cfuvid` | Cloudflare | Security and rate-limiting support for visitors sharing an IP address. | Short-lived; Cloudflare-managed |

## Product analytics storage

Product analytics is disabled until you grant permission. When enabled,
{{SITE_HOST}} loads PostHog and Google Analytics.

| Name | Owner | Purpose | Retention |
| --- | --- | --- | --- |
| `ph_*` cookies and similarly prefixed local-storage entries | PostHog | Maintains a random pseudonymous device identifier, session continuity, attribution, and consented product analytics. | PostHog-managed, subject to the configured analytics retention period |
| `_ga`, `_ga_*` | Google Analytics | Maintains pseudonymous visitor and session measurement. Advertising storage and personalisation remain disabled. | Google-managed, subject to the configured analytics retention period |
| `utm:active` in local storage | {{SITE_HOST}} | Keeps normalised campaign attribution after analytics consent. | 30 days unless the deployment configures a shorter period |

PostHog's random identifier is **pseudonymous**, not anonymous. It lets us
understand repeated use of the library without requiring an account. We do not
attach a name or email address to this analytics profile.

## What consented product analytics measures

When product analytics is enabled, we may measure:

- page navigation and exits;
- button, link, form, and interface-control interactions;
- searches, filters, result counts, and zero-result outcomes without the search
  text itself;
- publication and attachment views or downloads without filenames or titles;
- feature adoption, funnels, heatmaps, rage clicks, and dead clicks;
- web performance and technical errors;
- AI feature name, selected model, token usage, cost, duration, tool counts,
  cache metadata, success or failure, and a safe error category;
- normalised campaign source, medium, campaign, term, and content values.

URLs are reduced to their path. Query strings, fragments, referrers, and
sensitive analytics properties are removed before events are sent.

We do **not** send the following to PostHog or Google Analytics:

- AI prompts, conversations, model responses, or screening content;
- search text;
- PDF text, abstracts, publication titles, filenames, or document contents;
- text entered into forms, passwords, access tokens, or authentication values;
- payment details.

## Session replay and diagnostics

Session replay is a separate optional preference. If enabled, PostHog records a
visual representation of interface activity to help diagnose usability and
technical problems.

The recorder masks all text and form inputs, masks element attributes, excludes
request and response bodies and headers, disables canvas and cross-origin iframe
recording, and blocks elements marked as sensitive. Session replay is stopped
immediately when the preference is disabled.

## If you reject analytics

Google Analytics and the PostHog browser SDK remain unloaded. No analytics
cookie, browser identifier, or analytics session is created.

{{SITE_HOST}} may still submit a small allowlisted event to its own server for
aggregate operational measurement, such as a page-path count, attachment action,
result-count outcome, copy/export action, or content-free AI cost and performance
metadata. These events:

- do not include a browser, user, device, or session identifier;
- do not include IP address, user-agent, referrer, campaign data, query string,
  search text, titles, filenames, or user-provided content;
- are sent to PostHog with geolocation and person-profile processing disabled;
- use one rotating library-and-day aggregate key shared by all rejected or
  undecided visitors and therefore cannot measure a returning individual.

The server and Cloudflare necessarily process connection information for
delivery, security, bot detection, rate limiting, and abuse prevention. That
operational processing is separate from product analytics.

## Google consent settings

Google Analytics uses Basic Consent Mode. The Google tag is not loaded when
analytics is pending or rejected. Even after consent, advertising storage,
advertising user data, advertising personalisation, Google Signals, and ad
personalisation remain disabled.

## Withdrawing consent

When you withdraw analytics consent, {{SITE_HOST}}:

- tells Google that analytics storage is denied and disables further GA events;
- stops PostHog session replay;
- opts out and resets the PostHog device and session identity;
- clears known PostHog and Google Analytics cookies and storage;
- clears stored campaign attribution.

You can also delete site data through your browser. Browser vendors provide
instructions for [Chrome](https://support.google.com/accounts/answer/61416),
[Firefox](https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox),
[Safari](https://support.apple.com/en-gb/guide/safari/sfri11471/mac), and
[Edge](https://support.microsoft.com/en-us/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09).

## Contact

Questions about these practices can be sent to **contact@opendeved.net**.

**Last updated:** August 27, 2026
