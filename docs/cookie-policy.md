# Cookies

## **How {{SITE_HOST}} uses cookies**

{{SITE_HOST}} uses browser storage for essential site features. {{Analytics::}}Optional analytics storage is used only after you choose to allow product analytics.{{::}}{{NoAnalytics::}}This community runs no analytics, so it sets only the strictly necessary storage below.{{::}}

## **Strictly necessary storage**

This storage is needed for the site to work or remember a choice you asked it to remember. {{Analytics::}}It cannot be disabled through our analytics settings.{{::}}

| **Name**                | **Owner**               | **Purpose**                                                                                                                          | **Expires**                        |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
{{OwnConsent::}}| `analytics_consent`     | {{SITE_HOST}}           | Stores your analytics and session replay choices, the community they apply to, the policy versions, and when you made the choice.       | 180 days                           |
{{::}}{{SharedConsent::}}| `openscholar_consent`   | openscholar.ai          | Stores your analytics choice and when you made it. Openscholar and every community at an openscholar.ai address read the same choice. | 1 year                             |
{{::}}| `NEXT_LOCALE`           | {{SITE_HOST}} / Next.js | Stores your language preference.                                                                                                     | Browser-managed                    |
| `evidence-library.*` sign-in cookies | {{SITE_HOST}} | Keep you signed in with your Openscholar account and tie the return from Openscholar to the sign-in you started. Set only after you sign in. | Up to 30 days, extended while in use |
| `__cf_bm`, `_cfuvid`    | Cloudflare              | Support bot protection, abuse prevention, and rate limiting when Cloudflare is used.                                                 | Cloudflare-managed and short-lived |

{{Analytics::}}## **Product analytics storage (optional)**

The PostHog and Google Analytics browser tools do not load until you allow product analytics. If you decline or later turn product analytics off, the site stops these tools and clears their browser storage.

| **Name**                            | **Owner**        | **Purpose**                                                                                                                         | **Expires**                            |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `community_ga`, `community_ga_*`    | Google Analytics | Distinguish consented visits and sessions for traffic and usage reports. Advertising storage and signals remain disabled.           | Google-managed, normally up to 2 years |
| `ph_*`, `posthog*`, `posthog-opted` | PostHog          | Maintain a pseudonymous browser profile and session for consented product analytics. These entries may be cookies or local storage. | PostHog-managed                        |

PostHog records useful product actions such as page visits, searches being present, result counts, allowed filter categories, file actions, copy and export actions, performance signals, dead clicks, and technical error types. It may automatically record clicks, changes, and form submissions on allowed interface elements.

We remove or mask free-text searches, form values, passwords, document text, AI prompts and responses, copied text, query strings, referrers, email addresses, and sensitive element attributes before analytics events are sent. We do not use advertising cookies or sell analytics data.

## **Session replay and diagnostics (optional)**

{{::}}{{OwnConsent::}}Session replay is a separate choice. It can only be enabled when product analytics is enabled.
{{::}}{{SharedConsent::}}Allowing product analytics also allows session replay.
{{::}}{{Analytics::}}
When enabled, PostHog can record a visual reconstruction of a session so we can reproduce interface problems. Page text, input values, element identifiers, links, and image sources are masked. Only styling and visual-state attributes are retained to reconstruct the layout; URLs in CSS are removed. Request and response bodies, request headers, console logs, canvas content, JSON-LD, and cross-origin frames are not recorded.

{{::}}{{OwnConsent::}}Turning session replay off stops new replay recording without turning off ordinary product analytics.
{{::}}{{Analytics::}}
## **When product analytics is declined**

The browser does not load PostHog or Google Analytics and does not create a browser analytics profile. The site may send a small set of same-site aggregate events to its own server. These events contain only fixed categories and counts, such as a page path without its query string, result totals, or the type of file action. They do not include browser identifiers, free-text searches, document content, AI conversations, or user-provided text.

The server groups these aggregate events by community and day before sending them to PostHog. It does not pass the visitor's IP address or create a person profile for them.

{{::}}## **Managing your choices**

{{OwnConsent::}}Use **Cookie settings** in the footer to change your choices at any time. **Accept All & Continue** enables product analytics and session replay. **Save preferences** saves the two switches exactly as shown. **Decline** disables both.

If the built-in analytics policy or this community’s policy version changes, or if you move to a different community with a different site address, the site asks again. Deleting the consent cookie also makes the site ask again.
{{::}}{{SharedConsent::}}Use **Cookie settings** in the footer to change your choice at any time. **Accept All & Continue** enables product analytics and session replay. **Save preferences** saves the switch as shown. **Decline** disables both.

Your choice holds on Openscholar and on every community at an openscholar.ai address, so you are asked once. Changing it on any of them changes it on all of them. Deleting the `openscholar_consent` cookie makes them ask again.

If you answered on this community before it shared Openscholar's choice, that answer stays in an `analytics_consent` cookie on {{SITE_HOST}} and applies here only, until you choose on Openscholar or on any of its communities. Your new choice then replaces it, and the site removes that cookie.
{{::}}
Most browsers also let you inspect or delete stored site data in their privacy settings.

## **Get in touch**

For questions about our use of cookies and similar storage, email habari@openscholar.ai.

**Last updated**: November 13, 2026
