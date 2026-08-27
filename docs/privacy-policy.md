# Privacy policy

This notice explains how Open Development & Education processes personal
information when you use {{SITE_HOST}}.

## Controller and contact

Open Development & Education is the controller for the processing described in
this notice.

**Email:** contact@opendeved.net

## Information we process

### Support and correspondence

If you contact us, we process your contact details, message, attachments,
correspondence history, and related timestamps so that we can respond and keep an
appropriate record.

### Account features

If you create or use an account, we process the information needed to register,
authenticate, maintain your session, and provide saved account features. An
external sign-in provider may also process information when you choose that
method.

### Product analytics after consent

If you enable product analytics, PostHog and Google Analytics process
pseudonymous usage information including:

- a random analytics identifier and session information;
- page paths without query strings or fragments;
- navigation, interface controls, searches and filters without search text;
- publication and attachment actions without titles or filenames;
- result counts and zero-result outcomes;
- feature use, funnels, heatmaps, rage clicks, and dead clicks;
- browser/device characteristics, performance metrics, and technical errors;
- normalised campaign attribution;
- AI feature, model, token, cost, duration, cache, tool-count, success/failure,
  and safe error-category metadata.

This pseudonymous profile does not require an account. We do not attach your name
or email address to it.

Google may process an IP address transiently during collection to provide
measurement and approximate geography. Advertising storage, advertising user
data, advertising personalisation, Google Signals, and ad personalisation remain
disabled.

### Session replay after separate consent

If you also enable session replay and diagnostics, PostHog records a masked
visual representation of interface activity and technical errors. The
implementation masks all text, form inputs, and element attributes; excludes
request and response bodies and headers; and disables canvas and cross-origin
iframe recording.

### Aggregate operational measurement without analytics consent

If analytics is pending or rejected, Google Analytics and the PostHog browser SDK
remain unloaded. We may still record content-free aggregate operational events,
including page-path counts, attachment-action counts, and AI cost/performance
metadata, as well as result-count outcomes and copy/export actions without their
content.

These aggregate events contain no browser, device, user, or session identifier;
no IP address or user-agent forwarded as analytics properties; no referrer,
campaign, query string, search text, title, filename, or user-provided content;
and no PostHog person profile or geolocation processing. All such events for a
library and UTC day share one rotating aggregate key, so they cannot measure a
returning individual.

### Infrastructure and security

Our hosting and security providers necessarily process connection and request
information such as IP address, time, route, status, and user-agent to deliver the
service, prevent abuse, enforce rate limits, diagnose failures, and protect the
website. Security logs are separate from product analytics.

## Information excluded from analytics

We do not send the following to PostHog or Google Analytics:

- AI prompts, conversations, model responses, or screening content;
- search text;
- PDF text, abstracts, document contents, publication titles, or filenames;
- form-field values, passwords, access tokens, or authentication values;
- payment information.

We do not sell personal information and do not use third-party advertising
cookies.

## Purposes and lawful bases

We rely on the following lawful bases:

- **Consent:** pseudonymous PostHog product analytics, Google Analytics, and the
  separately selectable session-replay purpose. You can withdraw consent at any
  time through **Cookie settings** in the footer.
- **Legitimate interests:** service delivery, content-free aggregate operational
  measurement, cost and reliability monitoring, security, abuse prevention,
  rate limiting, troubleshooting, and responding to support requests. Our
  interests are operating and improving a reliable public evidence service. We
  minimise the data, separate aggregate measurement from individual analytics,
  and provide the right to object where applicable.
- **Contract or steps at your request:** providing account features that you ask
  to use.
- **Legal obligation:** keeping or disclosing information when the law requires
  it.

## Consent and withdrawal

The analytics preference contains separate choices for product analytics and
session replay. Session replay cannot be enabled without product analytics.

When you withdraw product-analytics consent, the application stops replay,
disables Google collection, resets PostHog identity and persistence, clears known
PostHog/Google analytics storage, and removes stored campaign attribution. The
withdrawal affects future processing; previously lawfully collected information
remains subject to the retention rules below.

The necessary `analytics_consent` cookie stores only the policy version,
timestamp, and preference booleans. It contains no analytics or user identifier.

## Sources of information

Information comes from:

- you, when you use account features or contact us;
- your browser and device after you grant the relevant analytics permission;
- aggregate events generated by the application;
- infrastructure and security providers that deliver and protect the service;
- an external sign-in provider when you choose that option.

## Recipients and processors

We use the following categories of processor:

- **PostHog:** consented product analytics, optional session replay and
  diagnostics, and content-free server operational events;
- **Google Analytics:** consented website measurement only;
- **Cloudflare:** content delivery, security, bot management, DDoS protection,
  and rate limiting;
- **hosting and database providers:** application hosting, storage, backups, and
  operational logs;
- **email and sign-in providers:** only when you use the corresponding support or
  account feature.

Access is limited to people and processors that need the information for these
purposes.

## International transfers

Some processors operate in the United States or other countries. Where personal
information is transferred outside the UK or EEA, we use an available lawful
transfer mechanism such as an adequacy decision, the UK Extension to the EU-US
Data Privacy Framework, the EU-US Data Privacy Framework, approved contractual
clauses, and any required supplementary safeguards. The applicable mechanism
depends on the processor and destination.

## Retention

The intended operational retention limits are:

| Information | Retention |
| --- | --- |
| PostHog product analytics events | Up to 14 months |
| PostHog session replay | Up to 30 days |
| Google Analytics user and event data | 2 months |
| Aggregate operational analytics | Up to 13 months |
| Raw infrastructure/security logs | Normally up to 30 days, unless an incident or legal requirement requires longer |
| Support correspondence | Up to 3 years after the last communication |
| Account information | While the account is active and for the period needed to close, secure, or meet legal requirements afterward |

Vendor-dashboard settings must be configured to these limits. Backups may retain
deleted information for a limited additional period before rotation.

## Your rights

Depending on the law that applies, you may have rights to:

- access your personal information and related processing details;
- correct inaccurate or incomplete information;
- request deletion;
- restrict processing;
- object to processing based on legitimate interests;
- receive portable information that you supplied where the right applies;
- withdraw consent at any time;
- complain to a data-protection authority.

To exercise a right, contact **contact@opendeved.net**. We may need enough
information to verify and locate the relevant record. For a pseudonymous
PostHog profile, we may ask you to provide its browser analytics identifier so
we can locate it.

In the UK, you can also complain to the Information Commissioner's Office:
[ico.org.uk/make-a-complaint](https://www.ico.org.uk/make-a-complaint/).

## Security

We use HTTPS, access controls, data minimisation, pseudonymisation, restricted
processor access, backups, monitoring, and security review. No system can be
guaranteed completely secure, but we review and improve these measures.

## Changes to this notice

We may update this notice when processing changes. Material changes to analytics
purposes or processors can increment the consent-policy version and require a
new choice.

**Last updated:** August 27, 2026
